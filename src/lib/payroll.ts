/**
 * The attendance → payroll engine.
 *
 * Everything money-shaped in Workfence resolves through here, as pure
 * functions over the store: no mutation, no hidden clock, no hard-coded
 * policy. The principle (spec §26) is separation — shift duration, break
 * duration, net working time, regular vs overtime, paid vs unpaid — a single
 * "hours worked" number is never used for pay. Every rupee a calculation
 * produces carries a line saying why, so a manager can trace an amount back
 * to the attendance, shift, break and compensation rules that made it.
 */

import { dayAllowances } from "./allowances";
import { todayISO } from "./format";
import type {
  Attendance,
  BreakEntry,
  CompRecord,
  OvertimeConfig,
  PayPolicy,
  PayrollRun,
  ShiftDef,
  User,
  WorkforceState,
} from "./types";

/* ------------------------------------------------------------- defaults */

export const DEFAULT_PAY_POLICY: PayPolicy = {
  lateDeduction: "none",
  latePerMinuteRate: 0,
  lateFixedAmount: 0,
  earlyOutDeduction: "none",
  earlyPerMinuteRate: 0,
  earlyFixedAmount: 0,
  absenceDeduction: "full-day",
  excessBreakUnpaid: true,
  managerSeesSalary: false,
};

export const DEFAULT_OVERTIME: OvertimeConfig = {
  enabled: true,
  graceMinutes: 15,
  approval: "auto",
  method: "salary-multiplier",
  hourlyRate: 150,
  tiers: [
    { afterHours: 0, multiplier: 1.5 },
  ],
  bonusAfterHours: null,
  bonusAmount: 0,
};

/**
 * The shift a person is on when no ShiftDef has been assigned: their
 * contracted times off the user record, dressed as a definition so the
 * engine has one shape to reason about.
 */
export function fallbackShift(user: User): ShiftDef {
  return {
    id: `implicit_${user.id}`,
    orgId: user.orgId,
    name: "Contracted hours",
    code: "—",
    kind: "fixed",
    startMinute: user.shiftStart,
    endMinute: user.shiftEnd,
    requiredMinutes: Math.max(0, user.shiftEnd - user.shiftStart - 60),
    graceMinutes: 15,
    breakRules: [{ id: "impl_lunch", name: "Lunch", durationMinutes: 60, paid: false }],
    maxBreaksPerShift: 3,
    minBreakMinutes: 5,
    maxBreakMinutes: 90,
    employeeBreaksAllowed: true,
    breakApprovalRequired: false,
    overtime: DEFAULT_OVERTIME,
    workingDays: [1, 2, 3, 4, 5, 6],
    projectIds: [],
    status: "active",
    createdAt: user.joinedAt,
  };
}

/* ------------------------------------------------------------ resolution */

/** The shift in force for an employee on a date: latest effective assignment. */
export function shiftFor(
  s: Pick<WorkforceState, "shifts" | "shiftAssignments" | "users">,
  employeeId: string,
  date: string,
): ShiftDef | null {
  const user = s.users.find((u) => u.id === employeeId);
  if (!user) return null;
  const assignment = (s.shiftAssignments ?? [])
    .filter((a) => a.employeeId === employeeId && a.effectiveFrom <= date)
    .sort((a, b) =>
      a.effectiveFrom === b.effectiveFrom
        ? a.at - b.at
        : a.effectiveFrom < b.effectiveFrom
          ? -1
          : 1,
    )
    .pop();
  const def = assignment
    ? (s.shifts ?? []).find((x) => x.id === assignment.shiftId)
    : undefined;
  return def ?? fallbackShift(user);
}

/** A future assignment, for the "Effective from" line on a profile. */
export function upcomingShiftFor(
  s: Pick<WorkforceState, "shifts" | "shiftAssignments">,
  employeeId: string,
  date: string,
): { shift: ShiftDef; effectiveFrom: string } | null {
  const next = (s.shiftAssignments ?? [])
    .filter((a) => a.employeeId === employeeId && a.effectiveFrom > date)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
  const shift = next ? (s.shifts ?? []).find((x) => x.id === next.shiftId) : undefined;
  return next && shift ? { shift, effectiveFrom: next.effectiveFrom } : null;
}

/** Salary record in force on a date — the latest effective revision. */
export function compFor(
  s: Pick<WorkforceState, "comp">,
  employeeId: string,
  date: string,
): CompRecord | null {
  return (
    (s.comp ?? [])
      .filter((c) => c.employeeId === employeeId && c.effectiveFrom <= date)
      .sort((a, b) =>
        a.effectiveFrom === b.effectiveFrom
          ? a.at - b.at
          : a.effectiveFrom < b.effectiveFrom
            ? -1
            : 1,
      )
      .pop() ?? null
  );
}

/** Derived rates from a salary record — one place, one formula. */
export function ratesOf(c: CompRecord): { daily: number; hourly: number } {
  const dayHours = Math.max(1, c.standardDayMinutes) / 60;
  if (c.type === "hourly") return { hourly: c.amount, daily: c.amount * dayHours };
  if (c.type === "daily") return { daily: c.amount, hourly: c.amount / dayHours };
  const daily = c.amount / Math.max(1, c.workingDaysPerMonth);
  return { daily, hourly: daily / dayHours };
}

/* -------------------------------------------------------------- day math */

export interface BreakTotals {
  totalMinutes: number;
  /** Minutes covered by the shift's paid-break allowance. */
  paidMinutes: number;
  unpaidMinutes: number;
  count: number;
}

/** Break minutes actually taken, split by the shift's paid allowance. */
export function breakTotals(
  breaks: BreakEntry[] | undefined,
  shift: ShiftDef,
  now = Date.now(),
): BreakTotals {
  const list = breaks ?? [];
  const totalMinutes = list.reduce(
    (t, b) => t + Math.max(0, ((b.end ?? now) - b.start) / 60000),
    0,
  );
  const paidAllowance = shift.breakRules
    .filter((r) => r.paid)
    .reduce((t, r) => t + r.durationMinutes, 0);
  const paidMinutes = Math.min(totalMinutes, paidAllowance);
  return {
    totalMinutes,
    paidMinutes,
    unpaidMinutes: totalMinutes - paidMinutes,
    count: list.length,
  };
}

/**
 * One attendance day measured against its shift. Durations only — money is
 * `dayPay`'s job, so a screen may show time without touching salary data.
 */
export interface DayMetrics {
  shift: ShiftDef;
  /** Scheduled span of the shift (or required minutes when flexible). */
  scheduledMinutes: number;
  /** Check-in → check-out, wall clock. */
  grossMinutes: number;
  breaks: BreakTotals;
  /** Gross minus every break — actual working time. */
  netMinutes: number;
  /** Minutes after the scheduled start (0 when flexible). */
  lateMinutes: number;
  /** The part of `lateMinutes` past the shift's grace. */
  lateBeyondGraceMinutes: number;
  /** Minutes short of the scheduled end (0 when flexible or on OT). */
  earlyOutMinutes: number;
  /** OT minutes — past shift end (fixed) or past required minutes (flexible),
      counted only once past the OT grace. */
  overtimeMinutes: number;
  /** Net minutes that are not overtime. */
  regularMinutes: number;
  /** Whether the shift is still open (metrics are live, not final). */
  open: boolean;
}

/** Epoch ms of a minutes-from-midnight time on an ISO date. */
function timeOn(date: string, minutes: number): number {
  return new Date(`${date}T00:00:00`).getTime() + minutes * 60000;
}

export function dayMetrics(
  att: Attendance,
  shift: ShiftDef,
  now = Date.now(),
): DayMetrics {
  const inAt = att.checkIn?.at ?? now;
  const outAt = att.checkOut?.at ?? now;
  const open = !!att.checkIn && !att.checkOut && !att.autoClosed;

  const grossMinutes = Math.max(0, (outAt - inAt) / 60000);
  const breaks = breakTotals(att.breaks, shift, now);
  const netMinutes = Math.max(0, grossMinutes - breaks.totalMinutes);

  const flexible = shift.kind === "flexible";
  const scheduledMinutes = flexible
    ? shift.requiredMinutes
    : shift.endMinute > shift.startMinute
      ? shift.endMinute - shift.startMinute
      : 24 * 60 - shift.startMinute + shift.endMinute; // overnight

  let lateMinutes = 0;
  let earlyOutMinutes = 0;
  let overtimeMinutes = 0;

  if (flexible) {
    const past = netMinutes - shift.requiredMinutes;
    overtimeMinutes = past > shift.overtime.graceMinutes ? past : 0;
  } else {
    const start = timeOn(att.date, shift.startMinute);
    // An overnight shift ends on the next calendar day; the attendance row
    // stays filed under the check-in date (spec §5).
    const end = timeOn(
      att.date,
      shift.endMinute > shift.startMinute
        ? shift.endMinute
        : shift.endMinute + 24 * 60,
    );
    lateMinutes = Math.max(0, (inAt - start) / 60000);
    // Overtime runs from the shift end — or from check-in, for someone who
    // arrived after it — and can never exceed the time actually worked.
    const otFrom = Math.max(end, inAt);
    const otRef = open ? now : outAt;
    if (!open) earlyOutMinutes = Math.max(0, (end - outAt) / 60000);
    const past = (otRef - otFrom) / 60000;
    overtimeMinutes =
      shift.overtime.enabled && past > shift.overtime.graceMinutes
        ? Math.min(past, netMinutes)
        : 0;
  }

  return {
    shift,
    scheduledMinutes,
    grossMinutes,
    breaks,
    netMinutes,
    lateMinutes,
    lateBeyondGraceMinutes: Math.max(0, lateMinutes - shift.graceMinutes),
    earlyOutMinutes,
    overtimeMinutes,
    regularMinutes: Math.max(0, netMinutes - overtimeMinutes),
    open,
  };
}

/* -------------------------------------------------------------- day pay */

/** One traceable line of a pay calculation: what, how much, and why. */
export interface PayLine {
  label: string;
  /** Signed ₹. */
  amount: number;
  why: string;
  kind: "earning" | "overtime" | "bonus" | "deduction";
}

export interface DayPay {
  metrics: DayMetrics;
  comp: CompRecord | null;
  lines: PayLine[];
  base: number;
  overtimePay: number;
  bonus: number;
  deductions: number;
  total: number;
  /** OT minutes actually paid (approval state applied). */
  paidOvertimeMinutes: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** OT pay for `minutes` of overtime, per the shift's configured method. */
export function overtimePay(
  minutes: number,
  ot: OvertimeConfig,
  hourlyRate: number,
): { amount: number; why: string } {
  const hours = minutes / 60;
  if (ot.method === "fixed-hourly") {
    return {
      amount: r2(hours * ot.hourlyRate),
      why: `${fmtHM(minutes)} × ₹${ot.hourlyRate}/h fixed OT rate`,
    };
  }
  // Tiered multipliers over the salary-derived hourly rate: each tier prices
  // the stretch of OT between its threshold and the next.
  const tiers = [...ot.tiers].sort((a, b) => a.afterHours - b.afterHours);
  if (tiers.length === 0) tiers.push({ afterHours: 0, multiplier: 1.5 });
  let amount = 0;
  const parts: string[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const from = tiers[i].afterHours;
    const to = i + 1 < tiers.length ? tiers[i + 1].afterHours : Infinity;
    const span = Math.max(0, Math.min(hours, to) - from);
    if (span <= 0) continue;
    amount += span * hourlyRate * tiers[i].multiplier;
    parts.push(`${span.toFixed(2)}h × ${tiers[i].multiplier}×`);
  }
  return {
    amount: r2(amount),
    why: `${parts.join(" + ")} on ₹${Math.round(hourlyRate)}/h`,
  };
}

/**
 * The pay one attendance day generates, with every amount explained.
 * Overtime respects approval state: pending or rejected OT earns nothing yet.
 */
export function dayPay(
  s: Pick<WorkforceState, "shifts" | "shiftAssignments" | "users" | "comp" | "payPolicy">,
  att: Attendance,
  now = Date.now(),
): DayPay {
  const shift =
    ((s.shifts ?? []).find((x) => x.id === att.shiftId) ??
      shiftFor(s, att.employeeId, att.date)) as ShiftDef;
  const metrics = dayMetrics(att, shift, now);
  const comp = compFor(s, att.employeeId, att.date);
  const policy = s.payPolicy ?? DEFAULT_PAY_POLICY;
  const lines: PayLine[] = [];

  if (!comp) {
    return {
      metrics,
      comp: null,
      lines,
      base: 0,
      overtimePay: 0,
      bonus: 0,
      deductions: 0,
      total: 0,
      paidOvertimeMinutes: 0,
    };
  }

  const { daily, hourly } = ratesOf(comp);

  /* base pay — a day worked earns the daily rate (hourly staff earn by the
     paid hour: regular time plus the paid-break allowance actually used) */
  if (comp.type === "hourly") {
    const paidMinutes = metrics.regularMinutes + metrics.breaks.paidMinutes;
    lines.push({
      kind: "earning",
      label: "Hours worked",
      amount: r2((paidMinutes / 60) * comp.amount),
      why: `${fmtHM(paidMinutes)} paid time × ₹${comp.amount}/h`,
    });
  } else {
    lines.push({
      kind: "earning",
      label: "Day worked",
      amount: r2(daily),
      why:
        comp.type === "daily"
          ? `Daily wage ₹${comp.amount}`
          : `₹${comp.amount}/month ÷ ${comp.workingDaysPerMonth} working days`,
    });
    /* unpaid break beyond allowance, for salaried staff */
    if (policy.excessBreakUnpaid && metrics.breaks.unpaidMinutes > 0.5) {
      lines.push({
        kind: "deduction",
        label: "Unpaid break",
        amount: -r2((metrics.breaks.unpaidMinutes / 60) * hourly),
        why: `${fmtHM(metrics.breaks.unpaidMinutes)} beyond the paid-break allowance × ₹${Math.round(hourly)}/h`,
      });
    }
  }

  /* late deduction, past grace only */
  if (metrics.lateBeyondGraceMinutes > 0.5 && policy.lateDeduction !== "none") {
    const amount =
      policy.lateDeduction === "per-minute"
        ? policy.latePerMinuteRate * metrics.lateBeyondGraceMinutes
        : policy.lateFixedAmount;
    if (amount > 0) {
      lines.push({
        kind: "deduction",
        label: "Late arrival",
        amount: -r2(amount),
        why:
          policy.lateDeduction === "per-minute"
            ? `${Math.round(metrics.lateBeyondGraceMinutes)}m beyond grace × ₹${policy.latePerMinuteRate}/min`
            : `Fixed late deduction (arrived ${Math.round(metrics.lateMinutes)}m after start)`,
      });
    }
  }

  /* early checkout deduction */
  if (metrics.earlyOutMinutes > 0.5 && policy.earlyOutDeduction !== "none") {
    const amount =
      policy.earlyOutDeduction === "per-minute"
        ? policy.earlyPerMinuteRate * metrics.earlyOutMinutes
        : policy.earlyFixedAmount;
    if (amount > 0) {
      lines.push({
        kind: "deduction",
        label: "Early checkout",
        amount: -r2(amount),
        why:
          policy.earlyOutDeduction === "per-minute"
            ? `${Math.round(metrics.earlyOutMinutes)}m before shift end × ₹${policy.earlyPerMinuteRate}/min`
            : `Fixed early-checkout deduction (left ${Math.round(metrics.earlyOutMinutes)}m early)`,
      });
    }
  }

  /* overtime — only what the approval state allows */
  let paidOvertimeMinutes = 0;
  const ot = att.overtime;
  if (shift.overtime.enabled && ot && ot.status !== "rejected") {
    paidOvertimeMinutes =
      ot.status === "pending" ? 0 : (ot.approvedMinutes ?? ot.minutes);
    if (ot.status === "pending") {
      lines.push({
        kind: "overtime",
        label: "Overtime (pending approval)",
        amount: 0,
        why: `${fmtHM(ot.minutes)} awaiting manager approval — not yet payable`,
      });
    } else if (paidOvertimeMinutes > 0.5) {
      const pay = overtimePay(paidOvertimeMinutes, shift.overtime, hourly);
      lines.push({
        kind: "overtime",
        label: "Overtime",
        amount: pay.amount,
        why: pay.why,
      });
      const bonusAfter = shift.overtime.bonusAfterHours;
      if (
        bonusAfter !== null &&
        paidOvertimeMinutes / 60 >= bonusAfter &&
        shift.overtime.bonusAmount > 0
      ) {
        lines.push({
          kind: "bonus",
          label: "Overtime bonus",
          amount: r2(shift.overtime.bonusAmount),
          why: `Fixed bonus after ${bonusAfter}h of overtime`,
        });
      }
    }
  }

  const base = lines
    .filter((l) => l.kind === "earning")
    .reduce((t, l) => t + l.amount, 0);
  const overtimeTotal = lines
    .filter((l) => l.kind === "overtime")
    .reduce((t, l) => t + l.amount, 0);
  const bonus = lines
    .filter((l) => l.kind === "bonus")
    .reduce((t, l) => t + l.amount, 0);
  const deductions = -lines
    .filter((l) => l.kind === "deduction")
    .reduce((t, l) => t + l.amount, 0);

  return {
    metrics,
    comp,
    lines,
    base: r2(base),
    overtimePay: r2(overtimeTotal),
    bonus: r2(bonus),
    deductions: r2(deductions),
    total: r2(base + overtimeTotal + bonus - deductions),
    paidOvertimeMinutes,
  };
}

/* ------------------------------------------------------------ month math */

/** The slice of state the payroll engine reads. */
export type PayrollState = Pick<
  WorkforceState,
  | "attendance"
  | "shifts"
  | "shiftAssignments"
  | "users"
  | "comp"
  | "payPolicy"
  | "payrollRuns"
  | "travelSessions"
  | "petrolRules"
  | "foodRules"
  | "allowanceDecisions"
>;

export interface MonthSummary {
  employeeId: string;
  month: string;
  comp: CompRecord | null;
  presentDays: number;
  /** Scheduled working days of the month per the shift's working-day set. */
  workingDays: number;
  absentDays: number;
  totalMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  paidOvertimeMinutes: number;
  lateMinutes: number;
  breakMinutes: number;
  unpaidBreakMinutes: number;
  basePay: number;
  overtimePay: number;
  bonus: number;
  /** Reimbursements — deliberately separate from salary (spec §24). */
  travelMeters: number;
  eligibleTravelMeters: number;
  petrolAllowance: number;
  foodAllowance: number;
  deductions: number;
  adjustments: number;
  netPay: number;
  days: Array<{ att: Attendance; pay: DayPay }>;
}

/** Every attendance day of a month for one employee, priced and summed. */
export function monthSummary(
  s: PayrollState,
  employeeId: string,
  month: string,
  now = Date.now(),
): MonthSummary {
  const days = s.attendance
    .filter(
      (a) => a.employeeId === employeeId && a.date.startsWith(month) && a.checkIn,
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((att) => ({ att, pay: dayPay(s, att, now) }));

  const run = (s.payrollRuns ?? []).find((r) => r.month === month);
  const adjustments = (run?.adjustments ?? [])
    .filter((a) => a.employeeId === employeeId)
    .reduce((t, a) => t + a.amount, 0);

  const sum = (f: (d: { att: Attendance; pay: DayPay }) => number) =>
    days.reduce((t, d) => t + f(d), 0);

  const shift = shiftFor(s, employeeId, `${month}-15`);
  const workingDays = shift ? workingDaysInMonth(month, shift.workingDays) : 26;
  const comp = compFor(s, employeeId, `${month}-28`);

  const basePay = sum((d) => d.pay.base);
  const overtimePayTotal = sum((d) => d.pay.overtimePay);
  const bonus = sum((d) => d.pay.bonus);
  const deductions = sum((d) => d.pay.deductions);

  // Reimbursements ride alongside pay, never inside it: petrol and food are
  // summed per attendance day from the same rules the screens show.
  const allowancesByDay = days.map((d) => dayAllowances(s, d.att));
  const travelMeters = allowancesByDay.reduce((t, a) => t + a.travelMeters, 0);
  const eligibleTravelMeters = allowancesByDay.reduce(
    (t, a) => t + a.eligibleMeters,
    0,
  );
  const petrolAllowance = allowancesByDay.reduce((t, a) => t + a.travelAmount, 0);
  const foodAllowance = allowancesByDay.reduce((t, a) => t + a.foodAmount, 0);

  return {
    employeeId,
    month,
    comp,
    presentDays: days.length,
    workingDays,
    absentDays: Math.max(0, workingDays - days.length),
    totalMinutes: sum((d) => d.pay.metrics.netMinutes),
    regularMinutes: sum((d) => d.pay.metrics.regularMinutes),
    overtimeMinutes: sum((d) => d.pay.metrics.overtimeMinutes),
    paidOvertimeMinutes: sum((d) => d.pay.paidOvertimeMinutes),
    lateMinutes: sum((d) => d.pay.metrics.lateMinutes),
    breakMinutes: sum((d) => d.pay.metrics.breaks.totalMinutes),
    unpaidBreakMinutes: sum((d) => d.pay.metrics.breaks.unpaidMinutes),
    basePay: r2(basePay),
    overtimePay: r2(overtimePayTotal),
    bonus: r2(bonus),
    travelMeters: Math.round(travelMeters),
    eligibleTravelMeters: Math.round(eligibleTravelMeters),
    petrolAllowance: r2(petrolAllowance),
    foodAllowance: r2(foodAllowance),
    deductions: r2(deductions),
    adjustments: r2(adjustments),
    netPay: r2(
      basePay +
        overtimePayTotal +
        bonus +
        petrolAllowance +
        foodAllowance -
        deductions +
        adjustments,
    ),
    days,
  };
}

/** Count the month's days that fall on the shift's working weekdays. */
export function workingDaysInMonth(month: string, workingDays: number[]): number {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = 1; d <= total; d++) {
    if (workingDays.includes(new Date(y, m - 1, d).getDay())) n++;
  }
  return n;
}

/* --------------------------------------------------------------- helpers */

/** The current payroll run for a month, or an implicit draft. */
export function runFor(
  s: Pick<WorkforceState, "payrollRuns">,
  month: string,
): PayrollRun | null {
  return (s.payrollRuns ?? []).find((r) => r.month === month) ?? null;
}

/** Whether attendance/salary edits for this month must go through adjustments. */
export function monthLocked(
  s: Pick<WorkforceState, "payrollRuns">,
  month: string,
): boolean {
  const run = runFor(s, month);
  return run?.status === "locked" || run?.status === "approved";
}

/** "08h 40m" from minutes — the engine's own copy so it stays UI-free. */
export function fmtHM(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h > 0 ? `${String(h).padStart(2, "0")}h ${String(m % 60).padStart(2, "0")}m` : `${m % 60}m`;
}

/** ₹ formatting, Indian grouping, no paise unless present. */
export function fmtINR(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `₹${rounded.toLocaleString("en-IN", {
    maximumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
  })}`;
}

/* -------------------------------------------------------- live dashboard */

/** Today's shift/OT/labour-cost KPIs for the manager dashboard (spec §22). */
export function todayShiftKpis(
  s: Pick<
    WorkforceState,
    "attendance" | "shifts" | "shiftAssignments" | "users" | "comp" | "payPolicy"
  >,
  now = Date.now(),
) {
  const today = todayISO(now);
  const todays = s.attendance.filter((a) => a.date === today && a.checkIn);
  let onBreak = 0;
  let inOvertime = 0;
  let otMinutesToday = 0;
  let labourCostToday = 0;
  let otCostToday = 0;
  for (const att of todays) {
    const pay = dayPay(s, att, now);
    if (att.breaks?.some((b) => !b.end)) onBreak++;
    if (pay.metrics.open && pay.metrics.overtimeMinutes > 0.5) inOvertime++;
    otMinutesToday += pay.metrics.overtimeMinutes;
    labourCostToday += pay.total;
    otCostToday += pay.overtimePay;
  }
  const pendingApprovals = s.attendance.filter(
    (a) => a.overtime?.status === "pending",
  ).length;
  return {
    onBreak,
    inOvertime,
    otMinutesToday: Math.round(otMinutesToday),
    labourCostToday: Math.round(labourCostToday),
    otCostToday: Math.round(otCostToday),
    pendingApprovals,
  };
}

/* ----------------------------------------------------------------- export */

/** The payroll export table, one row per employee (spec §19). The same
    headers and rows feed CSV, Excel and the printed PDF, so the three
    formats can never disagree. */
export function payrollTable(
  s: PayrollState & Pick<WorkforceState, "projects">,
  month: string,
  employeeIds: string[],
): { headers: string[]; rows: Array<Array<string | number>> } {
  const headers = [
    "Employee ID",
    "Employee Name",
    "Project",
    "Shift",
    "Working Days",
    "Present Days",
    "Absent Days",
    "Total Hours",
    "Regular Hours",
    "Overtime Hours",
    "Late Hours",
    "Break Hours",
    "Base Salary",
    "Overtime Pay",
    "Bonus",
    "Petrol Allowance",
    "Food Allowance",
    "Deductions",
    "Adjustments",
    "Net Pay",
  ];
  const rows = employeeIds.map((id) => {
    const u = s.users.find((x) => x.id === id);
    const m = monthSummary(s, id, month);
    const shift = shiftFor(s, id, `${month}-15`);
    const project = s.projects.find((p) => u?.projectIds.includes(p.id));
    const h = (min: number) => (min / 60).toFixed(2);
    return [
      u?.employeeCode ?? id,
      u?.name ?? "",
      project?.name ?? "",
      shift?.name ?? "",
      m.workingDays,
      m.presentDays,
      m.absentDays,
      h(m.totalMinutes),
      h(m.regularMinutes),
      h(m.paidOvertimeMinutes),
      h(m.lateMinutes),
      h(m.breakMinutes),
      m.basePay,
      m.overtimePay,
      m.bonus,
      m.petrolAllowance,
      m.foodAllowance,
      m.deductions,
      m.adjustments,
      m.netPay,
    ];
  });
  return { headers, rows };
}

export function payrollCSV(
  s: Parameters<typeof payrollTable>[0],
  month: string,
  employeeIds: string[],
): string {
  const { headers, rows } = payrollTable(s, month, employeeIds);
  return [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
