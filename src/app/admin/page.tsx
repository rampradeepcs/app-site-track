"use client";

/**
 * Super-admin overview — the product owner's org-wide control tower:
 * portfolio KPIs, per-project health with its manager, role distribution
 * and the operational alerts that need an owner's eye.
 */

import Link from "next/link";
import { useMemo } from "react";
import { BarTrend, Donut } from "@/components/charts";
import { FirstRun } from "@/components/onboarding/FirstRun";
import { ScreenHeader } from "@/components/shell";
import { Avatar, Chip, KpiCard, SectionTitle, useNowTick } from "@/components/ui";
import { fmtDuration, fmtRelative, pct, roleLabel, todayISO } from "@/lib/format";
import { attendanceTrend, dashboardStats, liveBoard, needsAttention } from "@/lib/metrics";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import {
  IAlert,
  IArrowR,
  IHardHat,
  IMapPin,
  IShield,
  IUsers,
} from "@/components/WfIcons";

export default function AdminOverview() {
  const { state, currentUser } = useWorkforce();
  const { platform } = usePlatform();
  const org = platform.organizations.find((o) => o.id === currentUser?.orgId);
  const now = useNowTick(15);
  const stats = useMemo(() => dashboardStats(state, now), [state, now]);
  const board = useMemo(() => liveBoard(state, undefined, now), [state, now]);
  const trend = useMemo(() => attendanceTrend(state, 14, undefined, now), [state, now]);
  const attention = useMemo(() => needsAttention(state, now), [state, now]);

  const managers = state.users.filter((u) => u.role === "manager");
  const employees = state.users.filter((u) => u.role === "employee");
  const admins = state.users.filter((u) => u.role === "admin");
  const alerts = state.notifications
    .filter((n) => n.audience === "manager" && (n.severity === "warning" || n.severity === "critical"))
    .slice(0, 5);

  return (
    <div>
      <ScreenHeader
        title="Organisation Overview"
        sub={`${currentUser?.name ?? ""} · ${roleLabel(state.session?.role ?? currentUser?.role ?? "admin")} · ${new Date(now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}`}
      />
      <div className="flex flex-col gap-5 px-4">
        {/* A tenant with no recorded shift is new, not broken — and only the
            empty state can tell the difference, so it says so itself. */}
        {state.attendance.every((a) => !a.checkIn) ? (
          <FirstRun
            orgName={org?.name ?? "Your company"}
            projects={state.projects}
            employees={employees}
            managers={managers}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <KpiCard label="Projects" value={`${stats.activeProjects}/${stats.totalProjects}`} tone="blue" icon={<IHardHat size={17} />} sub="active / total" />
          <KpiCard label="Workforce" value={stats.workforce} icon={<IUsers size={17} />} sub={`${managers.length} manager${managers.length === 1 ? "" : "s"}`} />
          <KpiCard label="On site now" value={stats.currentlyWorking} tone="green" sub={`${pct(stats.attendancePct)} attendance today`} />
          <KpiCard label="Avg hours" value={fmtDuration(stats.avgWorkedMinutes)} sub="per closed shift today" />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Link href="/manager/shifts" className="wf-btn wf-btn-ghost">
            Shifts & breaks
          </Link>
          <Link href="/manager/payroll" className="wf-btn wf-btn-ghost">
            Payroll
          </Link>
        </div>

        {/* portfolio health */}
        <div>
          <SectionTitle>Projects & their managers</SectionTitle>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {state.projects.map((p) => {
              const mgr = state.users.find((u) => u.id === p.managerId);
              const onsite = board.filter((b) => b.state === "working" && b.project?.id === p.id).length;
              const today = state.attendance.filter(
                (a) => a.projectId === p.id && a.date === todayISO(now) && a.checkIn,
              ).length;
              return (
                <Link
                  key={p.id}
                  href={`/manager/project?id=${p.id}`}
                  className="wf-card flex min-w-0 items-center gap-3.5 p-4 transition hover:border-[var(--wf-line-strong)]"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--wf-amber-soft)] text-[var(--wf-amber)]">
                    <IMapPin size={20} />
                  </span>
                  {/* The project name gets the full width; the status chip
                      sits under it rather than eating into the title. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{p.name}</span>
                    <span className="mt-0.5 block truncate text-[0.74rem] text-[var(--wf-muted)]">
                      PM: {mgr?.name ?? "Unassigned"} · {p.employeeIds.length} assigned ·{" "}
                      {onsite} on site · {today} present today
                    </span>
                    <span className="mt-1.5 flex">
                      <Chip tone={p.status === "active" ? "green" : "neutral"}>
                        {p.status}
                      </Chip>
                    </span>
                  </span>
                  <IArrowR size={15} className="shrink-0 text-[var(--wf-faint)]" />
                </Link>
              );
            })}
          </div>
        </div>

        {/* trend + role mix */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="wf-card p-4 md:col-span-2">
            <SectionTitle>Org attendance — last 14 working days</SectionTitle>
            <BarTrend
              data={trend.map((t) => t.presentPct)}
              labels={trend.map((t) => t.date.slice(8))}
              format={(v) => `${Math.round(v)}%`}
              ariaLabel="Organisation attendance trend"
              height={110}
            />
          </div>
          <div className="wf-card flex items-center justify-center gap-5 p-4">
            <Donut
              size={116}
              centerLabel={String(state.users.length)}
              centerSub="people"
              segments={[
                { value: employees.length, color: "var(--wf-blue)", label: "Employees" },
                { value: managers.length, color: "var(--wf-amber)", label: "Managers" },
                { value: admins.length, color: "var(--wf-violet)", label: "Admins" },
              ]}
            />
            <div className="flex flex-col gap-1.5 text-[0.74rem] font-semibold">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--wf-blue)" }} /> {employees.length} employees</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--wf-amber)" }} /> {managers.length} managers</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--wf-violet)" }} /> {admins.length} admins</span>
            </div>
          </div>
        </div>

        {/* alerts + attention */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <SectionTitle>Operational alerts</SectionTitle>
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
                <Link href="/admin/team" className="wf-btn wf-btn-quiet wf-btn-sm">
                  Team & roles <IArrowR size={13} />
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
              {attention.slice(0, 4).map((a) => (
                <Link
                  key={a.user.id}
                  href={`/manager/employee?id=${a.user.id}`}
                  className="wf-card2 flex items-center gap-3 px-3.5 py-2.5 transition hover:border-[var(--wf-line-strong)]"
                >
                  <Avatar name={a.user.name} hue={a.user.avatarHue} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.84rem] font-semibold">{a.user.name}</span>
                    <span className="block truncate text-[0.68rem] text-[var(--wf-amber)]">
                      {a.reasons.slice(0, 2).join(" · ")}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[0.68rem] text-[var(--wf-faint)]">
          <IShield size={12} /> Super-admin session — you can also open any manager surface
        </p>
      </div>
    </div>
  );
}
