/**
 * The commercial state Workfence starts from.
 *
 * The three plans and the platform settings are product configuration — what
 * this platform sells and how it behaves — so they are here.
 *
 * Everything a plan is *applied to* is not: no client organisations, no
 * subscriptions, no invoices nobody was sent, no usage nobody generated, no
 * tickets nobody raised. A tenant exists because somebody signed up for one.
 *
 * `supabase/migrations/*_plans_and_settings.sql` creates the same plans and
 * settings in Postgres, so the platform portal reads the same on either
 * backend. Change one and change the other.
 */

import type {
  FeatureSet,
  Organization,
  Plan,
  PlatformState,
  Subscription,
} from "./saas-types";

const DAY = 86_400_000;

const feat = (on: Array<keyof FeatureSet>): FeatureSet => ({
  attendance: false,
  geofencing: false,
  liveTracking: false,
  routePlayback: false,
  workUpdates: false,
  performance: false,
  advancedReports: false,
  dataExport: false,
  apiAccess: false,
  customBranding: false,
  customDomain: false,
  prioritySupport: false,
  ...Object.fromEntries(on.map((k) => [k, true])),
});

export function seedPlatform(now = Date.now()): PlatformState {
  /* ------------------------------------------------------------- plans */

  const plans: Plan[] = [
    {
      id: "plan_starter",
      name: "Starter",
      description: "Single-site contractors getting off paper attendance.",
      monthlyPrice: 7500,
      annualPrice: 75_000,
      currency: "INR",
      trialDays: 14,
      limits: {
        employees: 50,
        managers: 2,
        projects: 5,
        storageGb: 25,
        routeRetentionDays: 30,
        apiCallsPerMonth: 0,
      },
      features: feat(["attendance", "geofencing", "liveTracking"]),
      supportLevel: "community",
      archived: false,
      createdAt: now - 400 * DAY,
    },
    {
      id: "plan_growth",
      name: "Growth",
      description: "Multi-site builders who need movement history and reporting.",
      monthlyPrice: 24_000,
      annualPrice: 240_000,
      currency: "INR",
      trialDays: 14,
      limits: {
        employees: 250,
        managers: 10,
        projects: 25,
        storageGb: 150,
        routeRetentionDays: 180,
        apiCallsPerMonth: 25_000,
      },
      features: feat([
        "attendance",
        "geofencing",
        "liveTracking",
        "routePlayback",
        "workUpdates",
        "performance",
        "advancedReports",
        "dataExport",
      ]),
      supportLevel: "standard",
      archived: false,
      createdAt: now - 400 * DAY,
    },
    {
      id: "plan_enterprise",
      name: "Enterprise",
      description: "Large contractors needing custom limits, API and branding.",
      monthlyPrice: 68_000,
      annualPrice: 690_000,
      currency: "INR",
      trialDays: 30,
      limits: {
        employees: null,
        managers: null,
        projects: null,
        storageGb: 1000,
        routeRetentionDays: 730,
        apiCallsPerMonth: 500_000,
      },
      features: feat([
        "attendance",
        "geofencing",
        "liveTracking",
        "routePlayback",
        "workUpdates",
        "performance",
        "advancedReports",
        "dataExport",
        "apiAccess",
        "customBranding",
        "customDomain",
        "prioritySupport",
      ]),
      supportLevel: "priority",
      archived: false,
      createdAt: now - 400 * DAY,
    },
  ];

  /* ------------------------------------------------------------ tenants */

  // None. A tenant exists because somebody signed up for one — through
  // `/start` locally, or through the `provision_company` RPC against
  // Postgres. Shipping a placeholder client here is what used to make the
  // platform portal look busy while telling the owner nothing true.
  const organizations: Organization[] = [];
  const subscriptions: Subscription[] = [];

  return {
    organizations,
    plans,
    subscriptions,
    // Nothing has been billed, measured, raised or changed yet.
    invoices: [],
    usage: [],
    tickets: [],
    platformAudit: [],
    platformSettings: {
      defaultPlanId: "plan_growth",
      defaultTrialDays: 14,
      defaultSamplingSeconds: 15,
      defaultRetentionDays: 180,
      defaultLateGraceMinutes: 10,
      defaultExitAlertMinutes: 10,
      maintenanceMode: false,
      maintenanceMessage:
        "Workfence is undergoing scheduled maintenance. Attendance already captured on devices will sync automatically.",
      signupsEnabled: true,
      globalFeatureFlags: {},
      supportEmail: "support@workfence.app",
      termsUrl: "",
      privacyUrl: "",
    },
    impersonating: null,
  };
}
