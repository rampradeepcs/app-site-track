"use client";

/**
 * More — reports & exports, the performance dashboard, the all-projects
 * work-update feed, manager notifications, and app settings/audit log.
 */

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarTrend, ScoreBars } from "@/components/charts";
import { FeatureGate, UpgradeNotice, useFeature } from "@/components/FeatureGate";
import { AccountPanel, ScreenHeader } from "@/components/shell";
import { PersonaMenuEntry } from "@/components/demo/PersonaMenuEntry";
import { ThemeControl } from "@/components/ThemeControl";
import {
  Avatar,
  Chip,
  Field,
  SectionTitle,
  Segmented,
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
import { ERASE_DEVICE, confirmDestructive } from "@/lib/confirm";
import {
  IAlert,
  IArrowR,
  ICheckCircle,
  IDownload,
  IChart,
  IFile,
  IInfo,
  IMapPin,
  IRefresh,
  IShield,
  IChevronR,
  IWallet,
  IClock,
  INav,
} from "@/components/WfIcons";

type Tab = "updates" | "alerts" | "settings";

export default function MorePage() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-sm text-[var(--wf-muted)]">Loading…</div>}>
      <MoreInner />
    </Suspense>
  );
}

function MoreInner() {
  const wf = useWorkforce();
  const { state, updateSettings, markNotificationsRead, eraseLocalData } = wf;
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "updates";
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
  const canExport = useFeature("dataExport");
  const shiftsOn = useFeature("shifts");
  const payrollOn = useFeature("payroll");
  const petrolOn = useFeature("petrolAllowance");
  const canAdvancedReports = useFeature("advancedReports");

  const setTab = (t: Tab) => {
    router.replace(`/manager/more${t === "updates" ? "" : `?tab=${t}`}`);
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
      <ScreenHeader title="More" sub="Modules · work updates · alerts · settings" />
      <div className="flex flex-col gap-4 px-4">
        {/* modules that don't earn a permanent tab, per plan and role */}
        <div className="wf-card wf-list overflow-hidden">
          {shiftsOn && (
            <Link href="/manager/shifts" className="wf-row">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                <IClock size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.92rem] font-semibold">Shifts & breaks</span>
                <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                  Definitions, break rules, overtime, assignment
                </span>
              </span>
              <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
            </Link>
          )}
          {payrollOn && (
            <Link href="/manager/payroll" className="wf-row">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                <IWallet size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.92rem] font-semibold">Payroll</span>
                <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                  Monthly runs, OT approvals, exports
                </span>
              </span>
              <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
            </Link>
          )}
          {petrolOn && (
            <Link href="/manager/travel" className="wf-row">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                <INav size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.92rem] font-semibold">Travel & allowance</span>
                <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                  Work travel, petrol and food rules, approvals
                </span>
              </span>
              <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
            </Link>
          )}
          <Link href="/manager/live" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IMapPin size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Live map</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Everyone on shift, right now
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/reports" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IFile size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Reports</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Attendance, workforce and payroll exports
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/performance" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IChart size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Performance</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Last 14 days, ranked, and who needs attention
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
        </div>

        <Segmented<Tab>
          ariaLabel="More sections"
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: "updates", label: "Work updates" },
            { value: "alerts", label: `Alerts${alerts.filter((n) => !n.read).length ? ` (${alerts.filter((n) => !n.read).length})` : ""}` },
            { value: "settings", label: "Settings" },
          ]}
        />

        {/* Reports and Performance are screens now, not segments. Each is
            somewhere you go to do a thing and leave, which is a page — and
            as tabs they shared a scroll position and a back button with
            settings and alerts. */}
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
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Appearance</p>
                  <p className="mb-2 text-[0.72rem] text-[var(--wf-muted)]">
                    Applies to the whole app, maps included
                  </p>
                  <ThemeControl />
                </div>
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

            <PersonaMenuEntry />
            <AccountPanel />

            <button
              className="wf-btn wf-btn-ghost"
              onClick={() => confirmDestructive(ERASE_DEVICE, eraseLocalData)}
            >
              <IRefresh size={15} /> Erase this device
            </button>
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
