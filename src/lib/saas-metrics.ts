/**
 * Platform-level analytics: recurring revenue, client growth, subscription
 * health, usage utilisation and the client health score.
 */

import { entitlementsFor, limitState, subscriptionFor } from "./entitlements";
import type {
  Invoice,
  Organization,
  PlatformState,
  Plan,
  Subscription,
  UsageSnapshot,
} from "./saas-types";

const DAY = 86_400_000;

/* ---------------------------------------------------------------- revenue */

/** Normalised monthly value of one subscription, in its own currency. */
export function monthlyValue(sub: Subscription, plan: Plan | undefined): number {
  if (!plan) return 0;
  if (sub.status === "cancelled" || sub.status === "suspended") return 0;
  // Trials bill nothing until they convert.
  if (sub.status === "trial") return 0;
  const list =
    sub.cycle === "annual" ? (sub.customPrice ?? plan.annualPrice) / 12 : sub.customPrice ?? plan.monthlyPrice;
  const afterDiscount = list * (1 - (sub.discountPercent ?? 0) / 100);
  return Math.round(afterDiscount);
}

export interface PlatformStats {
  totalClients: number;
  activeClients: number;
  trialClients: number;
  expiringTrials: number;
  paidClients: number;
  suspendedClients: number;
  cancelledClients: number;
  mrr: number;
  arr: number;
  outstanding: number;
  failedPayments: number;
  renewalsThisMonth: number;
  activeEmployees: number;
  activeProjects: number;
  trackingSessions: number;
  dailyCheckIns: number;
  workUpdates: number;
  /** Mean of every client's limit utilisation across employees/projects. */
  subscriptionUtilisation: number;
  newThisMonth: number;
  churnedThisMonth: number;
}

export function platformStats(p: PlatformState, now = Date.now()): PlatformStats {
  const orgs = p.organizations;
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();
  const monthEndMs = monthStartMs + 32 * DAY;

  let mrr = 0;
  let utilSum = 0;
  let utilCount = 0;
  for (const sub of p.subscriptions) {
    const plan = p.plans.find((x) => x.id === sub.planId);
    mrr += monthlyValue(sub, plan);
    const ent = entitlementsFor(p, sub.orgId);
    const u = latestUsage(p, sub.orgId);
    if (u && ent.limits.employees) {
      utilSum += Math.min(1, u.employees / ent.limits.employees);
      utilCount++;
    }
  }

  const outstanding = p.invoices
    .filter((i) => i.status === "overdue" || i.status === "pending" || i.status === "issued")
    .reduce((t, i) => t + i.amount + i.taxAmount, 0);

  const usageNow = p.organizations.map((o) => latestUsage(p, o.id)).filter(Boolean) as UsageSnapshot[];

  return {
    totalClients: orgs.length,
    activeClients: orgs.filter((o) => o.status === "active").length,
    trialClients: orgs.filter((o) => o.status === "trial").length,
    expiringTrials: p.subscriptions.filter(
      (s) => s.status === "trial" && s.trialEndsAt && s.trialEndsAt - now < 14 * DAY,
    ).length,
    paidClients: p.subscriptions.filter((s) => s.status === "active").length,
    suspendedClients: orgs.filter((o) => o.status === "suspended" || o.status === "payment-hold").length,
    cancelledClients: orgs.filter((o) => o.status === "cancelled").length,
    mrr,
    arr: mrr * 12,
    outstanding,
    failedPayments: p.invoices.filter((i) => i.status === "failed").length,
    renewalsThisMonth: p.subscriptions.filter(
      (s) => s.renewsAt >= monthStartMs && s.renewsAt < monthEndMs && s.status !== "cancelled",
    ).length,
    activeEmployees: usageNow.reduce((t, u) => t + u.activeEmployees, 0),
    activeProjects: usageNow.reduce((t, u) => t + u.projects, 0),
    trackingSessions: usageNow.reduce((t, u) => t + u.trackingSessions, 0),
    dailyCheckIns: Math.round(usageNow.reduce((t, u) => t + u.checkIns, 0) / 30),
    workUpdates: usageNow.reduce((t, u) => t + u.workUpdates, 0),
    subscriptionUtilisation: utilCount ? (utilSum / utilCount) * 100 : 0,
    newThisMonth: orgs.filter((o) => o.createdAt >= monthStartMs).length,
    churnedThisMonth: p.subscriptions.filter(
      (s) => s.cancelledAt && s.cancelledAt >= monthStartMs,
    ).length,
  };
}

/** Revenue split by plan, largest first. */
export function revenueByPlan(p: PlatformState) {
  return p.plans
    .map((plan) => {
      const subs = p.subscriptions.filter((s) => s.planId === plan.id);
      return {
        plan,
        clients: subs.length,
        mrr: subs.reduce((t, s) => t + monthlyValue(s, plan), 0),
      };
    })
    .sort((a, b) => b.mrr - a.mrr);
}

/** Month-by-month client counts for the growth chart. */
export function clientGrowth(p: PlatformState, months = 8, now = Date.now()) {
  const out: Array<{ label: string; total: number; added: number; churned: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const start = d.getTime();
    const end = new Date(d).setMonth(d.getMonth() + 1);
    out.push({
      label: d.toLocaleDateString("en-IN", { month: "short" }),
      total: p.organizations.filter((o) => o.createdAt < end).length,
      added: p.organizations.filter((o) => o.createdAt >= start && o.createdAt < end).length,
      churned: p.subscriptions.filter(
        (s) => s.cancelledAt && s.cancelledAt >= start && s.cancelledAt < end,
      ).length,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ usage */

export function latestUsage(p: PlatformState, orgId: string): UsageSnapshot | null {
  const rows = p.usage.filter((u) => u.orgId === orgId).sort((a, b) => (a.month < b.month ? 1 : -1));
  return rows[0] ?? null;
}

export function usageHistory(p: PlatformState, orgId: string): UsageSnapshot[] {
  return p.usage.filter((u) => u.orgId === orgId).sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** Utilisation of every metered dimension for one client. */
export function utilisationFor(p: PlatformState, orgId: string) {
  const ent = entitlementsFor(p, orgId);
  const u = latestUsage(p, orgId);
  const zero = { used: 0, limit: null, ratio: 0, level: "ok" as const, label: "—" };
  if (!u) {
    return { employees: zero, managers: zero, projects: zero, storage: zero, api: zero };
  }
  return {
    employees: limitState(u.employees, ent.limits.employees),
    managers: limitState(u.managers, ent.limits.managers),
    projects: limitState(u.projects, ent.limits.projects),
    storage: limitState(Math.round(u.storageGb), ent.limits.storageGb),
    api: limitState(u.apiCalls, ent.limits.apiCallsPerMonth || null),
  };
}

/* ----------------------------------------------------------- health score */

export interface HealthSignal {
  label: string;
  tone: "good" | "warn" | "bad";
}

export interface ClientHealth {
  score: number;
  band: "Healthy" | "Stable" | "Needs attention" | "At risk";
  signals: HealthSignal[];
}

/**
 * Weighted, deliberately transparent: adoption and payment dominate, and
 * every contributing signal is surfaced next to the number.
 */
export function clientHealth(
  p: PlatformState,
  orgId: string,
  now = Date.now(),
): ClientHealth {
  const org = p.organizations.find((o) => o.id === orgId);
  const sub = subscriptionFor(p, orgId);
  const u = latestUsage(p, orgId);
  const ent = entitlementsFor(p, orgId);
  const signals: HealthSignal[] = [];

  // Adoption — how much of the seat allocation is actually being used (35).
  let adoption = 0;
  if (u && ent.limits.employees) {
    const seats = u.employees / ent.limits.employees;
    const active = u.employees ? u.activeEmployees / u.employees : 0;
    adoption = Math.min(1, seats * 0.4 + active * 0.6);
  } else if (u) {
    adoption = u.employees ? Math.min(1, u.activeEmployees / u.employees) : 0;
  }
  signals.push(
    adoption > 0.7
      ? { label: "High employee adoption", tone: "good" }
      : adoption > 0.4
        ? { label: "Moderate adoption", tone: "warn" }
        : { label: "Low usage", tone: "bad" },
  );

  // Activity — are shifts and updates actually happening (25).
  const activity = u ? Math.min(1, u.checkIns / Math.max(1, u.activeEmployees * 18)) : 0;
  signals.push(
    activity > 0.7
      ? { label: "Strong daily activity", tone: "good" }
      : activity > 0.35
        ? { label: "Some activity", tone: "warn" }
        : { label: "Little check-in activity", tone: "bad" },
  );

  // Payment standing (25).
  const overdue = p.invoices.filter(
    (i) => i.orgId === orgId && (i.status === "overdue" || i.status === "failed"),
  ).length;
  const payment = overdue === 0 ? 1 : overdue === 1 ? 0.45 : 0;
  signals.push(
    overdue === 0
      ? { label: "Payment up to date", tone: "good" }
      : { label: `${overdue} unpaid invoice${overdue > 1 ? "s" : ""}`, tone: "bad" },
  );

  // Breadth of feature use (15).
  const breadth = u
    ? Math.min(1, (Number(u.projects > 1) + Number(u.workUpdates > 20) + Number(u.reportRuns > 5) + Number(u.activeManagerDays > 10)) / 4)
    : 0;
  signals.push(
    u && u.projects > 1
      ? { label: "Multiple active projects", tone: "good" }
      : { label: "Single project only", tone: "warn" },
  );

  if (sub?.status === "trial" && sub.trialEndsAt && sub.trialEndsAt - now < 14 * DAY) {
    signals.push({ label: "Trial ending soon", tone: "warn" });
  }
  if (sub && sub.status !== "trial" && sub.renewsAt - now < 30 * DAY) {
    signals.push({ label: "Renewal approaching", tone: "warn" });
  }
  if (org?.status === "suspended") signals.push({ label: "Account suspended", tone: "bad" });

  const raw = adoption * 35 + activity * 25 + payment * 25 + breadth * 15;
  const score = Math.round(Math.max(0, Math.min(100, raw)));
  const band =
    score >= 80 ? "Healthy" : score >= 65 ? "Stable" : score >= 45 ? "Needs attention" : "At risk";
  return { score, band, signals };
}

export function healthTone(score: number): string {
  return score >= 80
    ? "var(--wf-green)"
    : score >= 65
      ? "var(--wf-blue)"
      : score >= 45
        ? "var(--wf-amber)"
        : "var(--wf-red)";
}

/* --------------------------------------------------------------- invoices */

export function invoicesFor(p: PlatformState, orgId: string): Invoice[] {
  return p.invoices.filter((i) => i.orgId === orgId).sort((a, b) => b.issuedAt - a.issuedAt);
}

export function orgOf(p: PlatformState, orgId: string): Organization | undefined {
  return p.organizations.find((o) => o.id === orgId);
}

/** Money formatter that respects the client's billing currency. */
export function money(amount: number, currency: "INR" | "USD" = "INR"): string {
  if (currency === "INR") {
    if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(2)}Cr`;
    if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(2)}L`;
    return `₹${amount.toLocaleString("en-IN")}`;
  }
  return `$${amount.toLocaleString("en-US")}`;
}
