"use client";

/**
 * Reports — its own screen, not a tab.
 *
 * It was one of five segments on the More page, which meant the exports
 * shared a scroll position and a back button with settings, alerts and
 * work updates. A report is somewhere you go to do a thing and leave;
 * that is a page.
 */

import Link from "next/link";
import { useMemo } from "react";
import { FeatureGate, UpgradeNotice, useFeature } from "@/components/FeatureGate";
import { ScreenHeader } from "@/components/shell";
import { SectionTitle, useNowTick } from "@/components/ui";
import { BarTrend } from "@/components/charts";
import { IArrowR, IDownload, IFile } from "@/components/WfIcons";
import { fmtDateLong, fmtDuration, todayISO } from "@/lib/format";
import { attendanceTrend, dashboardStats, performanceFor } from "@/lib/metrics";
import { attendanceCSV, downloadCSV, printReport, toCSV } from "@/lib/reports";
import { useWorkforce } from "@/lib/store";

export default function ManagerReports() {
  const { state } = useWorkforce();
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
  const stats = useMemo(() => dashboardStats(state, now), [state, now]);
  const trend = useMemo(() => attendanceTrend(state, 14, undefined, now), [state, now]);
  const canExport = useFeature("dataExport");
  const canAdvancedReports = useFeature("advancedReports");

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
      <ScreenHeader back title="Reports" sub="Workforce, attendance and performance" />
      <div className="flex flex-col gap-3 px-4">
            {!canExport && (
              <UpgradeNotice
                title="Export isn't available on your current plan."
                body="Reports stay viewable in-app. Ask your administrator to upgrade to download CSV or PDF copies."
                compact
              />
            )}
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
                    disabled={!canExport}
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
              title="Project workforce report"
              body="Workforce by project, onsite counts and attendance trends."
              actions={
                <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={!canExport} onClick={workforcePdf}>
                  <IFile size={14} /> PDF
                </button>
              }
            />
            <ReportRow
              title="Performance report"
              body="Scores across attendance, punctuality, hours, updates and rating."
              actions={
                <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={!canExport || !canAdvancedReports} onClick={performanceCSVExport}>
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
                  disabled={!canExport}
                  onClick={() => downloadCSV("attendance-all.csv", attendanceCSV(state))}
                >
                  <IDownload size={14} /> CSV
                </button>
              }
            />
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
