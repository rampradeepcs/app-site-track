"use client";

/**
 * Attendance module — filter by date/project/employee/department/status,
 * KPI summary, exportable table, drill into any day's route.
 */

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ScreenHeader } from "@/components/shell";
import { Avatar, KpiCard, StatusChip } from "@/components/ui";
import {
  fmtDateLong,
  fmtDistance,
  fmtDuration,
  fmtTime,
  isoAddDays,
  todayISO,
} from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import type { AttendanceStatus } from "@/lib/types";
import { attendanceCSV, downloadCSV, printReport } from "@/lib/reports";
import {
  IChevronL,
  IChevronR,
  IDownload,
  IFile,
  IRoute,
} from "@/components/WfIcons";

const STATUSES: Array<AttendanceStatus | "all"> = [
  "all",
  "present",
  "late",
  "early-checkout",
  "missing-checkout",
  "absent",
];

export default function AttendanceModule() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-sm text-[var(--wf-muted)]">Loading…</div>}>
      <AttendanceInner />
    </Suspense>
  );
}

function AttendanceInner() {
  const { state } = useWorkforce();
  const params = useSearchParams();
  const [date, setDate] = useState(() => params.get("date") ?? todayISO());
  const [projectId, setProjectId] = useState(params.get("project") ?? "all");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState<AttendanceStatus | "all">("all");

  const departments = useMemo(
    () => [...new Set(state.users.filter((u) => u.role === "employee").map((u) => u.department))],
    [state.users],
  );

  const rows = useMemo(() => {
    return state.attendance
      .filter((a) => a.date === date)
      .map((a) => ({
        att: a,
        user: state.users.find((u) => u.id === a.employeeId),
        project: state.projects.find((p) => p.id === a.projectId),
      }))
      .filter((r) => r.user)
      .filter((r) => projectId === "all" || r.att.projectId === projectId)
      .filter((r) => department === "all" || r.user!.department === department)
      .filter((r) => status === "all" || r.att.status === status)
      .sort((a, b) => (a.att.checkIn?.at ?? Infinity) - (b.att.checkIn?.at ?? Infinity));
  }, [state, date, projectId, department, status]);

  const kpis = useMemo(() => {
    const day = state.attendance.filter(
      (a) => a.date === date && (projectId === "all" || a.projectId === projectId),
    );
    const present = day.filter((a) => a.checkIn);
    const closed = day.filter((a) => a.workedMinutes != null);
    return {
      present: present.length,
      absent: day.filter((a) => a.status === "absent").length,
      late: day.filter((a) => a.status === "late").length,
      early: day.filter((a) => a.status === "early-checkout").length,
      avg: closed.length
        ? closed.reduce((t, a) => t + (a.workedMinutes ?? 0), 0) / closed.length
        : 0,
    };
  }, [state, date, projectId]);

  const exportPdf = () => {
    const rowsHtml = rows
      .map(
        (r) => `<tr><td>${r.user!.name}</td><td>${r.project?.name ?? ""}</td>
        <td>${r.att.checkIn ? fmtTime(r.att.checkIn.at) : "—"}</td>
        <td>${r.att.checkOut ? fmtTime(r.att.checkOut.at) : "—"}</td>
        <td>${r.att.workedMinutes != null ? fmtDuration(r.att.workedMinutes) : "—"}</td>
        <td>${fmtDistance(r.att.distanceMeters)}</td>
        <td><span class="chip">${r.att.status}</span></td></tr>`,
      )
      .join("");
    printReport(
      `Daily Attendance — ${fmtDateLong(date)}`,
      `<div class="kpis">
        <div class="kpi"><b>${kpis.present}</b><span>Present</span></div>
        <div class="kpi"><b>${kpis.absent}</b><span>Absent</span></div>
        <div class="kpi"><b>${kpis.late}</b><span>Late</span></div>
        <div class="kpi"><b>${kpis.early}</b><span>Early out</span></div>
        <div class="kpi"><b>${fmtDuration(kpis.avg)}</b><span>Avg hours</span></div>
      </div>
      <table><thead><tr><th>Employee</th><th>Project</th><th>Check-in</th><th>Check-out</th><th>Hours</th><th>Distance</th><th>Status</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>`,
    );
  };

  return (
    <div>
      <ScreenHeader
        title="Attendance"
        sub={fmtDateLong(date)}
        action={
          <div className="flex gap-1.5">
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={exportPdf}>
              <IFile size={14} /> PDF
            </button>
            <button
              className="wf-btn wf-btn-ghost wf-btn-sm"
              onClick={() =>
                downloadCSV(
                  `attendance-${date}.csv`,
                  attendanceCSV(state, date, projectId === "all" ? undefined : projectId),
                )
              }
            >
              <IDownload size={14} /> CSV
            </button>
          </div>
        }
      />
      <div className="flex flex-col gap-4 px-4">
        {/* date + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              aria-label="Previous day"
              className="grid h-11 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-[var(--wf-line)] bg-[var(--wf-surface)] text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
              onClick={() => setDate((d) => isoAddDays(d, -1))}
            >
              <IChevronL size={16} />
            </button>
            <input
              type="date"
              aria-label="Attendance date"
              className="wf-input w-40"
              value={date}
              max={todayISO()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
            <button
              aria-label="Next day"
              className="grid h-11 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-[var(--wf-line)] bg-[var(--wf-surface)] text-[var(--wf-muted)] hover:text-[var(--wf-fg)] disabled:opacity-40"
              onClick={() => setDate((d) => isoAddDays(d, 1))}
              disabled={date >= todayISO()}
            >
              <IChevronR size={16} />
            </button>
          </div>
          <select
            aria-label="Project filter"
            className="wf-input w-auto min-w-36"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="all">All projects</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            aria-label="Department filter"
            className="wf-input w-auto min-w-32"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            aria-label="Status filter"
            className="wf-input w-auto min-w-32"
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatus | "all")}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All statuses" : s.replace("-", " ")}
              </option>
            ))}
          </select>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <KpiCard label="Present" value={kpis.present} tone="green" />
          <KpiCard label="Absent" value={kpis.absent} tone={kpis.absent ? "red" : "neutral"} />
          <KpiCard label="Late" value={kpis.late} tone={kpis.late ? "amber" : "neutral"} />
          <KpiCard label="Early out" value={kpis.early} />
          <KpiCard label="Avg hours" value={fmtDuration(kpis.avg)} tone="blue" />
        </div>

        {/* table */}
        <div className="wf-card overflow-hidden">
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Project</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Hours</th>
                  <th>Distance</th>
                  <th>Status</th>
                  <th aria-label="Route" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[var(--wf-muted)]">
                      No records match these filters.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.att.id}>
                    <td>
                      <span className="flex items-center gap-2">
                        <Avatar name={r.user!.name} hue={r.user!.avatarHue} size={28} />
                        <span>
                          <span className="block font-semibold leading-tight">{r.user!.name}</span>
                          <span className="block text-[0.66rem] text-[var(--wf-faint)]">
                            {r.user!.department}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="text-[var(--wf-muted)]">
                      {r.project?.name.split(" ").slice(0, 2).join(" ")}
                    </td>
                    <td className="tabular-nums">{r.att.checkIn ? fmtTime(r.att.checkIn.at) : "—"}</td>
                    <td className="tabular-nums">
                      {r.att.checkOut ? fmtTime(r.att.checkOut.at) : r.att.checkIn ? "…" : "—"}
                    </td>
                    <td className="tabular-nums">
                      {r.att.workedMinutes != null ? fmtDuration(r.att.workedMinutes) : "—"}
                    </td>
                    <td className="tabular-nums">{fmtDistance(r.att.distanceMeters)}</td>
                    <td><StatusChip status={r.att.status} /></td>
                    <td>
                      {r.att.checkIn ? (
                        <Link
                          href={`/manager/history?att=${r.att.id}`}
                          className="wf-btn wf-btn-quiet wf-btn-sm"
                        >
                          <IRoute size={13} /> Route
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
