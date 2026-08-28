"use client";

/**
 * Payroll — the month's attendance priced by the engine, reviewed by a
 * human, and walked through Draft → Calculated → Review → Approved →
 * Locked. Nothing here stores a computed rupee: every figure is recomputed
 * from attendance + shift + break + compensation rules on render, so the
 * table can never disagree with the records it summarises. What IS stored
 * is human judgement — overtime decisions, adjustments, the lock.
 */

import { useMemo, useState } from "react";
import { FeatureGate } from "@/components/FeatureGate";
import { ScreenHeader } from "@/components/shell";
import { Avatar, BottomSheet, Chip, Field, KpiCard } from "@/components/ui";
import {
  fmtDateLong,
  fmtDuration,
  fmtShiftTime,
  fmtTime,
} from "@/lib/format";
import {
  dayPay,
  fmtINR,
  monthSummary,
  payrollCSV,
  payrollTable,
  runFor,
  shiftFor,
  type MonthSummary,
} from "@/lib/payroll";
import { downloadCSV, downloadExcel, printReport } from "@/lib/reports";
import { useWorkforce } from "@/lib/store";
import type { Attendance, PayrollStatus, User } from "@/lib/types";
import {
  ICheckCircle,
  IChevronL,
  IChevronR,
  IClock,
  IDownload,
  ILock,
  IWallet,
} from "@/components/WfIcons";

const STATUS_FLOW: PayrollStatus[] = [
  "draft",
  "calculated",
  "review",
  "approved",
  "locked",
];
const STATUS_LABEL: Record<PayrollStatus, string> = {
  draft: "Draft",
  calculated: "Calculated",
  review: "Manager review",
  approved: "Approved",
  locked: "Locked",
};

const monthISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export default function ManagerPayroll() {
  const wf = useWorkforce();
  const { state } = wf;
  const [month, setMonth] = useState(() => monthISO(new Date()));
  const [detail, setDetail] = useState<{ user: User; summary: MonthSummary } | null>(null);
  const [dayDetail, setDayDetail] = useState<Attendance | null>(null);
  const [adjusting, setAdjusting] = useState<User | null>(null);

  const people = useMemo(
    () =>
      state.users
        .filter((u) => u.role !== "superadmin" && u.status === "active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.users],
  );

  const rows = useMemo(
    () =>
      people
        .map((user) => ({ user, summary: monthSummary(state, user.id, month) }))
        .filter((r) => r.summary.presentDays > 0 || r.summary.comp),
    [people, state, month],
  );

  const run = runFor(state, month);
  const status: PayrollStatus = run?.status ?? "draft";
  const locked = status === "locked";

  const totals = useMemo(
    () => ({
      net: rows.reduce((t, r) => t + r.summary.netPay, 0),
      ot: rows.reduce((t, r) => t + r.summary.overtimePay, 0),
      otMinutes: rows.reduce((t, r) => t + r.summary.paidOvertimeMinutes, 0),
      deductions: rows.reduce((t, r) => t + r.summary.deductions, 0),
    }),
    [rows],
  );

  /* OT decisions waiting on a manager, any month — surfaced here. */
  const pendingOT = useMemo(
    () =>
      state.attendance
        .filter((a) => a.overtime?.status === "pending")
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [state.attendance],
  );

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(monthISO(new Date(y, m - 1 + delta, 1)));
  };

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(status) + 1];

  /* Export — three formats off the same table, each logged (spec §25). */
  const employeeIds = rows.map((r) => r.user.id);
  const exportCSV = () => {
    downloadCSV(`payroll-${month}.csv`, payrollCSV(state, month, employeeIds));
    wf.logAudit("payroll.export", month, "CSV");
  };
  const exportExcel = () => {
    const t = payrollTable(state, month, employeeIds);
    downloadExcel(`payroll-${month}.xls`, `Payroll ${month}`, t.headers, t.rows);
    wf.logAudit("payroll.export", month, "Excel");
  };
  const exportPDF = () => {
    const t = payrollTable(state, month, employeeIds);
    const kpi = (label: string, value: string) =>
      `<div class="kpi"><b>${value}</b><span>${label}</span></div>`;
    printReport(
      `Payroll — ${monthLabel}`,
      `<div class="kpis">
        ${kpi("Net payroll", fmtINR(totals.net))}
        ${kpi("Overtime hours", fmtDuration(totals.otMinutes))}
        ${kpi("Overtime cost", fmtINR(totals.ot))}
        ${kpi("Deductions", fmtINR(totals.deductions))}
        ${kpi("Status", STATUS_LABEL[status])}
      </div>
      <table><tr>${t.headers.map((h) => `<th>${h}</th>`).join("")}</tr>
      ${t.rows
        .map(
          (r) =>
            `<tr>${r
              .map(
                (c, i) =>
                  `<td style="${typeof c === "number" ? "text-align:right;font-variant-numeric:tabular-nums" : ""}">${
                    typeof c === "number" && i >= 12 ? fmtINR(c) : String(c)
                  }</td>`,
              )
              .join("")}</tr>`,
        )
        .join("")}
      </table>`,
    );
    wf.logAudit("payroll.export", month, "PDF");
  };

  return (
    <div>
      {/* Three export buttons in the header action slot left the title about
          180px and broke "August 2026 · Draft" across two lines. They get
          their own row, beside the data they export. */}
      <ScreenHeader title="Payroll" sub={`${monthLabel} · ${STATUS_LABEL[status]}`} />

      <div className="flex flex-col gap-4 px-4">
        <FeatureGate feature="payroll">
          {/* month picker + workflow */}
          <div className="wf-card flex items-center justify-between p-3.5">
            <button
              aria-label="Previous month"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg bg-[var(--wf-surface2)]"
              onClick={() => shiftMonth(-1)}
            >
              <IChevronL size={16} />
            </button>
            <div className="text-center">
              <p className="wf-display font-bold">{monthLabel}</p>
              <div className="mt-1 flex items-center justify-center gap-1">
                {STATUS_FLOW.map((s, i) => (
                  <span
                    key={s}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: s === status ? 22 : 8,
                      background:
                        i <= STATUS_FLOW.indexOf(status)
                          ? s === "locked" && locked
                            ? "var(--wf-green)"
                            : "var(--wf-amber)"
                          : "var(--wf-line-strong)",
                    }}
                  />
                ))}
              </div>
            </div>
            <button
              aria-label="Next month"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg bg-[var(--wf-surface2)]"
              onClick={() => shiftMonth(1)}
            >
              <IChevronR size={16} />
            </button>
          </div>

          {/* export — one row, equal thirds, so no label is ever clipped */}
          <div className="grid grid-cols-3 gap-2">
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={exportCSV}>
              <IDownload size={14} /> CSV
            </button>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={exportExcel}>
              <IDownload size={14} /> Excel
            </button>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={exportPDF}>
              <IDownload size={14} /> PDF
            </button>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <KpiCard label="Net payroll" value={fmtINR(totals.net)} tone="green" icon={<IWallet size={16} />} />
            <KpiCard label="OT hours" value={fmtDuration(totals.otMinutes)} tone="blue" icon={<IClock size={16} />} />
            <KpiCard label="OT cost" value={fmtINR(totals.ot)} tone="amber" />
            <KpiCard label="Deductions" value={fmtINR(totals.deductions)} tone="red" />
          </div>

          {/* pending overtime approvals */}
          {pendingOT.length > 0 ? (
            <div className="wf-card p-4">
              <h2 className="wf-display mb-3 text-sm font-bold">
                Pending overtime approvals ({pendingOT.length})
              </h2>
              <div className="flex flex-col gap-3">
                {pendingOT.map((a) => (
                  <OvertimeApprovalRow key={a.id} att={a} />
                ))}
              </div>
            </div>
          ) : null}

          {/* the monthly table */}
          <div className="wf-card overflow-hidden">
            <div className="wf-scroll-x">
              <table className="wf-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="text-right">Days</th>
                    <th className="text-right">Hours</th>
                    <th className="text-right">OT</th>
                    <th className="text-right">Bonus</th>
                    <th className="text-right">Allowances</th>
                    <th className="text-right">Deductions</th>
                    <th className="text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ user, summary }) => (
                    <tr
                      key={user.id}
                      data-clickable="true"
                      onClick={() => setDetail({ user, summary })}
                    >
                      <td>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={user.name} hue={user.avatarHue} size={30} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{user.name}</span>
                            <span className="block text-[0.68rem] text-[var(--wf-muted)]">
                              {summary.comp
                                ? `${fmtINR(summary.comp.amount)}/${summary.comp.type === "monthly" ? "mo" : summary.comp.type === "daily" ? "day" : "hr"}`
                                : "No salary configured"}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{summary.presentDays}</td>
                      <td className="text-right tabular-nums">
                        {Math.round(summary.totalMinutes / 60)}h
                      </td>
                      <td className="text-right tabular-nums">
                        {summary.paidOvertimeMinutes > 0
                          ? `${Math.round(summary.paidOvertimeMinutes / 60)}h`
                          : "—"}
                      </td>
                      <td className="text-right tabular-nums">
                        {summary.bonus > 0 ? fmtINR(summary.bonus) : "—"}
                      </td>
                      <td className="text-right tabular-nums">
                        {summary.petrolAllowance + summary.foodAllowance > 0
                          ? fmtINR(summary.petrolAllowance + summary.foodAllowance)
                          : "—"}
                      </td>
                      <td className="text-right tabular-nums text-[var(--wf-red)]">
                        {summary.deductions > 0 ? fmtINR(summary.deductions) : "—"}
                      </td>
                      <td className="text-right font-bold tabular-nums">
                        {fmtINR(summary.netPay)}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-[var(--wf-muted)]">
                        No attendance this month yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {/* workflow */}
          <div className="wf-card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {locked ? (
                  <span className="flex items-center gap-1.5 text-[var(--wf-green)]">
                    <ILock size={15} /> Payroll locked
                  </span>
                ) : (
                  `Status: ${STATUS_LABEL[status]}`
                )}
              </p>
              <p className="mt-0.5 text-[0.76rem] text-[var(--wf-muted)]">
                {locked
                  ? "Corrections now require an adjustment, which is recorded in the audit trail."
                  : "Draft → Calculated → Manager review → Approved → Locked. Locking freezes the month."}
              </p>
            </div>
            {nextStatus && !locked ? (
              <button
                className={`wf-btn wf-btn-sm ${nextStatus === "locked" ? "wf-btn-danger" : "wf-btn-primary"}`}
                onClick={() => wf.setPayrollStatus(month, nextStatus)}
              >
                {nextStatus === "locked" ? (
                  <>
                    <ILock size={14} /> Lock payroll
                  </>
                ) : (
                  <>
                    <ICheckCircle size={14} /> Mark {STATUS_LABEL[nextStatus].toLowerCase()}
                  </>
                )}
              </button>
            ) : null}
          </div>

          {(run?.adjustments.length ?? 0) > 0 ? (
            <div className="wf-card p-4">
              <h2 className="wf-display mb-2 text-sm font-bold">Adjustments</h2>
              <div className="flex flex-col gap-1.5">
                {run!.adjustments.map((a) => {
                  const u = state.users.find((x) => x.id === a.employeeId);
                  return (
                    <p key={a.id} className="text-[0.8rem] text-[var(--wf-muted)]">
                      <span className="font-semibold text-[var(--wf-fg)]">{u?.name}</span>{" "}
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: a.amount >= 0 ? "var(--wf-green)" : "var(--wf-red)" }}
                      >
                        {a.amount >= 0 ? "+" : ""}
                        {fmtINR(a.amount)}
                      </span>{" "}
                      — {a.note}
                    </p>
                  );
                })}
              </div>
            </div>
          ) : null}
        </FeatureGate>
      </div>

      {/* employee month detail */}
      <BottomSheet
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.user.name} — ${monthLabel}` : ""}
        tall
      >
        {detail ? (
          <MonthDetail
            user={detail.user}
            summary={detail.summary}
            onDay={(att) => setDayDetail(att)}
            onAdjust={() => {
              setAdjusting(detail.user);
            }}
          />
        ) : null}
      </BottomSheet>

      {/* daily payroll detail */}
      <BottomSheet
        open={!!dayDetail}
        onClose={() => setDayDetail(null)}
        title={dayDetail ? `Daily payroll — ${fmtDateLong(dayDetail.date)}` : ""}
        tall
      >
        {dayDetail ? <DayDetail att={dayDetail} /> : null}
      </BottomSheet>

      {/* adjustment */}
      <BottomSheet
        open={!!adjusting}
        onClose={() => setAdjusting(null)}
        title={adjusting ? `Adjustment — ${adjusting.name}` : ""}
      >
        {adjusting ? (
          <AdjustmentForm
            month={month}
            employeeId={adjusting.id}
            afterLock={locked}
            onDone={() => setAdjusting(null)}
          />
        ) : null}
      </BottomSheet>
    </div>
  );
}

/* ------------------------------------------------------- OT approvals */

function OvertimeApprovalRow({ att }: { att: Attendance }) {
  const wf = useWorkforce();
  const { state } = wf;
  const user = state.users.find((u) => u.id === att.employeeId);
  const project = state.projects.find((p) => p.id === att.projectId);
  const pay = dayPay(state, att);
  const shift = shiftFor(state, att.employeeId, att.date);
  const [minutes, setMinutes] = useState(att.overtime?.minutes ?? 0);
  if (!att.overtime || !user) return null;

  // What the OT would pay if approved as edited — shown before deciding.
  const estimate =
    pay.comp && shift
      ? dayPay(
          state,
          {
            ...att,
            overtime: { ...att.overtime, status: "approved", approvedMinutes: minutes },
          },
        ).overtimePay
      : 0;

  return (
    <div className="wf-card2 p-3.5">
      <div className="flex items-center gap-2.5">
        <Avatar name={user.name} hue={user.avatarHue} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.88rem] font-semibold">{user.name}</p>
          <p className="truncate text-[0.7rem] text-[var(--wf-muted)]">
            {project?.name} · {fmtDateLong(att.date)}
          </p>
        </div>
        <Chip tone="amber">{fmtDuration(att.overtime.minutes)} OT</Chip>
      </div>
      {/* Label above value, not inline: three inline label+time pairs on a
          phone broke every one of them across a line ("11:00" / "pm"). */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-[0.7rem] text-[var(--wf-muted)] [&>span]:flex [&>span]:flex-col [&>span]:gap-0.5">
        <span>
          Shift end{" "}
          <span className="whitespace-nowrap text-[0.8rem] font-semibold text-[var(--wf-fg)]">
            {shift && shift.kind !== "flexible"
              ? fmtTime(
                  new Date(`${att.date}T00:00:00`).getTime() +
                    (shift.endMinute > shift.startMinute
                      ? shift.endMinute
                      : shift.endMinute + 1440) * 60000,
                )
              : "—"}
          </span>
        </span>
        <span>
          Checked out{" "}
          <span className="whitespace-nowrap text-[0.8rem] font-semibold text-[var(--wf-fg)]">
            {att.checkOut ? fmtTime(att.checkOut.at) : "—"}
          </span>
        </span>
        <span>
          Est. amount{" "}
          <span className="whitespace-nowrap text-[0.8rem] font-semibold text-[var(--wf-green)]">
            {fmtINR(estimate)}
          </span>
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          className="wf-input w-24 text-center"
          type="number"
          min={0}
          max={att.overtime.minutes}
          aria-label="Approved overtime minutes"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value) || 0)}
        />
        <span className="text-[0.74rem] text-[var(--wf-muted)]">min</span>
        <button
          className="wf-btn wf-btn-success wf-btn-sm ml-auto"
          onClick={() =>
            wf.decideOvertime(
              att.id,
              "approved",
              minutes,
              minutes !== att.overtime!.minutes ? "Edited on approval" : undefined,
            )
          }
        >
          Approve
        </button>
        <button
          className="wf-btn wf-btn-ghost wf-btn-sm text-[var(--wf-red)]"
          onClick={() => wf.decideOvertime(att.id, "rejected")}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------- employee month view */

function MonthDetail({
  user,
  summary,
  onDay,
  onAdjust,
}: {
  user: User;
  summary: MonthSummary;
  onDay: (att: Attendance) => void;
  onAdjust: () => void;
}) {
  const rows: Array<[string, string]> = [
    [
      "Base salary",
      summary.comp
        ? `${fmtINR(summary.comp.amount)} / ${summary.comp.type}`
        : "Not configured",
    ],
    ["Attendance", `${summary.presentDays} of ${summary.workingDays} days`],
    ["Late", fmtDuration(summary.lateMinutes)],
    ["Break", fmtDuration(summary.breakMinutes)],
    ["Unpaid break", fmtDuration(summary.unpaidBreakMinutes)],
    ["Overtime", fmtDuration(summary.paidOvertimeMinutes)],
    ...(summary.travelMeters > 0
      ? ([["Travel", `${(summary.eligibleTravelMeters / 1000).toFixed(1)} km eligible`]] as Array<
          [string, string]
        >)
      : []),
  ];
  const money: Array<[string, number]> = [
    ["Earnings", summary.basePay],
    ["Overtime earnings", summary.overtimePay],
    ["Bonus", summary.bonus],
    ["Petrol allowance", summary.petrolAllowance],
    ["Food allowance", summary.foodAllowance],
    ["Deductions", -summary.deductions],
    ["Adjustments", summary.adjustments],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="wf-card2 divide-y divide-[var(--wf-line)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-[0.8rem] text-[var(--wf-muted)]">{label}</span>
            <span className="text-[0.86rem] font-semibold tabular-nums">{value}</span>
          </div>
        ))}
      </div>

      <div className="wf-card2 divide-y divide-[var(--wf-line)]">
        {money
          .filter(([, v]) => v !== 0)
          .map(([label, v]) => (
            <div key={label} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[0.8rem] text-[var(--wf-muted)]">{label}</span>
              <span
                className="text-[0.86rem] font-semibold tabular-nums"
                style={{ color: v < 0 ? "var(--wf-red)" : "var(--wf-fg)" }}
              >
                {v < 0 ? `−${fmtINR(-v)}` : fmtINR(v)}
              </span>
            </div>
          ))}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-bold">Estimated pay</span>
          <span className="wf-display text-lg font-bold tabular-nums text-[var(--wf-green)]">
            {fmtINR(summary.netPay)}
          </span>
        </div>
      </div>

      <button className="wf-btn wf-btn-ghost" onClick={onAdjust}>
        Add adjustment
      </button>

      <div>
        <h3 className="wf-display mb-2 text-sm font-bold">Days</h3>
        <div className="flex flex-col gap-1.5">
          {summary.days.map(({ att, pay }) => (
            <button
              key={att.id}
              className="wf-card2 flex cursor-pointer items-center justify-between px-3.5 py-2.5 text-left hover:border-[var(--wf-line-strong)]"
              onClick={() => onDay(att)}
            >
              <span>
                <span className="block text-[0.84rem] font-semibold">
                  {fmtDateLong(att.date)}
                </span>
                <span className="block text-[0.7rem] tabular-nums text-[var(--wf-muted)]">
                  {fmtDuration(pay.metrics.netMinutes)} net
                  {pay.metrics.overtimeMinutes > 0.5
                    ? ` · ${fmtDuration(pay.metrics.overtimeMinutes)} OT`
                    : ""}
                  {att.voiceNote ? " · 🎙" : ""}
                </span>
              </span>
              <span className="font-bold tabular-nums">{fmtINR(pay.total)}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-center text-[0.7rem] text-[var(--wf-faint)]">
        {user.employeeCode} · every figure is recomputed from attendance and rules
      </p>
    </div>
  );
}

/* ------------------------------------------------------ daily breakdown */

function DayDetail({ att }: { att: Attendance }) {
  const { state } = useWorkforce();
  const pay = dayPay(state, att);
  const m = pay.metrics;
  const facts: Array<[string, string]> = [
    [
      "Shift",
      m.shift.kind === "flexible"
        ? `${Math.round(m.shift.requiredMinutes / 60)}h flexible`
        : `${fmtShiftTime(m.shift.startMinute)} – ${fmtShiftTime(m.shift.endMinute)}`,
    ],
    ["Check-in", att.checkIn ? fmtTime(att.checkIn.at) : "—"],
    ["Check-out", att.checkOut ? fmtTime(att.checkOut.at) : "still open"],
    ["Break", fmtDuration(m.breaks.totalMinutes)],
    ["Net working", fmtDuration(m.netMinutes)],
    ["Late", m.lateMinutes > 0.5 ? fmtDuration(m.lateMinutes) : "—"],
    ["Overtime", m.overtimeMinutes > 0.5 ? fmtDuration(m.overtimeMinutes) : "—"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="wf-card2 divide-y divide-[var(--wf-line)]">
        {facts.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-[0.8rem] text-[var(--wf-muted)]">{label}</span>
            <span className="text-[0.86rem] font-semibold tabular-nums">{value}</span>
          </div>
        ))}
      </div>

      <div>
        <h3 className="wf-display mb-2 text-sm font-bold">Calculation</h3>
        {pay.lines.length === 0 ? (
          <p className="text-sm text-[var(--wf-muted)]">
            No salary configured for this person, so the day generates no pay.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {pay.lines.map((l, i) => (
              <div key={i} className="wf-card2 flex items-start justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[0.84rem] font-semibold">{l.label}</span>
                  <span className="block text-[0.7rem] leading-snug text-[var(--wf-muted)]">
                    {l.why}
                  </span>
                </span>
                <span
                  className="shrink-0 font-bold tabular-nums"
                  style={{
                    color:
                      l.amount < 0
                        ? "var(--wf-red)"
                        : l.amount === 0
                          ? "var(--wf-faint)"
                          : "var(--wf-fg)",
                  }}
                >
                  {l.amount < 0 ? `−${fmtINR(-l.amount)}` : fmtINR(l.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="wf-card2 flex items-center justify-between px-4 py-3">
        <span className="font-bold">Total for the day</span>
        <span className="wf-display text-lg font-bold tabular-nums text-[var(--wf-green)]">
          {fmtINR(pay.total)}
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- adjustment */

function AdjustmentForm({
  month,
  employeeId,
  afterLock,
  onDone,
}: {
  month: string;
  employeeId: string;
  afterLock: boolean;
  onDone: () => void;
}) {
  const wf = useWorkforce();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-4">
      {afterLock ? (
        <p className="wf-inset px-3.5 py-3 text-[0.78rem] leading-snug text-[var(--wf-amber-hi)]">
          This month is locked. The adjustment is allowed — it becomes the
          correction record, and lands in the audit trail as made after lock.
        </p>
      ) : null}
      <Field label="Amount (₹, negative deducts)" required>
        <input
          className="wf-input"
          type="number"
          value={amount || ""}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="Reason" required>
        <input
          className="wf-input"
          placeholder="Why this amount is being added or removed"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <button
        className="wf-btn wf-btn-primary wf-btn-lg"
        disabled={amount === 0 || !note.trim()}
        onClick={() => {
          wf.addPayrollAdjustment(month, employeeId, amount, note.trim());
          onDone();
        }}
      >
        Record adjustment
      </button>
    </div>
  );
}
