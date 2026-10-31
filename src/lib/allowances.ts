/**
 * Travel & allowance engine.
 *
 * Two reimbursements, both derived rather than stored: petrol allowance from
 * the distance of an approved travel session, and food allowance from a
 * verified check-in landing inside a configured window. As with payroll, no
 * computed rupee is persisted — the amount is recalculated from the rule and
 * the record every time it is read, so a figure on screen can never disagree
 * with the evidence behind it. What *is* stored is human judgement: a
 * manager's approval, rejection, or edited distance.
 *
 * The governing rule (spec §1, §7): movement is not travel. Only points
 * captured while a session the worker deliberately started was running are
 * ever measured, so a day spent walking around a site earns nothing.
 */

import { distanceMeters } from "./geo";
import { todayISO } from "./format";
import type {
  AllowanceDecision,
  Attendance,
  FoodRule,
  LocationPoint,
  PetrolRule,
  TravelFlag,
  TravelSession,
  User,
  VehicleType,
  WorkforceState,
} from "./types";

/* -------------------------------------------------------------- sanitiser */

/**
 * Thresholds for believing a GPS reading. Deliberately generous — the cost
 * of discarding a real kilometre is a worker out of pocket, and the cost of
 * accepting a bad one is a flag a manager can see and correct.
 */
const MAX_ACCURACY_M = 80;
/** Above this speed between two fixes, the pair is a teleport, not a drive. */
const MAX_SPEED_KMH = 160;
/** Under this, the difference is drift while parked, not distance travelled. */
const MIN_STEP_M = 12;
/** A silence longer than this is a gap: the route between is unmeasured. */
const MAX_GAP_MS = 6 * 60_000;

export interface SanitisedTrack {
  /** Metres the engine is willing to stand behind. */
  meters: number;
  flags: TravelFlag[];
  /** Points that survived, in order — what the route polyline should draw. */
  points: LocationPoint[];
}

/**
 * Measure a travel trail, rejecting what GPS gets wrong.
 *
 * Every rejection is recorded rather than silently dropped: a manager
 * reviewing a trip sees "3 readings ignored" and why, which is the
 * difference between a system that is trusted and one that is argued with.
 */
export function sanitiseTrack(raw: LocationPoint[]): SanitisedTrack {
  const sorted = [...raw].sort((a, b) => a.at - b.at);
  const flags: TravelFlag[] = [];
  const points: LocationPoint[] = [];
  let meters = 0;
  let lowAccuracy = 0;
  let prev: LocationPoint | null = null;

  for (const p of sorted) {
    if (p.accuracy > MAX_ACCURACY_M) {
      lowAccuracy++;
      continue;
    }
    if (!prev) {
      points.push(p);
      prev = p;
      continue;
    }

    const gap = p.at - prev.at;
    const step = distanceMeters(
      { lat: prev.lat, lng: prev.lng },
      { lat: p.lat, lng: p.lng },
    );

    if (gap > MAX_GAP_MS) {
      // The phone was off, offline or out of signal. The straight line across
      // the gap is not a measured route, so it is noted and not counted.
      flags.push({
        at: p.at,
        kind: "gps-gap",
        detail: `${Math.round(gap / 60000)} min without a fix — ${fmtKm(step)} across the gap not counted`,
      });
      points.push({ ...p, segmentStart: true });
      prev = p;
      continue;
    }

    const kmh = gap > 0 ? step / 1000 / (gap / 3_600_000) : 0;
    if (kmh > MAX_SPEED_KMH) {
      flags.push({
        at: p.at,
        kind: "gps-jump",
        detail: `${fmtKm(step)} in ${Math.round(gap / 1000)}s (${Math.round(kmh)} km/h) — reading ignored`,
      });
      continue;
    }
    if (step < MIN_STEP_M) {
      // Stationary: drift around a parked vehicle, not travel.
      continue;
    }

    meters += step;
    points.push(p);
    prev = p;
  }

  if (lowAccuracy > 0) {
    flags.push({
      at: sorted[sorted.length - 1]?.at ?? Date.now(),
      kind: "low-accuracy",
      detail: `${lowAccuracy} reading${lowAccuracy === 1 ? "" : "s"} worse than ±${MAX_ACCURACY_M}m ignored`,
    });
  }

  return { meters, flags, points };
}

const fmtKm = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

/** Trail points belonging to one travel session. */
export function travelPoints(
  s: Pick<WorkforceState, "points">,
  sessionId: string,
): LocationPoint[] {
  return s.points
    .filter((p) => p.travelSessionId === sessionId)
    .sort((a, b) => a.at - b.at);
}

/**
 * Measure one run from where it started.
 *
 * The trail only holds fixes taken after Start was pressed, so measuring the
 * trail alone dropped the first leg — from the start anchor to the first
 * fix — and a short run could close at 0 km after the worker had plainly
 * moved. The anchor is the run's first point.
 */
export function runTrack(
  s: Pick<WorkforceState, "points">,
  session: TravelSession,
): SanitisedTrack {
  const anchor: LocationPoint = {
    id: `${session.id}-start`,
    attendanceId: session.attendanceId ?? "",
    employeeId: session.employeeId,
    projectId: session.projectId,
    lat: session.start.coords.lat,
    lng: session.start.coords.lng,
    accuracy: 0,
    speed: 0,
    heading: 0,
    at: session.start.at,
    travelSessionId: session.id,
  };
  return sanitiseTrack([anchor, ...travelPoints(s, session.id)]);
}

/* ---------------------------------------------------------------- lookups */

/** Whether a rule's scope covers this person on this project. */
function scopeCovers(
  rule: { projectIds: string[]; employeeIds: string[] },
  employeeId: string,
  projectId: string,
): boolean {
  const projectOk =
    rule.projectIds.length === 0 || rule.projectIds.includes(projectId);
  const employeeOk =
    rule.employeeIds.length === 0 || rule.employeeIds.includes(employeeId);
  return projectOk && employeeOk;
}

/**
 * The petrol rule in force for one person's vehicle on a date.
 *
 * Narrowest wins: a rule naming this employee beats one naming their
 * project, which beats an organisation-wide default — so a client can set a
 * house rate and still pay one driver differently without cloning the policy.
 */
export function petrolRuleFor(
  s: Pick<WorkforceState, "petrolRules">,
  employeeId: string,
  projectId: string,
  vehicleType: VehicleType,
  date: string,
): PetrolRule | null {
  const matching = (s.petrolRules ?? []).filter(
    (r) =>
      r.effectiveFrom <= date &&
      r.vehicleType === vehicleType &&
      scopeCovers(r, employeeId, projectId),
  );
  // Only the newest version of each rule in force on that date counts, and
  // an archived version ends its line from its own date — older trips keep
  // the version that priced them (see `savePetrolRule`).
  const candidates = matching.filter(
    (r) =>
      r.status === "active" &&
      !matching.some(
        (q) => q !== r && sameRuleLine(q, r) && q.effectiveFrom > r.effectiveFrom,
      ),
  );
  if (candidates.length === 0) return null;
  const specificity = (r: PetrolRule) =>
    (r.employeeIds.length ? 2 : 0) + (r.projectIds.length ? 1 : 0);
  return candidates.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      (a.effectiveFrom < b.effectiveFrom ? 1 : -1),
  )[0];
}

const scopeKey = (ids: string[]) => [...ids].sort().join(",");

/** Two petrol rules are versions of one line when they cover exactly the same people. */
export function sameRuleLine(a: PetrolRule, b: PetrolRule): boolean {
  return (
    a.vehicleType === b.vehicleType &&
    scopeKey(a.projectIds) === scopeKey(b.projectIds) &&
    scopeKey(a.employeeIds) === scopeKey(b.employeeIds)
  );
}

/**
 * The petrol rules in force today — one per line, the newest version.
 * Earlier versions stay on the record to price the trips made under them.
 */
export function currentPetrolRules(
  rules: PetrolRule[],
  today = todayISO(),
): PetrolRule[] {
  const started = rules.filter((r) => r.effectiveFrom <= today);
  return rules.filter(
    (r) =>
      r.status === "active" &&
      !started.some(
        (q) => q !== r && sameRuleLine(q, r) && q.effectiveFrom > r.effectiveFrom,
      ),
  );
}

/** Food rules that could apply to this person, project and shift on a date. */
export function foodRulesFor(
  s: Pick<WorkforceState, "foodRules">,
  employeeId: string,
  projectId: string,
  shiftId: string | undefined,
  date: string,
): FoodRule[] {
  return (s.foodRules ?? [])
    .filter(
      (r) =>
        r.status === "active" &&
        r.effectiveFrom <= date &&
        scopeCovers(r, employeeId, projectId) &&
        (r.shiftIds.length === 0 || (shiftId ? r.shiftIds.includes(shiftId) : false)),
    )
    .sort((a, b) => a.startMinute - b.startMinute);
}

function decisionFor(
  s: Pick<WorkforceState, "allowanceDecisions">,
  employeeId: string,
  date: string,
  ruleId: string,
): AllowanceDecision | null {
  return (
    (s.allowanceDecisions ?? [])
      .filter(
        (d) =>
          d.employeeId === employeeId && d.date === date && d.ruleId === ruleId,
      )
      .sort((a, b) => a.at - b.at)
      .pop() ?? null
  );
}

/* ----------------------------------------------------------------- travel */

export interface TravelAllowance {
  session: TravelSession;
  rule: PetrolRule | null;
  /** Measured metres (manager's edit wins when they made one). */
  meters: number;
  /** Metres that survived the daily cap. */
  eligibleMeters: number;
  ratePerKm: number;
  amount: number;
  /** Non-null when a ceiling trimmed the claim, for the "why" line. */
  cappedBy: "distance" | "amount" | null;
  /** Payable now — pending approval earns nothing yet. */
  payable: boolean;
  why: string;
}

/**
 * Price one travel session against the rule that covers it.
 *
 * `priorMetersToday` lets the caller apply a daily ceiling across several
 * runs: the first trip of the day uses the whole allowance, the second only
 * what is left (spec §11).
 */
export function travelAllowance(
  s: Pick<WorkforceState, "petrolRules">,
  session: TravelSession,
  priorMetersToday = 0,
  liveMeters?: number,
): TravelAllowance {
  const rule = petrolRuleFor(
    s,
    session.employeeId,
    session.projectId,
    session.vehicleType,
    session.date,
  );
  // A run still going has no stored distance yet; the caller measures it
  // live so the page and the shift screen show the same number.
  const meters =
    session.status === "active" && liveMeters != null
      ? liveMeters
      : (session.approvedMeters ?? session.distanceMeters);

  if (session.status === "rejected") {
    // Kept on the record so the worker and the reports can see it and why;
    // it earns nothing and takes nothing from the day's cap.
    return {
      session,
      rule,
      meters,
      eligibleMeters: 0,
      ratePerKm: rule?.ratePerKm ?? 0,
      amount: 0,
      cappedBy: null,
      payable: false,
      why: `Not approved${session.decisionNote ? ` — ${session.decisionNote}` : ""}`,
    };
  }

  if (!rule) {
    return {
      session,
      rule: null,
      meters,
      eligibleMeters: 0,
      ratePerKm: 0,
      amount: 0,
      cappedBy: null,
      payable: false,
      why:
        session.vehicleType === "none"
          ? "No vehicle assigned, so no petrol rate applies."
          : "No petrol allowance rule covers this trip.",
    };
  }

  let eligibleMeters = meters;
  let cappedBy: TravelAllowance["cappedBy"] = null;

  if (rule.maxDailyKm !== null) {
    const remaining = Math.max(0, rule.maxDailyKm * 1000 - priorMetersToday);
    if (eligibleMeters > remaining) {
      eligibleMeters = remaining;
      cappedBy = "distance";
    }
  }

  let amount = round2((eligibleMeters / 1000) * rule.ratePerKm);
  if (rule.maxDailyAmount !== null && amount > rule.maxDailyAmount) {
    amount = rule.maxDailyAmount;
    cappedBy = "amount";
  }

  const payable =
    session.status === "approved" ||
    (session.status === "pending" && rule.approval === "auto");

  const base = `${(eligibleMeters / 1000).toFixed(1)} km × ₹${rule.ratePerKm}/km`;
  const why =
    cappedBy === "distance"
      ? `${base} — capped at ${rule.maxDailyKm} km/day (travelled ${(meters / 1000).toFixed(1)} km)`
      : cappedBy === "amount"
        ? `${base}, capped at ₹${rule.maxDailyAmount}/day`
        : base;

  return {
    session,
    rule,
    meters,
    eligibleMeters,
    ratePerKm: rule.ratePerKm,
    amount,
    cappedBy,
    payable,
    why,
  };
}

/**
 * Every travel session on one date for one person, priced in order.
 *
 * Rejected runs are left out of the money by default; the history and the
 * reports ask for them with `includeRejected`, so a decision never makes a
 * trip vanish from the record (they price at zero and use none of the cap).
 * Pass `points` to measure a run that is still going.
 */
export function travelAllowancesForDay(
  s: Pick<WorkforceState, "petrolRules" | "travelSessions"> &
    Partial<Pick<WorkforceState, "points">>,
  employeeId: string,
  date: string,
  opts: { includeRejected?: boolean } = {},
): TravelAllowance[] {
  const sessions = (s.travelSessions ?? [])
    .filter(
      (t) =>
        t.employeeId === employeeId &&
        t.date === date &&
        (opts.includeRejected || t.status !== "rejected"),
    )
    .sort((a, b) => a.start.at - b.start.at);

  const out: TravelAllowance[] = [];
  let prior = 0;
  for (const session of sessions) {
    const live =
      session.status === "active" && s.points
        ? runTrack({ points: s.points }, session).meters
        : undefined;
    const a = travelAllowance(s, session, prior, live);
    prior += a.eligibleMeters;
    out.push(a);
  }
  return out;
}

/* ------------------------------------------------------------------- food */

export interface FoodAllowance {
  rule: FoodRule;
  amount: number;
  eligible: boolean;
  /** Payable now — a rule needing approval earns nothing until granted. */
  payable: boolean;
  status: "auto" | "pending" | "approved" | "rejected" | "not-eligible";
  why: string;
}

/** Minutes from midnight of a timestamp, in the device's local calendar. */
function minuteOfDay(at: number): number {
  const d = new Date(at);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Food allowances earned by one attendance day.
 *
 * Eligibility is decided by the verified attendance mark alone — a real
 * geofenced check-in, with its selfie and timestamp — never by a typed-in
 * arrival time (spec §18). A day with no valid check-in earns nothing.
 */
export function foodAllowancesFor(
  s: Pick<
    WorkforceState,
    "foodRules" | "allowanceDecisions" | "shifts" | "shiftAssignments" | "users"
  >,
  att: Attendance,
): FoodAllowance[] {
  const rules = foodRulesFor(
    s,
    att.employeeId,
    att.projectId,
    att.shiftId,
    att.date,
  );

  return rules.map((rule) => {
    const mark = rule.trigger === "check-in" ? att.checkIn : att.checkOut;
    const window = `${fmtMinute(rule.startMinute)} – ${fmtMinute(rule.endMinute)}`;

    if (!mark) {
      return {
        rule,
        amount: 0,
        eligible: false,
        payable: false,
        status: "not-eligible" as const,
        why: `No ${rule.trigger === "check-in" ? "check-in" : "checkout"} recorded.`,
      };
    }
    if (!mark.insideGeofence) {
      return {
        rule,
        amount: 0,
        eligible: false,
        payable: false,
        status: "not-eligible" as const,
        why: `${rule.trigger === "check-in" ? "Check-in" : "Checkout"} was outside the site boundary.`,
      };
    }

    const minute = minuteOfDay(mark.at);
    // A window that closes "before" it opens runs across midnight — a night
    // meal from 11 pm to 1 am.
    const inWindow =
      rule.endMinute >= rule.startMinute
        ? minute >= rule.startMinute && minute <= rule.endMinute
        : minute >= rule.startMinute || minute <= rule.endMinute;
    if (!inWindow) {
      return {
        rule,
        amount: 0,
        eligible: false,
        payable: false,
        status: "not-eligible" as const,
        why: `${fmtMinute(minute)} is outside the ${window} window.`,
      };
    }

    const decision = decisionFor(s, att.employeeId, att.date, rule.id);
    if (decision?.status === "rejected") {
      return {
        rule,
        amount: 0,
        eligible: true,
        payable: false,
        status: "rejected" as const,
        why: decision.note ?? `Not approved by the manager.`,
      };
    }
    const approved = decision?.status === "approved";
    const needsApproval = rule.approval === "manager" && !approved;

    return {
      rule,
      amount: needsApproval ? 0 : rule.amount,
      eligible: true,
      payable: !needsApproval,
      status: needsApproval ? "pending" : approved ? "approved" : "auto",
      why: needsApproval
        ? `${fmtMinute(minute)} is inside ${window} — awaiting approval`
        : `${rule.trigger === "check-in" ? "Checked in" : "Checked out"} ${fmtMinute(minute)}, inside ${window}`,
    };
  });
}

/** "06:47 am" from minutes-from-midnight. */
export function fmtMinute(m: number): string {
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(Math.round(m) % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 < 12 ? "am" : "pm"}`;
}

/* --------------------------------------------------------------- day roll */

export interface DayAllowances {
  travel: TravelAllowance[];
  food: FoodAllowance[];
  travelMeters: number;
  eligibleMeters: number;
  travelAmount: number;
  foodAmount: number;
  total: number;
  /** Anything a manager still has to decide. */
  pending: number;
}

/** Both allowances for one attendance day, with their totals. */
export function dayAllowances(
  s: Pick<
    WorkforceState,
    | "petrolRules"
    | "travelSessions"
    | "foodRules"
    | "allowanceDecisions"
    | "shifts"
    | "shiftAssignments"
    | "users"
  > &
    Partial<Pick<WorkforceState, "attendance">>,
  att: Attendance,
): DayAllowances {
  // The cap is daily, so the whole day is priced in order — but each run
  // belongs to the shift it happened in. A second check-in the same day
  // used to show (and pay) the morning's travel again on the evening shift.
  const sameDay = (s.attendance ?? [])
    .filter((a) => a.employeeId === att.employeeId && a.date === att.date)
    .sort((a, b) => (a.checkIn?.at ?? 0) - (b.checkIn?.at ?? 0));
  const known = new Set(sameDay.map((a) => a.id));
  const scoped = known.has(att.id);
  const ownsUntagged = sameDay[0]?.id === att.id;
  const travel = travelAllowancesForDay(s, att.employeeId, att.date).filter(
    (t) =>
      !scoped ||
      (t.session.attendanceId && known.has(t.session.attendanceId)
        ? t.session.attendanceId === att.id
        : ownsUntagged),
  );
  const food = foodAllowancesFor(s, att);
  const travelAmount = travel
    .filter((t) => t.payable)
    .reduce((sum, t) => sum + t.amount, 0);
  const foodAmount = food
    .filter((f) => f.payable)
    .reduce((sum, f) => sum + f.amount, 0);
  return {
    travel,
    food,
    travelMeters: travel.reduce((sum, t) => sum + t.meters, 0),
    eligibleMeters: travel.reduce((sum, t) => sum + t.eligibleMeters, 0),
    travelAmount: round2(travelAmount),
    foodAmount: round2(foodAmount),
    total: round2(travelAmount + foodAmount),
    pending:
      travel.filter((t) => t.session.status === "pending" && !t.payable).length +
      food.filter((f) => f.status === "pending").length,
  };
}

/* ------------------------------------------------------------- dashboards */

/** Today's travel across the workforce, for the manager dashboard (§13). */
export function travelKpis(
  s: Pick<
    WorkforceState,
    "travelSessions" | "petrolRules" | "users" | "points"
  >,
  now = Date.now(),
) {
  const today = todayISO(now);
  const sessions = (s.travelSessions ?? []).filter((t) => t.date === today);
  const byEmployee = new Map<string, TravelAllowance[]>();
  for (const employeeId of new Set(sessions.map((t) => t.employeeId))) {
    byEmployee.set(
      employeeId,
      travelAllowancesForDay({ ...s, travelSessions: sessions }, employeeId, today),
    );
  }
  const all = [...byEmployee.values()].flat();
  const pending = (s.travelSessions ?? []).filter((t) => t.status === "pending");
  return {
    travelling: sessions.filter((t) => t.status === "active").length,
    trips: sessions.length,
    meters: all.reduce((t, a) => t + a.meters, 0),
    eligibleMeters: all.reduce((t, a) => t + a.eligibleMeters, 0),
    amount: round2(all.filter((a) => a.payable).reduce((t, a) => t + a.amount, 0)),
    // The approvals queue spans days, so what is flagged is counted over the
    // same set — saying "all clean" about today while yesterday's flagged
    // trip still waits is worse than showing no sub-label at all.
    pendingApprovals: pending.length,
    flagged: pending.filter((t) => t.flags.length > 0).length,
  };
}

/** The vehicle a person travels in — "none" when they have not been given one. */
export function vehicleOf(user: User | undefined): VehicleType {
  return user?.vehicle?.type ?? "none";
}

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  "two-wheeler": "Two wheeler",
  "four-wheeler": "Four wheeler",
  none: "No vehicle",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Kilometres, for display. */
export function fmtKmLabel(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}
