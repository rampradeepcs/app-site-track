/**
 * Effective entitlements = plan ⊕ per-client overrides.
 *
 * Every gated feature and every limit check in the product resolves through
 * here, so the Super Admin can tailor one client without minting a bespoke
 * global plan, and so a client's explicit configuration is never silently
 * overwritten by a platform default.
 */

import type {
  FeatureSet,
  Organization,
  PlanLimits,
  PlatformState,
  Subscription,
} from "./saas-types";

export interface Entitlements {
  features: FeatureSet;
  limits: PlanLimits;
  planId: string;
  planName: string;
  /** Keys the client has customised away from their plan. */
  overriddenFeatures: Array<keyof FeatureSet>;
  overriddenLimits: Array<keyof PlanLimits>;
  /** False while suspended / cancelled / past-due-with-hold. */
  serviceable: boolean;
}

const NO_FEATURES: FeatureSet = {
  attendance: false,
  geofencing: false,
  liveTracking: false,
  routePlayback: false,
  workUpdates: false,
  shifts: false,
  breaks: false,
  overtime: false,
  salary: false,
  payroll: false,
  voiceNotes: false,
  petrolAllowance: false,
  foodAllowance: false,
  performance: false,
  advancedReports: false,
  dataExport: false,
  apiAccess: false,
  customBranding: false,
  customDomain: false,
  prioritySupport: false,
};

const NO_LIMITS: PlanLimits = {
  employees: 0,
  managers: 0,
  projects: 0,
  storageGb: 0,
  routeRetentionDays: 0,
  apiCallsPerMonth: 0,
};

export function subscriptionFor(
  p: PlatformState,
  orgId: string,
): Subscription | null {
  return p.subscriptions.find((s) => s.orgId === orgId) ?? null;
}

/**
 * Resolve what a client can actually do right now.
 *
 * Precedence, highest first: the client's own override → their plan →
 * the platform default flag. A platform flag only fills a gap; it never
 * overrides a choice made for that client.
 */
export function entitlementsFor(
  p: PlatformState,
  orgId: string,
): Entitlements {
  const sub = subscriptionFor(p, orgId);
  const plan = sub ? p.plans.find((x) => x.id === sub.planId) : undefined;

  if (!sub || !plan) {
    return {
      features: { ...NO_FEATURES },
      limits: { ...NO_LIMITS },
      planId: "",
      planName: "No subscription",
      overriddenFeatures: [],
      overriddenLimits: [],
      serviceable: false,
    };
  }

  const features = { ...plan.features };
  const globals = p.platformSettings.globalFeatureFlags;
  // Platform flags act as a floor for capabilities the plan leaves off and
  // the client has not decided on — they never revoke a granted feature.
  for (const k of Object.keys(features) as Array<keyof FeatureSet>) {
    if (globals[k] === true && sub.featureOverrides[k] === undefined) {
      features[k] = true;
    }
  }
  const overriddenFeatures: Array<keyof FeatureSet> = [];
  for (const k of Object.keys(sub.featureOverrides) as Array<keyof FeatureSet>) {
    const v = sub.featureOverrides[k];
    if (v !== undefined && v !== plan.features[k]) overriddenFeatures.push(k);
    if (v !== undefined) features[k] = v;
  }

  const limits = { ...plan.limits };
  const overriddenLimits: Array<keyof PlanLimits> = [];
  for (const k of Object.keys(sub.limitOverrides) as Array<keyof PlanLimits>) {
    const v = sub.limitOverrides[k];
    if (v !== undefined && v !== plan.limits[k]) overriddenLimits.push(k);
    if (v !== undefined) (limits[k] as number | null) = v as number | null;
  }

  const serviceable =
    sub.status === "active" || sub.status === "trial" || sub.status === "past-due";

  return {
    features,
    limits,
    planId: plan.id,
    planName: plan.name,
    overriddenFeatures,
    overriddenLimits,
    serviceable,
  };
}

/** Entitlements for an org that is suspended at the organisation level. */
export function orgServiceable(org: Organization | undefined): boolean {
  if (!org) return false;
  return org.status === "active" || org.status === "trial";
}

/* ------------------------------------------------------------ limit checks */

export interface LimitState {
  used: number;
  limit: number | null;
  /** 0–1; 0 when unlimited. */
  ratio: number;
  level: "ok" | "warning" | "critical" | "reached";
  label: string;
}

export function limitState(used: number, limit: number | null): LimitState {
  if (limit === null) {
    return { used, limit: null, ratio: 0, label: `${used} / ∞`, level: "ok" };
  }
  const ratio = limit === 0 ? 1 : used / limit;
  const level: LimitState["level"] =
    ratio >= 1 ? "reached" : ratio >= 0.9 ? "critical" : ratio >= 0.8 ? "warning" : "ok";
  return { used, limit, ratio, level, label: `${used} / ${limit}` };
}

export const LIMIT_TONE: Record<LimitState["level"], string> = {
  ok: "var(--wf-green)",
  warning: "var(--wf-amber)",
  critical: "var(--wf-orange)",
  reached: "var(--wf-red)",
};
