"use client";

/**
 * Employee attendance — month calendar with status colours; tapping a day
 * opens full attendance details (selfies, timestamps, route, work update).
 */

import { useMemo, useState } from "react";
import { RouteReview } from "@/components/RouteReview";
import { ScreenHeader } from "@/components/shell";
import { BottomSheet, StatusChip } from "@/components/ui";
import {
  fmtDateLong,
  fmtDuration,
  todayISO,
} from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import type { Attendance } from "@/lib/types";
import { IChevronL, IChevronR } from "@/components/WfIcons";

const STATUS_DOT: Record<string, string> = {
  present: "var(--wf-green)",
  late: "var(--wf-amber)",
  "early-checkout": "var(--wf-blue)",
  "missing-checkout": "var(--wf-red)",
  absent: "var(--wf-red)",
  "on-leave": "var(--wf-violet)",
};

export default function EmployeeAttendance() {
  const { state, currentUser } = useWorkforce();
  const [monthStart, setMonthStart] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<Attendance | null>(null);

  const mine = useMemo(
    () => state.attendance.filter((a) => a.employeeId === currentUser?.id),
    [state.attendance, currentUser],
  );
  const byDate = useMemo(() => {
    const m = new Map<string, Attendance>();
    for (const a of mine) m.set(a.date, a);
    return m;
  }, [mine]);

  const summary = useMemo(() => {
    const present = mine.filter((a) => a.checkIn).length;
    const scheduled = mine.length;
    const late = mine.filter((a) => a.status === "late").length;
    const closed = mine.filter((a) => a.workedMinutes != null);
    const avg = closed.length
      ? closed.reduce((t, a) => t + (a.workedMinutes ?? 0), 0) / closed.length
      : 0;
    return { present, scheduled, late, avg };
  }, [mine]);

  /* calendar grid */
  const today = todayISO();
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      const m = String(month + 1).padStart(2, "0");
      return `${year}-${m}-${d}`;
    }),
  ];

  const project = selected
    ? state.projects.find((p) => p.id === selected.projectId)
    : null;
  const dailyUpdate = selected
    ? state.updates.find((u) => u.attendanceId === selected.id && u.kind === "daily")
    : null;

  return (
    <div>
      <ScreenHeader
        title="Attendance"
        sub={`${summary.present}/${summary.scheduled} days present · ${summary.late} late · avg ${fmtDuration(summary.avg)}`}
      />

      <div className="flex flex-col gap-4 px-4">
        <div className="wf-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <button
              aria-label="Previous month"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg bg-[var(--wf-surface2)] text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
              onClick={() => setMonthStart(new Date(year, month - 1, 1))}
            >
              <IChevronL size={16} />
            </button>
            <h2 className="wf-display font-bold">
              {monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </h2>
            <button
              aria-label="Next month"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg bg-[var(--wf-surface2)] text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
              onClick={() => setMonthStart(new Date(year, month + 1, 1))}
            >
              <IChevronR size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <span key={i} className="pb-1 text-[0.64rem] font-bold text-[var(--wf-faint)]">
                {d}
              </span>
            ))}
            {cells.map((date, i) => {
              if (!date) return <span key={`x${i}`} />;
              const rec = byDate.get(date);
              const isToday = date === today;
              const future = date > today;
              const dow = new Date(`${date}T12:00:00`).getDay();
              return (
                <button
                  key={date}
                  disabled={!rec}
                  onClick={() => rec && setSelected(rec)}
                  className={`relative aspect-square rounded-lg text-[0.82rem] font-semibold tabular-nums transition ${
                    rec ? "cursor-pointer hover:bg-[var(--wf-surface3)]" : ""
                  } ${isToday ? "border border-[var(--wf-amber)]" : ""} ${
                    future || dow === 0 ? "text-[var(--wf-faint)]" : ""
                  }`}
                  style={{ background: rec ? "var(--wf-surface2)" : undefined }}
                >
                  {Number(date.slice(-2))}
                  {rec && (
                    <span
                      className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
                      style={{ background: STATUS_DOT[rec.status] ?? "var(--wf-faint)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--wf-line)] pt-3">
            {[
              ["Present", "var(--wf-green)"],
              ["Late", "var(--wf-amber)"],
              ["Early out", "var(--wf-blue)"],
              ["Absent / no checkout", "var(--wf-red)"],
            ].map(([label, color]) => (
              <span key={label} className="flex items-center gap-1.5 text-[0.66rem] text-[var(--wf-muted)]">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* recent records */}
        <div className="flex flex-col gap-2">
          {mine
            .filter((a) => a.checkIn)
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, 10)
            .map((a) => (
              <button
                key={a.id}
                className="wf-card2 flex cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition hover:border-[var(--wf-line-strong)]"
                onClick={() => setSelected(a)}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9rem] font-semibold">{fmtDateLong(a.date)}</p>
                  <p className="text-[0.72rem] tabular-nums text-[var(--wf-muted)]">
                    {a.checkIn ? new Date(a.checkIn.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    {" → "}
                    {a.checkOut ? new Date(a.checkOut.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "…"}
                    {a.workedMinutes != null ? ` · ${fmtDuration(a.workedMinutes)}` : ""}
                  </p>
                </div>
                <StatusChip status={a.status} />
              </button>
            ))}
        </div>
      </div>

      {/* details */}
      <BottomSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? fmtDateLong(selected.date) : ""}
        tall
      >
        {selected && project && currentUser && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--wf-muted)]">{project.name}</p>
              <StatusChip status={selected.status} />
            </div>
            <RouteReview attendance={selected} project={project} user={currentUser} compact />
            {dailyUpdate && (
              <div className="wf-card2 p-4">
                <p className="mb-1 text-[0.68rem] font-bold uppercase tracking-wider text-[var(--wf-violet)]">
                  Daily work update
                </p>
                <p className="text-sm leading-relaxed">{dailyUpdate.description}</p>
                {dailyUpdate.blockers ? (
                  <p className="mt-2 text-[0.78rem] text-[var(--wf-amber)]">
                    Blockers: {dailyUpdate.blockers}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
