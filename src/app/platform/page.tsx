"use client";

/**
 * Super Admin dashboard — the SaaS business view: clients, recurring
 * revenue, subscription health and how much the platform is actually used.
 */

import Link from "next/link";
import { useMemo } from "react";
import { PageHead } from "@/components/platform/PlatformShell";
import { BarTrend, Donut } from "@/components/charts";
import { HealthPill, MetricCard, StatusPill } from "@/components/platform/bits";
import { SectionTitle, useNowTick } from "@/components/ui";
import { entitlementsFor } from "@/lib/entitlements";
import { usePlatform } from "@/lib/platform-store";
import {
  clientGrowth,
  clientHealth,
  latestUsage,
  money,
  platformStats,
  revenueByPlan,
} from "@/lib/saas-metrics";
import { fmtRelative } from "@/lib/format";
import { IArrowR, IAlert, IUsers } from "@/components/WfIcons";

export default function PlatformDashboard() {
  const { platform } = usePlatform();
  const now = useNowTick(60);

  const stats = useMemo(() => platformStats(platform, now), [platform, now]);
  const growth = useMemo(() => clientGrowth(platform, 8, now), [platform, now]);
  const byPlan = useMemo(() => revenueByPlan(platform), [platform]);

  // Clients whose health has slipped, or who are near a hard limit.
  const atRisk = useMemo(
    () =>
      platform.organizations
        .filter((o) => o.status !== "cancelled")
        .map((o) => ({ org: o, health: clientHealth(platform, o.id, now) }))
        .filter((r) => r.health.score < 65)
        .sort((a, b) => a.health.score - b.health.score)
        .slice(0, 4),
    [platform, now],
  );

  const nearLimit = useMemo(
    () =>
      platform.organizations
        .map((o) => {
          const ent = entitlementsFor(platform, o.id);
          const u = latestUsage(platform, o.id);
          if (!u || !ent.limits.employees) return null;
          const ratio = u.employees / ent.limits.employees;
          return ratio >= 0.8 ? { org: o, ratio, used: u.employees, limit: ent.limits.employees } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b!.ratio - a!.ratio) as Array<{
        org: (typeof platform.organizations)[number];
        ratio: number;
        used: number;
        limit: number;
      }>,
    [platform],
  );

  const recentAudit = platform.platformAudit.slice(0, 5);

  return (
    <div className="pb-10">
      <PageHead
        title="Platform Dashboard"
        sub={`${stats.totalClients} client organisations · ${new Date(now).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`}
      />

      <div className="flex flex-col gap-6 px-5">
        {/* headline SaaS KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MetricCard label="Clients" value={stats.totalClients} sub={`${stats.activeClients} active`} tone="blue" />
          <MetricCard label="Active subscriptions" value={stats.paidClients} sub={`${stats.trialClients} on trial`} tone="green" />
          <MetricCard label="MRR" value={money(stats.mrr)} sub="recurring monthly" tone="violet" />
          <MetricCard label="ARR" value={money(stats.arr)} sub="annualised" tone="violet" />
          <MetricCard label="Outstanding" value={money(stats.outstanding)} sub={`${stats.failedPayments} failed`} tone={stats.outstanding > 0 ? "amber" : "neutral"} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MetricCard label="Trials expiring" value={stats.expiringTrials} sub="next 14 days" tone={stats.expiringTrials ? "amber" : "neutral"} />
          <MetricCard label="Renewals" value={stats.renewalsThisMonth} sub="this month" />
          <MetricCard label="Suspended" value={stats.suspendedClients} tone={stats.suspendedClients ? "red" : "neutral"} sub="incl. payment hold" />
          <MetricCard label="Active employees" value={stats.activeEmployees.toLocaleString("en-IN")} sub={`${stats.activeProjects} projects`} />
          <MetricCard label="Daily check-ins" value={stats.dailyCheckIns.toLocaleString("en-IN")} sub={`${stats.trackingSessions.toLocaleString("en-IN")} tracking sessions`} />
        </div>

        {/* growth + revenue mix */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="wf-card p-4 lg:col-span-2">
            <SectionTitle>Client growth — last 8 months</SectionTitle>
            <BarTrend
              data={growth.map((g) => g.total)}
              labels={growth.map((g) => g.label)}
              format={(v) => `${Math.round(v)} clients`}
              ariaLabel="Total clients per month"
              height={120}
            />
            <div className="mt-3 flex gap-5 border-t border-[var(--wf-line)] pt-3 text-[0.76rem]">
              <span className="text-[var(--wf-green)]">
                +{stats.newThisMonth} new this month
              </span>
              <span className="text-[var(--wf-red)]">
                −{stats.churnedThisMonth} churned
              </span>
              <span className="text-[var(--wf-muted)]">
                Subscription utilisation {Math.round(stats.subscriptionUtilisation)}%
              </span>
            </div>
          </div>
          <div className="wf-card p-4">
            <SectionTitle>Revenue by plan</SectionTitle>
            <div className="flex items-center gap-4">
              <Donut
                size={116}
                centerLabel={money(stats.mrr)}
                centerSub="MRR"
                segments={byPlan.map((r, i) => ({
                  value: r.mrr,
                  color: ["var(--wf-violet)", "var(--wf-blue)", "var(--wf-green)"][i % 3],
                  label: r.plan.name,
                }))}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {byPlan.map((r, i) => (
                  <div key={r.plan.id} className="flex items-center gap-2 text-[0.74rem]">
                    <i
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: ["var(--wf-violet)", "var(--wf-blue)", "var(--wf-green)"][i % 3] }}
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold">{r.plan.name}</span>
                    <span className="tabular-nums text-[var(--wf-muted)]">{r.clients}</span>
                    <span className="w-16 text-right tabular-nums">{money(r.mrr)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* attention lists */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <SectionTitle
              action={
                <Link href="/platform/clients" className="wf-btn wf-btn-quiet wf-btn-sm">
                  All clients <IArrowR size={13} />
                </Link>
              }
            >
              Accounts at risk
            </SectionTitle>
            <div className="flex flex-col gap-2">
              {atRisk.length === 0 && (
                <p className="wf-card2 px-4 py-5 text-center text-sm text-[var(--wf-muted)]">
                  Every account is healthy.
                </p>
              )}
              {atRisk.map(({ org, health }) => (
                <Link
                  key={org.id}
                  href={`/platform/client?id=${org.id}`}
                  className="wf-card2 flex min-w-0 items-center gap-3 px-3.5 py-3 transition hover:border-[var(--wf-line-strong)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.86rem] font-semibold">{org.name}</span>
                    <span className="block truncate text-[0.68rem] text-[var(--wf-muted)]">
                      {health.signals.filter((s) => s.tone === "bad").map((s) => s.label).join(" · ") ||
                        health.band}
                    </span>
                  </span>
                  <HealthPill score={health.score} />
                </Link>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>Near subscription limits</SectionTitle>
            <div className="flex flex-col gap-2">
              {nearLimit.length === 0 && (
                <p className="wf-card2 px-4 py-5 text-center text-sm text-[var(--wf-muted)]">
                  Nobody is close to a ceiling.
                </p>
              )}
              {nearLimit.map((r) => (
                <Link
                  key={r.org.id}
                  href={`/platform/client?id=${r.org.id}&tab=subscription`}
                  className="wf-card2 flex min-w-0 items-center gap-3 px-3.5 py-3 transition hover:border-[var(--wf-line-strong)]"
                >
                  <IUsers size={15} className="shrink-0 text-[var(--wf-amber)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.86rem] font-semibold">{r.org.name}</span>
                    <span className="block text-[0.68rem] text-[var(--wf-muted)]">
                      {r.used} / {r.limit} employees
                    </span>
                  </span>
                  <span className="text-[0.8rem] font-bold tabular-nums text-[var(--wf-amber)]">
                    {Math.round(r.ratio * 100)}%
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle
              action={
                <Link href="/platform/audit" className="wf-btn wf-btn-quiet wf-btn-sm">
                  Audit log <IArrowR size={13} />
                </Link>
              }
            >
              Recent platform activity
            </SectionTitle>
            <div className="flex flex-col gap-2">
              {recentAudit.map((a) => (
                <div key={a.id} className="wf-card2 px-3.5 py-2.5">
                  <p className="text-[0.78rem] font-semibold">
                    <span className="text-[var(--wf-violet)]">{a.action}</span> · {a.target}
                  </p>
                  {a.previousValue || a.newValue ? (
                    <p className="truncate text-[0.7rem] text-[var(--wf-muted)]">
                      {a.previousValue ?? "—"} → {a.newValue ?? "—"}
                    </p>
                  ) : null}
                  <p className="text-[0.64rem] text-[var(--wf-faint)]">{fmtRelative(a.at, now)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* clients table */}
        <div className="wf-card overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-4">
            <SectionTitle>All clients</SectionTitle>
            <Link href="/platform/clients" className="wf-btn wf-btn-quiet wf-btn-sm">
              Manage <IArrowR size={13} />
            </Link>
          </div>
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Plan</th>
                  <th className="text-right">Users</th>
                  <th className="text-right">Projects</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th className="text-right">MRR</th>
                </tr>
              </thead>
              <tbody>
                {platform.organizations.map((o) => {
                  const ent = entitlementsFor(platform, o.id);
                  const u = latestUsage(platform, o.id);
                  const h = clientHealth(platform, o.id, now);
                  const sub = platform.subscriptions.find((s) => s.orgId === o.id);
                  const plan = platform.plans.find((p) => p.id === sub?.planId);
                  return (
                    <tr key={o.id}>
                      <td>
                        <Link
                          href={`/platform/client?id=${o.id}`}
                          className="inline-block py-1.5 font-semibold hover:text-[var(--wf-violet)]"
                        >
                          {o.name}
                        </Link>
                        <span className="block text-[0.66rem] text-[var(--wf-faint)]">{o.code}</span>
                      </td>
                      <td className="text-[var(--wf-muted)]">
                        {ent.planName}
                        {(ent.overriddenLimits.length > 0 || ent.overriddenFeatures.length > 0) && (
                          <span className="ml-1 rounded bg-[rgba(167,139,250,0.16)] px-1 py-0.5 text-[0.58rem] font-bold text-[var(--wf-violet)]">
                            CUSTOM
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{u?.employees ?? 0}</td>
                      <td className="text-right tabular-nums">{u?.projects ?? 0}</td>
                      <td><StatusPill status={o.status} /></td>
                      <td><HealthPill score={h.score} /></td>
                      <td className="text-right tabular-nums">
                        {sub && plan ? money(
                          sub.status === "trial" ? 0 : sub.customPrice ?? (sub.cycle === "annual" ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice),
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {platform.platformSettings.maintenanceMode && (
          <p className="wf-inset flex items-center gap-2 border-[rgba(246,167,35,0.4)] px-4 py-3 text-[0.8rem] font-semibold text-[var(--wf-amber)]">
            <IAlert size={16} /> Maintenance mode is ON — client apps are showing the maintenance notice.
          </p>
        )}
      </div>
    </div>
  );
}
