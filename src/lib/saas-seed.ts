/**
 * The commercial state SiteTrack starts from.
 *
 * The three plans are product configuration — what the platform sells — so
 * they are here. Everything a plan is *applied to* is not: no invented client
 * organisations, no invoices nobody was sent, no usage nobody generated, no
 * support tickets nobody raised. One tenant exists, on a trial of the default
 * plan, and the rest accumulates from real use.
 *
 * `supabase/bootstrap.sql` creates the same plans and the same single tenant,
 * so the platform portal reads the same on either backend.
 */

import { DEMO_ORG_ID } from "./seed";
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

  /* ------------------------------------------------------------ tenant */

  // The one organisation, matching the workforce store's DEMO_ORG_ID so a
  // manager signing in lands inside a client the platform owner can also see.
  const organizations: Organization[] = [
    {
      id: DEMO_ORG_ID,
      name: "Nachi Tekneka",
      code: "CL-1001",
      industry: "Construction",
      website: "",
      contactName: "Demo Admin",
      contactEmail: "admin@sitetrack.demo",
      contactPhone: "+91 90000 00002",
      country: "India",
      timezone: "Asia/Kolkata",
      status: "trial",
      billing: {
        legalName: "Nachi Tekneka",
        contactName: "Demo Admin",
        email: "admin@sitetrack.demo",
        phone: "+91 90000 00002",
        addressLine: "Peelamedu",
        city: "Coimbatore",
        state: "Tamil Nadu",
        postcode: "641004",
        country: "India",
        taxIdLabel: "GSTIN",
        taxId: "",
        taxPercent: 18,
        currency: "INR",
        paymentMethod: "",
      },
      branding: {
        appName: "SiteTrack",
        accent: "#f6a723",
        logoText: "NT",
      },
      createdAt: now,
    },
  ];

  const subscriptions: Subscription[] = [
    {
      id: "sub_demo",
      orgId: DEMO_ORG_ID,
      planId: "plan_growth",
      status: "trial",
      cycle: "monthly",
      startedAt: now,
      trialEndsAt: now + 14 * DAY,
      renewsAt: now + 14 * DAY,
      limitOverrides: {},
      featureOverrides: {},
      creditBalance: 0,
      onLimitReached: "block",
    },
  ];

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
        "SiteTrack is undergoing scheduled maintenance. Attendance already captured on devices will sync automatically.",
      signupsEnabled: true,
      globalFeatureFlags: {},
      supportEmail: "support@sitetrack.demo",
      termsUrl: "",
      privacyUrl: "",
    },
    impersonating: null,
  };
}
