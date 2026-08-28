"use client";

/**
 * Employee profile (manager view) — identity, performance breakdown,
 * attendance history with route links, work updates, and edit access.
 */

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ScreenHeader } from "@/components/shell";
import { ProgressRing, ScoreBars, Sparkline } from "@/components/charts";
import {
  Avatar,
  Chip,
  KpiCard,
  SectionTitle,
  StatusChip,
  useNowTick,
} from "@/components/ui";
import { EmployeeEditor } from "@/components/EmployeeEditor";
import { SalaryAndShiftSection } from "@/components/SalarySection";
import {
  fmtDateLong,
  fmtDistance,
  fmtDuration,
  fmtTime,
  pct,
} from "@/lib/format";
import {
  liveBoard,
  performanceFor,
  PERFORMANCE_WEIGHTS,
} from "@/lib/metrics";
import { useWorkforce } from "@/lib/store";
import type { User } from "@/lib/types";
import { IArrowR, IEdit, IPhone, IRoute } from "@/components/WfIcons";

export default function EmployeeProfilePage() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-sm text-[var(--wf-muted)]">Loading…</div>}>
      <EmployeeInner />
    </Suspense>
  );
}

function EmployeeInner() {
  const { state, saveEmployee } = useWorkforce();
  const params = useSearchParams();
  const id = params.get("id");
  const user = state.users.find((u) => u.id === id) ?? null;
  const now = useNowTick(15);
  const [editing, setEditing] = useState<User | null | "new">(null);

  const perf = useMemo(
    () => (user ? performanceFor(state, user, 14, now) : null),
    [state, user, now],
  );
  const live = useMemo(
    () => (user ? liveBoard(state, undefined, now).find((b) => b.user.id === user.id) ?? null : null),
    [state, user, now],
  );

  if (!user || !perf) {
    return (
      <div className="px-4 pt-10 text-center text-sm text-[var(--wf-muted)]">
        Employee not found.{" "}
        <Link href="/manager/workforce" className="font-semibold text-[var(--wf-amber)]">
          Back to workforce
        </Link>
      </div>
    );
  }

  const history = state.attendance
    .filter((a) => a.employeeId === user.id && a.checkIn)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const updates = state.updates.filter((u) => u.employeeId === user.id).slice(0, 8);
  const hoursSeries = history
    .slice(0, 10)
    .map((a) => (a.workedMinutes ?? 0) / 60)
    .reverse();

  return (
    <div>
      <ScreenHeader
        back="/manager/workforce"
        title={user.name}
        sub={`${user.designation} · ${user.department} · ${user.employeeCode}`}
        action={
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setEditing(user)}>
            <IEdit size={14} /> Edit
          </button>
        }
      />
      <div className="flex flex-col gap-4 px-4">
        {/* identity + live state */}
        <div className="wf-card flex flex-wrap items-center gap-4 p-4">
          <Avatar
            name={user.name}
            hue={user.avatarHue}
            size={64}
            ring={live?.state === "working" ? "green" : "none"}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {live?.state === "working" ? (
                <Chip tone="green">Working now · {live.place}</Chip>
              ) : (
                <StatusChip status={live?.attendance ? live.attendance.status : "not-in"} />
              )}
              <Chip tone="neutral">
                <IPhone size={11} /> {user.phone}
              </Chip>
            </div>
            <p className="mt-1.5 text-[0.76rem] text-[var(--wf-muted)]">
              Projects:{" "}
              {user.projectIds
                .map((pid) => state.projects.find((p) => p.id === pid)?.name)
                .filter(Boolean)
                .join(", ") || "None"}
            </p>
          </div>
          {live?.state === "working" && live.attendance && (
            <Link
              href={`/manager/live?project=${live.attendance.projectId}&track=${user.id}`}
              className="wf-btn wf-btn-primary wf-btn-sm"
            >
              Track live <IArrowR size={13} />
            </Link>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <KpiCard label="Attendance" value={pct(perf.attendancePct)} tone="green" sub={`${perf.presentDays}/${perf.scheduledDays} days`} />
          <KpiCard label="Avg hours" value={fmtDuration(perf.avgWorkedMinutes)} tone="blue" sub="per worked day" />
          <KpiCard label="Late days" value={perf.lateCount} tone={perf.lateCount > 2 ? "amber" : "neutral"} sub="last 14 days" />
          <KpiCard label="Updates" value={perf.updateCount} sub="submitted" />
        </div>

        {/* performance */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="wf-card flex items-center gap-5 p-4">
            <ProgressRing value={perf.overall} size={92} label={`Overall score ${Math.round(perf.overall)}`} />
            <div>
              <p className="wf-display font-bold">Performance score</p>
              <p className="mt-1 text-[0.74rem] leading-snug text-[var(--wf-muted)]">
                Weighted across attendance, punctuality, hours, updates and
                supervisor rating. Movement distance is a presence signal only —
                never scored.
              </p>
              {hoursSeries.length > 1 && (
                <div className="mt-2">
                  <Sparkline data={hoursSeries} width={150} height={30} />
                  <p className="text-[0.62rem] text-[var(--wf-faint)]">hours/day trend</p>
                </div>
              )}
            </div>
          </div>
          <div className="wf-card p-4">
            <ScoreBars
              rows={[
                { label: "Attendance", value: perf.attendance, weight: `${PERFORMANCE_WEIGHTS.attendance * 100}%`, color: "var(--wf-green)" },
                { label: "Punctuality", value: perf.punctuality, weight: `${PERFORMANCE_WEIGHTS.punctuality * 100}%`, color: "var(--wf-amber)" },
                { label: "Working hours", value: perf.hours, weight: `${PERFORMANCE_WEIGHTS.hours * 100}%`, color: "var(--wf-blue)" },
                { label: "Work updates", value: perf.updates, weight: `${PERFORMANCE_WEIGHTS.updates * 100}%`, color: "var(--wf-violet)" },
                { label: "Supervisor", value: perf.supervisor, weight: `${PERFORMANCE_WEIGHTS.supervisor * 100}%`, color: "var(--wf-orange)" },
              ]}
            />
          </div>
        </div>

        {/* shift + salary — visibility enforced inside the component */}
        <SalaryAndShiftSection user={user} />

        {/* attendance history */}
        <div className="wf-card overflow-hidden">
          <div className="px-4 pt-4">
            <SectionTitle>Attendance & routes</SectionTitle>
          </div>
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Hours</th>
                  <th>Distance</th>
                  <th>Status</th>
                  <th aria-label="Route" />
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 14).map((a) => (
                  <tr key={a.id}>
                    <td className="font-semibold tabular-nums">{a.date.slice(5)}</td>
                    <td className="tabular-nums">{a.checkIn ? fmtTime(a.checkIn.at) : "—"}</td>
                    <td className="tabular-nums">{a.checkOut ? fmtTime(a.checkOut.at) : "…"}</td>
                    <td className="tabular-nums">{a.workedMinutes != null ? fmtDuration(a.workedMinutes) : "—"}</td>
                    <td className="tabular-nums">{fmtDistance(a.distanceMeters)}</td>
                    <td><StatusChip status={a.status} /></td>
                    <td>
                      <Link href={`/manager/history?att=${a.id}`} className="wf-btn wf-btn-quiet wf-btn-sm">
                        <IRoute size={13} /> Route
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* recent updates */}
        <div>
          <SectionTitle>Recent work updates</SectionTitle>
          <div className="flex flex-col gap-2">
            {updates.length === 0 && (
              <p className="wf-card2 px-4 py-6 text-center text-sm text-[var(--wf-muted)]">
                No updates submitted.
              </p>
            )}
            {updates.map((u) => (
              <div key={u.id} className="wf-card2 px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <Chip tone={u.kind === "daily" ? "blue" : "neutral"}>
                    {u.kind === "daily" ? "Daily" : u.category}
                  </Chip>
                  <span className="ml-auto text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                    {fmtDateLong(u.date)} · {fmtTime(u.at)}
                  </span>
                </div>
                <p className="mt-1 text-[0.8rem] leading-snug text-[var(--wf-muted)]">{u.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <EmployeeEditor
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={(patch, uid) => {
          saveEmployee(patch, uid);
          setEditing(null);
        }}
      />
    </div>
  );
}
