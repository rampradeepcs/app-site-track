"use client";

/**
 * Manager dashboard — the "answer instantly" screen: who's on site, who's
 * late, live movement, alerts, trends and who needs attention.
 */

import Link from "next/link";
import { useMemo } from "react";
import { BarTrend, Donut } from "@/components/charts";
import { NotificationBell, ScreenHeader } from "@/components/shell";
import { SiteMap, type MapMarker } from "@/components/SiteMap";
import { Avatar, Chip, KpiCard, SectionTitle, StatusChip, useNowTick } from "@/components/ui";
import {
  fmtClock,
  fmtDuration,
  fmtRelative,
  fmtTime,
  initialsOf,
  pct,
} from "@/lib/format";
import {
  attendanceTrend,
  attendanceSources,
  dashboardStats,
  liveBoard,
  needsAttention,
} from "@/lib/metrics";
import { useWorkforce } from "@/lib/store";
import { fmtINR, todayShiftKpis } from "@/lib/payroll";
import { useFeature } from "@/components/FeatureGate";
import {
  IAlert,
  IArrowR,
  IChart,
  ICheckCircle,
  IClock,
  IHardHat,
  IMap,
  ITrend,
  IUsers,
} from "@/components/WfIcons";

export default function ManagerDashboard() {
  const { state, currentUser } = useWorkforce();
  const now = useNowTick(15);
  const stats = useMemo(() => dashboardStats(state, now), [state, now]);
  const sources = useMemo(() => attendanceSources(state), [state]);
  const payrollOn = useFeature("payroll");
  const shiftKpis = useMemo(() => todayShiftKpis(state, now), [state, now]);
  const board = useMemo(() => liveBoard(state, undefined, now), [state, now]);
  const trend = useMemo(() => attendanceTrend(state, 10, undefined, now), [state, now]);
  const attention = useMemo(() => needsAttention(state, now), [state, now]);

  const working = board.filter((b) => b.state === "working");
  const project = state.projects.find((p) => p.status === "active") ?? state.projects[0];

  const markers: MapMarker[] = working
    .filter((b) => b.project?.id === project?.id && b.lastPoint)
    .map((b) => ({
      id: b.user.id,
      coords: { lat: b.lastPoint!.lat, lng: b.lastPoint!.lng },
      kind: "worker" as const,
      hue: b.user.avatarHue,
      initials: initialsOf(b.user.name),
      label: `${b.user.name.split(" ")[0]} — ${b.place}`,
      pulse: true,
    }));

  const recentUpdates = state.updates.slice(0, 4);
  const alerts = state.notifications
    .filter((n) => n.audience === "manager" && (n.severity === "warning" || n.severity === "critical"))
    .slice(0, 4);

  return (
    <div>
      <ScreenHeader
        title={`Dashboard`}
        sub={`${currentUser?.name ?? ""} · ${new Date(now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}`}
        action={<NotificationBell role="manager" />}
      />

      <div className="flex flex-col gap-5 px-4">
        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <KpiCard label="On site now" value={stats.currentlyWorking} tone="green" icon={<IHardHat size={17} />} sub={`of ${stats.workforce} workforce`} />
          <KpiCard label="Present today" value={stats.presentToday} tone="blue" icon={<IUsers size={17} />} sub={`${pct(stats.attendancePct)} attendance`} />
          <KpiCard label="Late" value={stats.lateToday} tone={stats.lateToday ? "amber" : "neutral"} icon={<IClock size={17} />} sub="today" />
          <KpiCard label="Checked out" value={stats.checkedOut} tone="neutral" icon={<ICheckCircle size={17} />} sub={`avg ${fmtDuration(stats.avgWorkedMinutes)}`} />
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <KpiCard label="Projects" value={`${stats.activeProjects}/${stats.totalProjects}`} sub="active" />
          <KpiCard label="Missing checkout" value={stats.missingCheckout} tone={stats.missingCheckout ? "red" : "neutral"} sub="all time" />
          <KpiCard label="Early outs" value={stats.earlyOutToday} sub="today" />
          <KpiCard label="Work updates" value={stats.updatesToday} tone="blue" sub="today" />
        </div>

        {/*
         * How today's register was actually recorded. Individual and group
         * are the same attendance rows split by who marked them, so the
         * three numbers reconcile by construction (spec §16).
         */}
        <div className="grid grid-cols-3 gap-2.5">
          <KpiCard label="Individual" value={sources.individual} sub="check-ins today" />
          <KpiCard label="Group" value={sources.group} tone="blue" sub="from team photos" />
          <KpiCard label="Total present" value={sources.total} tone="green" sub="no double counting" />
        </div>

        {/* shift & payroll KPIs — the workforce as money, live */}
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <KpiCard
            label="On break"
            value={shiftKpis.onBreak}
            tone={shiftKpis.onBreak ? "amber" : "neutral"}
            sub="right now"
          />
          <KpiCard
            label="In overtime"
            value={shiftKpis.inOvertime}
            tone={shiftKpis.inOvertime ? "blue" : "neutral"}
            sub={`${fmtDuration(shiftKpis.otMinutesToday)} OT today`}
          />
          <KpiCard
            label="Pending OT approvals"
            value={shiftKpis.pendingApprovals}
            tone={shiftKpis.pendingApprovals ? "amber" : "neutral"}
            sub="awaiting decision"
          />
          {payrollOn ? (
            <KpiCard
              label="Today's labour cost"
              value={fmtINR(shiftKpis.labourCostToday)}
              tone="green"
              sub={`est · OT ${fmtINR(shiftKpis.otCostToday)}`}
            />
          ) : (
            <KpiCard label="OT hours today" value={fmtDuration(shiftKpis.otMinutesToday)} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Link href="/manager/shifts" className="wf-btn wf-btn-ghost">
            <IClock size={16} /> Manage shifts
          </Link>
          <Link href="/manager/payroll" className="wf-btn wf-btn-ghost">
            <IChart size={16} /> Payroll
          </Link>
        </div>

        {/* live map + working list */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <SectionTitle
              action={
                <Link href="/manager/live" className="wf-btn wf-btn-ghost wf-btn-sm">
                  <IMap size={14} /> Full map
                </Link>
              }
            >
              Live site — {project?.name ?? "no project"}
            </SectionTitle>
            <SiteMap
              project={project}
              markers={markers}
              heightClass="h-72"
            />
          </div>
          <div className="md:col-span-2">
            <SectionTitle>Currently working ({working.length})</SectionTitle>
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
              {working.length === 0 && (
                <p className="wf-card2 px-4 py-6 text-center text-sm text-[var(--wf-muted)]">
                  Nobody is on shift right now.
                </p>
              )}
              {working.map((b) => (
                <Link
                  key={b.user.id}
                  href={`/manager/employee?id=${b.user.id}`}
                  className="wf-card2 flex items-center gap-3 px-3 py-2.5 transition hover:border-[var(--wf-line-strong)]"
                >
                  <Avatar name={b.user.name} hue={b.user.avatarHue} size={38} ring="green" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.88rem] font-semibold">{b.user.name}</span>
                    <span className="block truncate text-[0.7rem] text-[var(--wf-muted)]">
                      {b.place} · in {fmtTime(b.attendance!.checkIn!.at)}
                    </span>
                  </span>
                  <span className="text-[0.72rem] font-bold tabular-nums text-[var(--wf-green)]">
                    {fmtClock(b.workedMs).slice(0, 5)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* charts row */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="wf-card p-4 md:col-span-2">
            <SectionTitle>Attendance trend — last 10 working days</SectionTitle>
            <BarTrend
              data={trend.map((t) => t.presentPct)}
              labels={trend.map((t) => t.date.slice(8))}
              format={(v) => `${Math.round(v)}%`}
              ariaLabel="Attendance percentage per day"
              height={110}
            />
          </div>
          <div className="wf-card flex items-center justify-center gap-5 p-4">
            <Donut
              size={120}
              centerLabel={String(stats.presentToday)}
              centerSub="present"
              segments={[
                { value: stats.currentlyWorking, color: "var(--wf-green)", label: "Working" },
                { value: stats.checkedOut, color: "var(--wf-blue)", label: "Done" },
                { value: stats.lateToday, color: "var(--wf-amber)", label: "Late" },
                { value: stats.absentToday, color: "var(--wf-red)", label: "Absent" },
              ]}
            />
            <div className="flex flex-col gap-1.5 text-[0.74rem] font-semibold">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--wf-green)" }} /> Working {stats.currentlyWorking}</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--wf-blue)" }} /> Done {stats.checkedOut}</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--wf-amber)" }} /> Late {stats.lateToday}</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--wf-red)" }} /> Absent {stats.absentToday}</span>
            </div>
          </div>
        </div>

        {/* alerts + attention + updates */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <SectionTitle>Alerts</SectionTitle>
            <div className="flex flex-col gap-2">
              {alerts.length === 0 && (
                <p className="wf-card2 px-4 py-5 text-center text-sm text-[var(--wf-muted)]">All clear.</p>
              )}
              {alerts.map((n) => (
                <div key={n.id} className="wf-card2 flex items-start gap-2.5 px-3.5 py-3">
                  <IAlert size={16} className="mt-0.5 shrink-0" style={{ color: n.severity === "critical" ? "var(--wf-red)" : "var(--wf-amber)" }} />
                  <div className="min-w-0">
                    <p className="text-[0.82rem] font-semibold leading-snug">{n.title}</p>
                    <p className="text-[0.7rem] text-[var(--wf-faint)]">{fmtRelative(n.at, now)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <SectionTitle
              action={
                <Link href="/manager/more?tab=performance" className="wf-btn wf-btn-quiet wf-btn-sm">
                  <IChart size={14} /> All
                </Link>
              }
            >
              Needs attention
            </SectionTitle>
            <div className="flex flex-col gap-2">
              {attention.length === 0 && (
                <p className="wf-card2 px-4 py-5 text-center text-sm text-[var(--wf-muted)]">
                  Everyone is on track.
                </p>
              )}
              {attention.slice(0, 3).map((a) => (
                <Link
                  key={a.user.id}
                  href={`/manager/employee?id=${a.user.id}`}
                  className="wf-card2 flex items-center gap-3 px-3.5 py-2.5 transition hover:border-[var(--wf-line-strong)]"
                >
                  <Avatar name={a.user.name} hue={a.user.avatarHue} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.84rem] font-semibold">{a.user.name}</span>
                    <span className="block truncate text-[0.68rem] text-[var(--wf-amber)]">
                      {a.reasons.slice(0, 2).join(" · ")}
                    </span>
                  </span>
                  <IArrowR size={14} className="shrink-0 text-[var(--wf-faint)]" />
                </Link>
              ))}
            </div>
          </div>
          <div>
            <SectionTitle
              action={
                <Link href="/manager/more?tab=updates" className="wf-btn wf-btn-quiet wf-btn-sm">
                  All <IArrowR size={13} />
                </Link>
              }
            >
              Latest work updates
            </SectionTitle>
            <div className="flex flex-col gap-2">
              {recentUpdates.map((u) => {
                const emp = state.users.find((x) => x.id === u.employeeId);
                return (
                  <div key={u.id} className="wf-card2 px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[0.8rem] font-semibold">{emp?.name}</span>
                      <Chip tone="neutral">{u.category}</Chip>
                      <span className="ml-auto shrink-0 text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                        {fmtTime(u.at)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[0.76rem] leading-snug text-[var(--wf-muted)]">
                      {u.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* today table */}
        <div className="wf-card overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-4">
            <SectionTitle>Today&apos;s attendance</SectionTitle>
            <Link href="/manager/attendance" className="wf-btn wf-btn-quiet wf-btn-sm">
              Full module <IArrowR size={13} />
            </Link>
          </div>
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Project</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {board
                  .filter((b) => b.attendance)
                  .slice(0, 8)
                  .map((b) => (
                    <tr key={b.user.id}>
                      <td>
                        <span className="flex items-center gap-2">
                          <Avatar name={b.user.name} hue={b.user.avatarHue} size={28} />
                          <span className="font-semibold">{b.user.name}</span>
                        </span>
                      </td>
                      <td className="text-[var(--wf-muted)]">{b.project?.name.split(" ").slice(0, 2).join(" ")}</td>
                      <td className="tabular-nums">{b.attendance?.checkIn ? fmtTime(b.attendance.checkIn.at) : "—"}</td>
                      <td className="tabular-nums">{b.attendance?.checkOut ? fmtTime(b.attendance.checkOut.at) : "…"}</td>
                      <td className="tabular-nums">
                        {b.attendance?.workedMinutes != null
                          ? fmtDuration(b.attendance.workedMinutes)
                          : b.state === "working"
                            ? fmtClock(b.workedMs).slice(0, 5)
                            : "—"}
                      </td>
                      <td>
                        <StatusChip status={b.state === "working" ? "working" : b.attendance!.status} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[0.68rem] text-[var(--wf-faint)]">
          <ITrend size={12} /> Data refreshes live while employees are tracking
        </p>
      </div>
    </div>
  );
}
