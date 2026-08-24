/**
 * Deterministic platform dataset: subscription plans, client organisations,
 * their subscriptions (including customised ones), invoices, monthly usage,
 * support tickets and the platform audit trail.
 *
 * The first org (`org_abc`) is the tenant the existing workforce demo data
 * belongs to, so signing in as a manager or employee lands inside a client
 * that the Super Admin can also see from the platform side.
 */

import type {
  FeatureSet,
  Invoice,
  InvoiceStatus,
  Organization,
  Plan,
  PlatformAuditEntry,
  PlatformState,
  Subscription,
  SupportTicket,
  UsageSnapshot,
} from "./saas-types";

const DAY = 86_400_000;

function rngFrom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function seedPlatform(now = Date.now()): PlatformState {
  const rng = rngFrom(0x5a45ed);

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

  /* ----------------------------------------------------- organisations */
  type Spec = {
    id: string;
    name: string;
    code: string;
    industry: string;
    city: string;
    contact: string;
    email: string;
    plan: string;
    status: Organization["status"];
    subStatus: Subscription["status"];
    cycle: Subscription["cycle"];
    ageDays: number;
    employees: number;
    managers: number;
    projects: number;
    activeRatio: number;
    accent: string;
    custom?: boolean;
  };

  const specs: Spec[] = [
    { id: "org_abc", name: "ABC Infra Developers", code: "CL-1001", industry: "Civil construction", city: "Coimbatore", contact: "Rajesh Narayanan", email: "rajesh@abcinfra.in", plan: "plan_growth", status: "active", subStatus: "active", cycle: "annual", ageDays: 420, employees: 186, managers: 8, projects: 14, activeRatio: 0.86, accent: "#f6a723", custom: true },
    { id: "org_sky", name: "Skyline Constructions", code: "CL-1002", industry: "Commercial towers", city: "Chennai", contact: "Deepa Raman", email: "deepa@skylinecon.in", plan: "plan_enterprise", status: "active", subStatus: "active", cycle: "annual", ageDays: 610, employees: 742, managers: 26, projects: 38, activeRatio: 0.91, accent: "#45b8f5" },
    { id: "org_vel", name: "Velan Builders", code: "CL-1003", industry: "Residential", city: "Madurai", contact: "Karthik Velan", email: "karthik@velanbuilders.in", plan: "plan_starter", status: "active", subStatus: "active", cycle: "monthly", ageDays: 240, employees: 44, managers: 2, projects: 4, activeRatio: 0.77, accent: "#2fd376" },
    { id: "org_nor", name: "Northgate Projects", code: "CL-1004", industry: "Industrial plants", city: "Hyderabad", contact: "Anita Rao", email: "anita@northgate.co.in", plan: "plan_growth", status: "active", subStatus: "past-due", cycle: "monthly", ageDays: 300, employees: 168, managers: 7, projects: 11, activeRatio: 0.62, accent: "#a78bfa" },
    { id: "org_mer", name: "Meridian Infra", code: "CL-1005", industry: "Highways", city: "Bengaluru", contact: "Suresh Iyer", email: "suresh@meridianinfra.in", plan: "plan_growth", status: "trial", subStatus: "trial", cycle: "monthly", ageDays: 18, employees: 31, managers: 3, projects: 2, activeRatio: 0.55, accent: "#ee6c2b" },
    { id: "org_hor", name: "Horizon Realty Works", code: "CL-1006", industry: "Residential", city: "Kochi", contact: "Fathima Noor", email: "fathima@horizonrw.in", plan: "plan_starter", status: "trial", subStatus: "trial", cycle: "monthly", ageDays: 6, employees: 12, managers: 1, projects: 1, activeRatio: 0.42, accent: "#f4574d" },
    { id: "org_gra", name: "Granite Edge Contractors", code: "CL-1007", industry: "Interiors", city: "Pune", contact: "Vikram Shah", email: "vikram@graniteedge.in", plan: "plan_starter", status: "suspended", cycle: "monthly", subStatus: "suspended", ageDays: 380, employees: 38, managers: 2, projects: 3, activeRatio: 0.18, accent: "#67748a" },
    { id: "org_pin", name: "Pinnacle Structures", code: "CL-1008", industry: "Bridges", city: "Nagpur", contact: "Rohit Deshmukh", email: "rohit@pinnaclestr.in", plan: "plan_growth", status: "active", subStatus: "active", cycle: "annual", ageDays: 150, employees: 122, managers: 5, projects: 9, activeRatio: 0.83, accent: "#22d3ee" },
    { id: "org_ter", name: "Terra Works India", code: "CL-1009", industry: "Earthworks", city: "Ahmedabad", contact: "Priyanka Mehta", email: "priyanka@terraworks.in", plan: "plan_starter", status: "cancelled", subStatus: "cancelled", cycle: "monthly", ageDays: 500, employees: 0, managers: 0, projects: 0, activeRatio: 0, accent: "#565863" },
  ];

  const organizations: Organization[] = specs.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    industry: s.industry,
    website: `www.${s.email.split("@")[1]}`,
    contactName: s.contact,
    contactEmail: s.email,
    contactPhone: `+91 ${90000 + Math.floor(rng() * 9999)} ${10000 + Math.floor(rng() * 89999)}`,
    country: "India",
    timezone: "Asia/Kolkata",
    status: s.status,
    billing: {
      legalName: `${s.name} Pvt Ltd`,
      contactName: s.contact,
      email: `accounts@${s.email.split("@")[1]}`,
      phone: `+91 ${90000 + Math.floor(rng() * 9999)} ${10000 + Math.floor(rng() * 89999)}`,
      addressLine: `${1 + Math.floor(rng() * 90)}, Industrial Estate`,
      city: s.city,
      state: s.city === "Bengaluru" ? "Karnataka" : s.city === "Hyderabad" ? "Telangana" : "Tamil Nadu",
      postcode: `${600000 + Math.floor(rng() * 40000)}`,
      country: "India",
      taxIdLabel: "GSTIN",
      taxId: `33AABCU${9000 + Math.floor(rng() * 999)}L1Z${Math.floor(rng() * 9)}`,
      taxPercent: 18,
      currency: "INR",
      paymentMethod: rng() > 0.5 ? "NEFT / Bank transfer" : "Corporate card ···· 4421",
    },
    branding: {
      appName: s.id === "org_sky" ? "Skyline Site" : "SiteTrack",
      accent: s.accent,
      logoText: s.name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join(""),
      customDomain: s.id === "org_sky" ? "sites.skylinecon.in" : undefined,
    },
    createdAt: now - s.ageDays * DAY,
    suspendedReason:
      s.status === "suspended" ? "Non-payment — two invoices overdue past 45 days" : undefined,
  }));

  /* ------------------------------------------------------ subscriptions */
  const subscriptions: Subscription[] = specs.map((s) => {
    const plan = plans.find((p) => p.id === s.plan)!;
    const started = now - s.ageDays * DAY;
    return {
      id: `sub_${s.id.slice(4)}`,
      orgId: s.id,
      planId: s.plan,
      status: s.subStatus,
      cycle: s.cycle,
      startedAt: started,
      trialEndsAt:
        s.subStatus === "trial" ? started + plan.trialDays * DAY : undefined,
      renewsAt:
        s.subStatus === "trial"
          ? started + plan.trialDays * DAY
          : now + Math.floor(rng() * 300 + 20) * DAY,
      cancelledAt: s.subStatus === "cancelled" ? now - 20 * DAY : undefined,
      // ABC negotiated headroom well past Growth's ceilings without moving
      // the whole account to Enterprise.
      limitOverrides: s.custom
        ? { employees: 500, projects: 50, managers: 20, storageGb: 500, routeRetentionDays: 730 }
        : {},
      featureOverrides: s.custom ? { apiAccess: true } : {},
      customPrice: s.custom ? 41_000 : undefined,
      discountPercent: s.id === "org_pin" ? 10 : undefined,
      creditBalance: s.id === "org_nor" ? 4_800 : 0,
      onLimitReached: s.custom ? "warn" : "block",
      notes: s.custom
        ? "Customised Growth — negotiated Enterprise-grade limits at renewal FY26."
        : undefined,
    };
  });

  /* ----------------------------------------------------------- invoices */
  const invoices: Invoice[] = [];
  let invNo = 3120;
  for (const s of specs) {
    if (s.subStatus === "trial") continue;
    const plan = plans.find((p) => p.id === s.plan)!;
    const sub = subscriptions.find((x) => x.orgId === s.id)!;
    const base = sub.customPrice ?? (s.cycle === "annual" ? plan.annualPrice : plan.monthlyPrice);
    const count = s.cycle === "annual" ? 2 : 6;
    for (let i = 0; i < count; i++) {
      const issued = now - (i * (s.cycle === "annual" ? 365 : 30) + 4) * DAY;
      if (issued < now - s.ageDays * DAY) break;
      let status: InvoiceStatus = "paid";
      if (i === 0) {
        if (s.subStatus === "past-due") status = "overdue";
        else if (s.subStatus === "suspended") status = "failed";
        else if (s.subStatus === "cancelled") status = "cancelled";
        else if (rng() > 0.75) status = "pending";
      }
      const amount = Math.round(base * (1 - (sub.discountPercent ?? 0) / 100));
      invoices.push({
        id: `inv_${s.id.slice(4)}_${i}`,
        number: `SITE-${invNo++}`,
        orgId: s.id,
        subscriptionId: sub.id,
        amount,
        taxAmount: Math.round(amount * 0.18),
        currency: "INR",
        issuedAt: issued,
        dueAt: issued + 15 * DAY,
        paidAt: status === "paid" ? issued + Math.floor(rng() * 12) * DAY : undefined,
        status,
        periodLabel:
          s.cycle === "annual"
            ? `Annual · ${new Date(issued).getFullYear()}`
            : new Date(issued).toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
        paymentMethod: organizations.find((o) => o.id === s.id)!.billing.paymentMethod,
        failureReason: status === "failed" ? "Card declined — insufficient funds" : undefined,
      });
    }
  }

  /* -------------------------------------------------------------- usage */
  const usage: UsageSnapshot[] = [];
  for (const s of specs) {
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now);
      d.setDate(1);
      d.setMonth(d.getMonth() - m);
      if (d.getTime() < now - s.ageDays * DAY) continue;
      // Growth curve: newer months carry more of the final headcount.
      const ramp = 0.55 + 0.45 * ((5 - m) / 5);
      const employees = Math.round(s.employees * ramp);
      const active = Math.round(employees * s.activeRatio);
      usage.push({
        orgId: s.id,
        month: monthKey(d),
        employees,
        activeEmployees: active,
        managers: Math.max(0, Math.round(s.managers * ramp)),
        projects: Math.max(0, Math.round(s.projects * ramp)),
        storageGb: Math.round(employees * 0.42 * 10) / 10,
        checkIns: Math.round(active * 21 * (0.8 + rng() * 0.3)),
        trackingSessions: Math.round(active * 20 * (0.8 + rng() * 0.3)),
        locationPoints: Math.round(active * 20 * 480 * (0.8 + rng() * 0.3)),
        workUpdates: Math.round(active * 4 * (0.5 + rng())),
        apiCalls: s.custom ? Math.round(16_000 * ramp) : 0,
        reportRuns: Math.round(s.managers * 6 * (0.4 + rng())),
        activeManagerDays: Math.round(s.managers * 18 * (0.5 + rng() * 0.6)),
        gpsErrors: Math.round(active * 0.4 * rng()),
      });
    }
  }

  /* ------------------------------------------------------------ tickets */
  const tickets: SupportTicket[] = [
    { id: "tkt_1", orgId: "org_nor", subject: "Invoice SITE-3126 shows as overdue after NEFT", body: "We transferred on the 12th, reference NEFT-88213. Please reconcile — access is showing a payment banner for our managers.", kind: "payment", status: "open", priority: "high", openedAt: now - 2 * DAY, updatedAt: now - 6 * 3_600_000, raisedBy: "Anita Rao" },
    { id: "tkt_2", orgId: "org_mer", subject: "Can we extend the trial by two weeks?", body: "Monsoon delayed our Bengaluru site mobilisation, so we haven't been able to evaluate live tracking properly.", kind: "subscription", status: "open", priority: "normal", openedAt: now - 1 * DAY, updatedAt: now - 20 * 3_600_000, raisedBy: "Suresh Iyer" },
    { id: "tkt_3", orgId: "org_abc", subject: "Need API access for our ERP payroll sync", body: "We want to pull attendance into Tally each night. Growth doesn't list API access.", kind: "technical", status: "resolved", priority: "normal", openedAt: now - 26 * DAY, updatedAt: now - 24 * DAY, raisedBy: "Rajesh Narayanan" },
    { id: "tkt_4", orgId: "org_gra", subject: "Account locked — cannot reach site supervisors", body: "Our managers can't sign in this morning.", kind: "access", status: "waiting", priority: "urgent", openedAt: now - 9 * DAY, updatedAt: now - 8 * DAY, raisedBy: "Vikram Shah" },
    { id: "tkt_5", orgId: "org_sky", subject: "Custom domain certificate renewal", body: "sites.skylinecon.in shows a certificate warning in Chrome since Tuesday.", kind: "technical", status: "in-progress", priority: "high", openedAt: now - 3 * DAY, updatedAt: now - 5 * 3_600_000, raisedBy: "Deepa Raman" },
  ];

  /* -------------------------------------------------------- audit trail */
  const platformAudit: PlatformAuditEntry[] = [
    { id: "pa_1", at: now - 24 * DAY, actorId: "u_owner", actorName: "Priya Venkatesh", orgId: "org_abc", action: "subscription.feature_override", target: "ABC Infra Developers", previousValue: "apiAccess: false", newValue: "apiAccess: true", detail: "Enabled API access on Growth for ERP payroll sync (ticket tkt_3)" },
    { id: "pa_2", at: now - 24 * DAY, actorId: "u_owner", actorName: "Priya Venkatesh", orgId: "org_abc", action: "subscription.limit_override", target: "ABC Infra Developers", previousValue: "employees: 250", newValue: "employees: 500", detail: "Negotiated headroom ahead of FY26 renewal" },
    { id: "pa_3", at: now - 12 * DAY, actorId: "u_owner", actorName: "Priya Venkatesh", orgId: "org_gra", action: "client.suspend", target: "Granite Edge Contractors", previousValue: "active", newValue: "suspended", detail: "Two invoices overdue past 45 days" },
    { id: "pa_4", at: now - 20 * DAY, actorId: "u_owner", actorName: "Priya Venkatesh", orgId: "org_ter", action: "subscription.cancel", target: "Terra Works India", previousValue: "active", newValue: "cancelled", detail: "Customer churned — moved to in-house system" },
    { id: "pa_5", at: now - 150 * DAY, actorId: "u_owner", actorName: "Priya Venkatesh", orgId: "org_pin", action: "client.create", target: "Pinnacle Structures", newValue: "Growth (annual)", detail: "Onboarded with 10% partner discount" },
    { id: "pa_6", at: now - 18 * DAY, actorId: "u_owner", actorName: "Priya Venkatesh", orgId: "org_sky", action: "subscription.upgrade", target: "Skyline Constructions", previousValue: "Growth", newValue: "Enterprise", detail: "Expanded to 38 sites; needed custom domain + branding" },
  ];

  return {
    organizations,
    plans,
    subscriptions,
    invoices,
    usage,
    tickets,
    platformAudit,
    platformSettings: {
      defaultPlanId: "plan_growth",
      defaultTrialDays: 14,
      defaultSamplingSeconds: 15,
      defaultRetentionDays: 180,
      defaultLateGraceMinutes: 10,
      defaultExitAlertMinutes: 10,
      maintenanceMode: false,
      maintenanceMessage: "SiteTrack is undergoing scheduled maintenance. Attendance already captured on devices will sync automatically.",
      signupsEnabled: true,
      globalFeatureFlags: {},
      supportEmail: "support@sitetrack.app",
      termsUrl: "https://sitetrack.app/terms",
      privacyUrl: "https://sitetrack.app/privacy",
    },
    impersonating: null,
  };
}
