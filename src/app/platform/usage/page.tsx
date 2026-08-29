"use client";

/** Usage & analytics — platform consumption, per-client and in aggregate. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHead } from "@/components/platform/PlatformShell";
import { HealthPill, MetricCard, UsageMeter } from "@/components/platform/bits";
import { BarTrend } from "@/components/charts";
import { SectionTitle, Segmented, useNowTick } from "@/components/ui";
import { usePlatform } from "@/lib/platform-store";
import {
  clientHealth,
  latestUsage,
  platformStats,
  usageHistory,
  utilisationFor,
} from "@/lib/saas-metrics";
import { downloadCSV, toCSV } from "@/lib/reports";
import { IArrowR, IDownload } from "@/components/WfIcons";

export default function UsagePage() {
  const { platform } = usePlatform();
  const now = useNowTick(60);
  const stats = useMemo(() => platformStats(platform, now), [platform, now]);
  const live = platform.organizations.filter((o) => o.status !== "cancelled");
  const [orgId, setOrgId] = useState(live[0]?.id ?? "");

  const history = useMemo(() => usageHistory(platform, orgId), [platform, orgId]);
  const util = useMemo(() => utilisationFor(platform, orgId), [platform, orgId]);
  const u = useMemo(() => latestUsage(platform, orgId), [platform, orgId]);
  const org = platform.organizations.find((o) => o.id === orgId);

  const exportCsv = () =>
    downloadCSV(
      "platform-usage.csv",
      toCSV(
        ["Client", "Month", "Employees", "Active", "Managers", "Projects", "Check-ins", "Tracking sessions", "Work updates", "Storage GB", "API calls"],
        platform.usage.map((r) => [
          platform.organizations.find((o) => o.id === r.orgId)?.name ?? r.orgId,
          r.month, r.employees, r.activeEmployees, r.managers, r.projects,
          r.checkIns, r.trackingSessions, r.workUpdates, r.storageGb, r.apiCalls,
        ]),
      ),
    );

  return (
    <div className="pb-10">
      <PageHead
        title="Usage & Analytics"
        sub="Is the platform actually being used, and by whom?"
        action={
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={exportCsv}>
            <IDownload size={14} /> Export CSV
          </button>
        }
      />
      <div className="flex flex-col gap-5 px-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <MetricCard label="Active employees" value={stats.activeEmployees.toLocaleString("en-IN")} tone="blue" />
          <MetricCard label="Active projects" value={stats.activeProjects} tone="green" />
          <MetricCard label="Daily check-ins" value={stats.dailyCheckIns.toLocaleString("en-IN")} />
          <MetricCard label="Tracking sessions" value={stats.trackingSessions.toLocaleString("en-IN")} tone="violet" />
          <MetricCard label="Work updates" value={stats.workUpdates.toLocaleString("en-IN")} />
          <MetricCard label="Subscription utilisation" value={`${Math.round(stats.subscriptionUtilisation)}%`} tone="amber" />
        </div>

        {/* per-client drill-down */}
        <div className="wf-card p-4">
          <SectionTitle>Client drill-down</SectionTitle>
          <div className="wf-scroll-x pb-1">
            <Segmented
              ariaLabel="Client"
              value={orgId}
              onChange={setOrgId}
              size="sm"
              options={live.map((o) => ({ value: o.id, label: o.name.split(" ")[0] }))}
            />
          </div>

          {u && org ? (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <UsageMeter label="Employees" state={util.employees} />
                <UsageMeter label="Managers" state={util.managers} />
                <UsageMeter label="Projects" state={util.projects} />
                <UsageMeter label="Storage" state={util.storage} unit="GB" />
                <UsageMeter label="API calls" state={util.api} />
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <div>
                  <p className="mb-1.5 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">Check-ins / month</p>
                  <BarTrend data={history.map((h) => h.checkIns)} labels={history.map((h) => h.month.slice(5))} format={(v) => `${Math.round(v)}`} ariaLabel="Check-ins per month" height={90} />
                </div>
                <div>
                  <p className="mb-1.5 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">Monthly active users</p>
                  <BarTrend data={history.map((h) => h.activeEmployees)} labels={history.map((h) => h.month.slice(5))} format={(v) => `${Math.round(v)}`} ariaLabel="Active users per month" height={90} />
                </div>
                <div>
                  <p className="mb-1.5 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">Work updates / month</p>
                  <BarTrend data={history.map((h) => h.workUpdates)} labels={history.map((h) => h.month.slice(5))} format={(v) => `${Math.round(v)}`} ariaLabel="Work updates per month" height={90} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--wf-line)] pt-4 lg:grid-cols-6">
                {[
                  ["Total employees", u.employees],
                  ["Monthly active", u.activeEmployees],
                  ["Attendance rate", `${Math.round((u.checkIns / Math.max(1, u.activeEmployees * 22)) * 100)}%`],
                  ["Location points", u.locationPoints.toLocaleString("en-IN")],
                  ["Report runs", u.reportRuns],
                  ["GPS errors", u.gpsErrors],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <p className="text-[0.66rem] uppercase tracking-wider text-[var(--wf-faint)]">{k}</p>
                    <p className="wf-display text-base tabular-nums">{v}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-[var(--wf-muted)]">No usage recorded for this client.</p>
          )}
        </div>

        {/* engagement league table */}
        <div className="wf-card overflow-hidden">
          <div className="px-4 pt-4"><SectionTitle>Engagement by client</SectionTitle></div>
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Client</th><th className="text-right">Employees</th><th className="text-right">Active</th>
                  <th className="text-right">Adoption</th><th className="text-right">Check-ins</th>
                  <th className="text-right">Updates</th><th>Health</th><th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {live.map((o) => {
                  const row = latestUsage(platform, o.id);
                  const h = clientHealth(platform, o.id, now);
                  const adoption = row && row.employees ? Math.round((row.activeEmployees / row.employees) * 100) : 0;
                  return (
                    <tr key={o.id}>
                      <td className="font-semibold">{o.name}</td>
                      <td className="text-right tabular-nums">{row?.employees ?? 0}</td>
                      <td className="text-right tabular-nums">{row?.activeEmployees ?? 0}</td>
                      <td className="text-right tabular-nums" style={{ color: adoption >= 70 ? "var(--wf-green)" : adoption >= 40 ? "var(--wf-amber)" : "var(--wf-red)" }}>
                        {adoption}%
                      </td>
                      <td className="text-right tabular-nums">{(row?.checkIns ?? 0).toLocaleString("en-IN")}</td>
                      <td className="text-right tabular-nums">{row?.workUpdates ?? 0}</td>
                      <td><HealthPill score={h.score} /></td>
                      <td>
                        {/* Icon-only, so it carries its own name — one arrow
                            per row is indistinguishable to a screen reader. */}
                        <Link
                          href={`/platform/client?id=${o.id}&tab=usage`}
                          aria-label={`Open usage detail for ${o.name}`}
                          title={`Usage detail — ${o.name}`}
                          className="wf-btn wf-btn-quiet wf-btn-sm"
                        >
                          <IArrowR size={13} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
