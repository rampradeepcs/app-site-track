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
  IBell,
  IChart,
  ICheckCircle,
  IChevronR,
  IClock,
  IDownload,
  IFile,
  IInfo,
  IMapPin,
  INav,
  IClipboard,
  IRefresh,
  ISettings,
  IShield,
  IWallet,
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
  const unread = alerts.filter((n) => !n.read).length;
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
          <Link href="/manager/updates" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IClipboard size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Work updates</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                What the site reported today
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/alerts" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IBell size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">
                Alerts{unread ? ` (${unread})` : ""}
              </span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Geofence exits, missing checkouts, sync
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/settings" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <ISettings size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Settings</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Tracking, appearance and this device
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
        </div>

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
