"use client";

/**
 * More — reports & exports, the performance dashboard, the all-projects
 * work-update feed, manager notifications, and app settings/audit log.
 */

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarTrend, ScoreBars } from "@/components/charts";
import { ScreenHeader } from "@/components/shell";
import {
  Avatar,
  Chip,
  Field,
  SectionTitle,
  Segmented,
  Toggle,
  useNowTick,
} from "@/components/ui";
import {
  fmtDateLong,
  fmtDuration,
  fmtRelative,
  fmtTime,
  pct,
  todayISO,
} from "@/lib/format";
import {
  attendanceTrend,
  dashboardStats,
  needsAttention,
  performanceFor,
} from "@/lib/metrics";
import {
  attendanceCSV,
  downloadCSV,
  printReport,
  toCSV,
} from "@/lib/reports";
import { useWorkforce } from "@/lib/store";
import {
  IAlert,
  IArrowR,
  ICheckCircle,
  IDownload,
  IFile,
  IInfo,
  ILogout,
  IMapPin,
  IRefresh,
  IShield,
} from "@/components/WfIcons";

type Tab = "reports" | "performance" | "updates" | "alerts" | "settings";

export default function MorePage() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-sm text-[var(--wf-muted)]">Loading…</div>}>
      <MoreInner />
    </Suspense>
  );
}

function MoreInner() {
  const wf = useWorkforce();
  const { state, updateSettings, markNotificationsRead, logout, resetDemo } = wf;
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "reports";
  const now = useNowTick(30);

  const employees = useMemo(
    () => state.users.filter((u) => u.role === "employee" && u.status === "active"),
    [state.users],
  );
  const perfs = useMemo(
    () =>
      employees
        .map((u) => ({ user: u, perf: performanceFor(state, u, 14, now) }))
        .sort((a, b) => b.perf.overall - a.perf.overall),
    [employees, state, now],
  );
  const attention = useMemo(() => needsAttention(state, now), [state, now]);
  const stats = useMemo(() => dashboardStats(state, now), [state, now]);
  const trend = useMemo(() => attendanceTrend(state, 14, undefined, now), [state, now]);
  const alerts = state.notifications.filter((n) => n.audience === "manager");

  const setTab = (t: Tab) => {
    router.replace(`/manager/more${t === "reports" ? "" : `?tab=${t}`}`);
    if (t === "alerts") markNotificationsRead("manager");
  };

  /* ------------------------------------------------------ report builders */
  const performanceCSVExport = () =>
    downloadCSV(
      `performance-${todayISO(now)}.csv`,
      toCSV(
        ["Employee", "Code", "Attendance %", "Punctuality", "Avg hours", "Updates", "Supervisor", "Overall"],
        perfs.map(({ user, perf }) => [
          user.name,
          user.employeeCode,
          Math.round(perf.attendancePct),
          Math.round(perf.punctuality),
          fmtDuration(perf.avgWorkedMinutes),
          perf.updateCount,
          Math.round(perf.supervisor),
          Math.round(perf.overall),
        ]),
      ),
    );

  const workforcePdf = () =>
    printReport(
      `Project Workforce Report — ${fmtDateLong(now)}`,
      `<div class="kpis">
        <div class="kpi"><b>${stats.workforce}</b><span>Workforce</span></div>
        <div class="kpi"><b>${stats.currentlyWorking}</b><span>On site now</span></div>
        <div class="kpi"><b>${stats.presentToday}</b><span>Present today</span></div>
        <div class="kpi"><b>${Math.round(stats.attendancePct)}%</b><span>Attendance</span></div>
        <div class="kpi"><b>${fmtDuration(stats.avgWorkedMinutes)}</b><span>Avg hours</span></div>
      </div>
      <table><thead><tr><th>Project</th><th>Status</th><th>Assigned</th><th>Present today</th></tr></thead><tbody>
      ${state.projects
        .map((p) => {
          const present = state.attendance.filter(
            (a) => a.projectId === p.id && a.date === todayISO(now) && a.checkIn,
          ).length;
          return `<tr><td>${p.name}</td><td><span class="chip">${p.status}</span></td><td>${p.employeeIds.length}</td><td>${present}</td></tr>`;
        })
        .join("")}
      </tbody></table>`,
    );

  return (
    <div>
      <ScreenHeader title="More" sub="Reports · performance · alerts · settings" />
      <div className="flex flex-col gap-4 px-4">
        <Segmented<Tab>
          ariaLabel="More sections"
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: "reports", label: "Reports" },
            { value: "performance", label: "Performance" },
            { value: "updates", label: "Work updates" },
            { value: "alerts", label: `Alerts${alerts.filter((n) => !n.read).length ? ` (${alerts.filter((n) => !n.read).length})` : ""}` },
            { value: "settings", label: "Settings" },
          ]}
        />

        {tab === "reports" && (
          <>
            <div className="wf-card p-4">
              <SectionTitle>Attendance % — last 14 working days</SectionTitle>
              <BarTrend
                data={trend.map((t) => t.presentPct)}
                labels={trend.map((t) => t.date.slice(8))}
                format={(v) => `${Math.round(v)}%`}
                ariaLabel="Attendance trend"
                height={100}
              />
            </div>
            <ReportRow
              title="Daily attendance report"
              body="Present / absent / late / early-out with hours, for any day."
              actions={
                <>
                  <button
                    className="wf-btn wf-btn-ghost wf-btn-sm"
                    onClick={() => downloadCSV(`attendance-${todayISO(now)}.csv`, attendanceCSV(state, todayISO(now)))}
                  >
                    <IDownload size={14} /> CSV
                  </button>
                  <Link href="/manager/attendance" className="wf-btn wf-btn-ghost wf-btn-sm">
                    Open <IArrowR size={13} />
                  </Link>
                </>
              }
            />
            <ReportRow
              title="Employee movement report"
              body="Check-in/out, duration, distance, route and major stops per shift."
              actions={
                <Link href="/manager/history" className="wf-btn wf-btn-ghost wf-btn-sm">
                  Open <IArrowR size={13} />
                </Link>
              }
            />
            <ReportRow
              title="Project workforce report"
              body="Workforce by project, onsite counts and attendance trends."
              actions={
                <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={workforcePdf}>
                  <IFile size={14} /> PDF
                </button>
              }
            />
            <ReportRow
              title="Performance report"
              body="Scores across attendance, punctuality, hours, updates and rating."
              actions={
                <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={performanceCSVExport}>
                  <IDownload size={14} /> CSV
                </button>
              }
            />
            <ReportRow
              title="Full attendance history"
              body="Every record in the retention window, ready for payroll."
              actions={
                <button
                  className="wf-btn wf-btn-ghost wf-btn-sm"
                  onClick={() => downloadCSV("attendance-all.csv", attendanceCSV(state))}
                >
                  <IDownload size={14} /> CSV
                </button>
              }
            />
          </>
        )}

        {tab === "performance" && (
          <>
            {attention.length > 0 && (
              <div className="wf-card border-[rgba(246,167,35,0.35)] p-4">
                <SectionTitle>Needs attention</SectionTitle>
                <div className="flex flex-col gap-2">
                  {attention.map((a) => (
                    <Link
                      key={a.user.id}
                      href={`/manager/employee?id=${a.user.id}`}
                      className="flex items-center gap-3 rounded-lg px-1 py-1 transition hover:bg-[var(--wf-surface2)]"
                    >
                      <Avatar name={a.user.name} hue={a.user.avatarHue} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.84rem] font-semibold">{a.user.name}</span>
                        <span className="block truncate text-[0.68rem] text-[var(--wf-amber)]">
                          {a.reasons.join(" · ")}
                        </span>
                      </span>
                      <span className="text-[0.8rem] font-bold tabular-nums">{Math.round(a.score)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {perfs.map(({ user, perf }, i) => (
                <Link
                  key={user.id}
                  href={`/manager/employee?id=${user.id}`}
                  className="wf-card2 flex items-center gap-3 px-3.5 py-3 transition hover:border-[var(--wf-line-strong)]"
                >
                  <span className="w-5 text-center text-[0.78rem] font-bold tabular-nums text-[var(--wf-faint)]">
                    {i + 1}
                  </span>
                  <Avatar name={user.name} hue={user.avatarHue} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.86rem] font-semibold">{user.name}</span>
                    <span className="block text-[0.68rem] text-[var(--wf-muted)]">
                      {pct(perf.attendancePct)} att · {perf.lateCount} late · {perf.updateCount} updates ·
                      avg {fmtDuration(perf.avgWorkedMinutes)}
                    </span>
                  </span>
                  <span
                    className="wf-display text-lg font-bold tabular-nums"
                    style={{
                      color:
                        perf.overall >= 75
                          ? "var(--wf-green)"
                          : perf.overall >= 55
                            ? "var(--wf-amber)"
                            : "var(--wf-red)",
                    }}
                  >
                    {Math.round(perf.overall)}
                  </span>
                </Link>
              ))}
            </div>
            <div className="wf-card p-4">
              <SectionTitle>Scoring model (transparent)</SectionTitle>
              <ScoreBars
                rows={[
                  { label: "Attendance", value: 30, weight: "weight", color: "var(--wf-green)" },
                  { label: "Punctuality", value: 20, weight: "weight", color: "var(--wf-amber)" },
                  { label: "Work updates", value: 20, weight: "weight", color: "var(--wf-violet)" },
                  { label: "Working hours", value: 15, weight: "weight", color: "var(--wf-blue)" },
                  { label: "Supervisor rating", value: 15, weight: "weight", color: "var(--wf-orange)" },
                ]}
              />
              <p className="mt-3 border-t border-[var(--wf-line)] pt-2.5 text-[0.72rem] leading-snug text-[var(--wf-faint)]">
                GPS distance travelled is deliberately excluded — movement data is
                an operational presence signal, not a productivity measure.
              </p>
            </div>
          </>
        )}

        {tab === "updates" && (
          <div className="flex flex-col gap-2.5">
            {state.updates.slice(0, 30).map((u) => {
              const emp = state.users.find((x) => x.id === u.employeeId);
              const proj = state.projects.find((p) => p.id === u.projectId);
              return (
                <article key={u.id} className="wf-card2 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Avatar name={emp?.name ?? "?"} hue={emp?.avatarHue ?? 0} size={26} />
                    <span className="text-[0.82rem] font-semibold">{emp?.name}</span>
                    <Chip tone={u.kind === "daily" ? "blue" : "neutral"}>
                      {u.kind === "daily" ? "Daily" : u.category}
                    </Chip>
                    <span className="ml-auto text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                      {fmtDateLong(u.date)} · {fmtTime(u.at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[0.84rem] leading-relaxed text-[var(--wf-muted)]">
                    {u.description}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-[0.66rem] text-[var(--wf-faint)]">
                    {proj?.name}
                    {u.place ? (
                      <span className="flex items-center gap-1">
                        · <IMapPin size={10} /> {u.place}
                      </span>
                    ) : null}
                  </p>
                </article>
              );
            })}
          </div>
        )}

        {tab === "alerts" && (
          <div className="flex flex-col gap-2">
            {alerts.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--wf-muted)]">No notifications.</p>
            )}
            {alerts.slice(0, 40).map((n) => (
              <div key={n.id} className={`wf-card2 flex items-start gap-3 px-3.5 py-3 ${n.read ? "opacity-70" : ""}`}>
                <span
                  className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                  style={{
                    background: "var(--wf-surface3)",
                    color:
                      n.severity === "critical"
                        ? "var(--wf-red)"
                        : n.severity === "warning"
                          ? "var(--wf-amber)"
                          : n.severity === "success"
                            ? "var(--wf-green)"
                            : "var(--wf-blue)",
                  }}
                >
                  {n.severity === "success" ? <ICheckCircle size={16} /> : n.severity === "info" ? <IInfo size={16} /> : <IAlert size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.86rem] font-semibold leading-snug">{n.title}</p>
                  <p className="text-[0.76rem] leading-snug text-[var(--wf-muted)]">{n.body}</p>
                  <p className="mt-0.5 text-[0.66rem] text-[var(--wf-faint)]">{fmtRelative(n.at, now)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "settings" && (
          <>
            <div className="wf-card flex flex-col gap-4 p-4">
              <SectionTitle>Tracking policy</SectionTitle>
              <Field
                label={`GPS sampling — every ${state.settings.samplingSeconds}s`}
                hint="Balances route detail against battery and data use on workers' phones."
              >
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={state.settings.samplingSeconds}
                  onChange={(e) => updateSettings({ samplingSeconds: Number(e.target.value) })}
                  className="w-full accent-[var(--wf-amber)]"
                />
              </Field>
              <Field
                label={`Accuracy floor — reject fixes worse than ±${state.settings.accuracyFloor}m`}
              >
                <input
                  type="range"
                  min={15}
                  max={100}
                  step={5}
                  value={state.settings.accuracyFloor}
                  onChange={(e) => updateSettings({ accuracyFloor: Number(e.target.value) })}
                  className="w-full accent-[var(--wf-amber)]"
                />
              </Field>
              <Field
                label={`Data retention — ${state.settings.retentionDays} days`}
                hint="Location history older than this is purged."
              >
                <input
                  type="range"
                  min={30}
                  max={365}
                  step={30}
                  value={state.settings.retentionDays}
                  onChange={(e) => updateSettings({ retentionDays: Number(e.target.value) })}
                  className="w-full accent-[var(--wf-amber)]"
                />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Satellite map style</p>
                  <p className="text-[0.72rem] text-[var(--wf-muted)]">Applies across all maps</p>
                </div>
                <Toggle
                  checked={state.settings.mapStyle === "satellite"}
                  onChange={(v) => updateSettings({ mapStyle: v ? "satellite" : "plan" })}
                  label="Satellite map style"
                />
              </div>
            </div>

            <div className="wf-inset flex items-start gap-2.5 px-3.5 py-3 text-[0.76rem] leading-relaxed text-[var(--wf-muted)]">
              <IShield size={15} className="mt-0.5 shrink-0 text-[var(--wf-green)]" />
              Role-based access: employees see only their own records; managers
              see assigned projects. Location is captured strictly between
              check-in and checkout, transmitted encrypted, and every geofence
              or assignment change is audit-logged below.
            </div>

            <div className="wf-card p-4">
              <SectionTitle>Audit log</SectionTitle>
              <div className="flex flex-col gap-2">
                {state.audit.slice(0, 8).map((a) => {
                  const actor = state.users.find((u) => u.id === a.actorId);
                  return (
                    <div key={a.id} className="flex items-baseline gap-2 text-[0.76rem]">
                      <span className="shrink-0 tabular-nums text-[var(--wf-faint)]">
                        {fmtDateLong(a.at)}
                      </span>
                      <span className="font-semibold">{a.action}</span>
                      <span className="truncate text-[var(--wf-muted)]">
                        {actor?.name ?? a.actorId} — {a.detail ?? a.target}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2.5">
              <button className="wf-btn wf-btn-ghost flex-1" onClick={resetDemo}>
                <IRefresh size={15} /> Reset demo data
              </button>
              <button
                className="wf-btn wf-btn-ghost flex-1"
                onClick={() => {
                  logout();
                  router.replace("/");
                }}
              >
                <ILogout size={15} /> Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReportRow({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="wf-card flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-[0.76rem] text-[var(--wf-muted)]">{body}</p>
      </div>
      <div className="flex shrink-0 gap-2">{actions}</div>
    </div>
  );
}
