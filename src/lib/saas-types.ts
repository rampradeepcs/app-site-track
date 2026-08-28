/**
 * Workfence Platform — multi-tenant SaaS layer.
 *
 * Hierarchy: Platform → Super Admin → Client Organization → Projects →
 * Managers → Employees. Everything a client owns carries an `orgId`, and
 * every read in the workforce app is scoped by the signed-in user's org so
 * one tenant can never see another's workforce, routes or billing.
 */

/* ------------------------------------------------------------------ plans */

/** Capability switches a plan can grant. Checked before a feature runs. */
export interface FeatureSet {
  attendance: boolean;
  geofencing: boolean;
  liveTracking: boolean;
  routePlayback: boolean;
  workUpdates: boolean;
  shifts: boolean;
  breaks: boolean;
  overtime: boolean;
  salary: boolean;
  payroll: boolean;
  voiceNotes: boolean;
  petrolAllowance: boolean;
  foodAllowance: boolean;
  performance: boolean;
  advancedReports: boolean;
  dataExport: boolean;
  apiAccess: boolean;
  customBranding: boolean;
  customDomain: boolean;
  prioritySupport: boolean;
}

export const FEATURE_LABELS: Record<keyof FeatureSet, string> = {
  attendance: "Attendance",
  geofencing: "Geofencing",
  liveTracking: "Live GPS tracking",
  routePlayback: "Route playback",
  workUpdates: "Work updates",
  shifts: "Shift management",
  breaks: "Break tracking",
  overtime: "Overtime & bonus",
  salary: "Salary management",
  payroll: "Payroll",
  voiceNotes: "Checkout voice notes",
  petrolAllowance: "Petrol / travel allowance",
  foodAllowance: "Food allowance",
  performance: "Performance analytics",
  advancedReports: "Advanced reports",
  dataExport: "Export (CSV / PDF)",
  apiAccess: "API access",
  customBranding: "Custom branding",
  customDomain: "Custom domain",
  prioritySupport: "Priority support",
};

/** Numeric ceilings. `null` means unlimited. */
export interface PlanLimits {
  employees: number | null;
  managers: number | null;
  projects: number | null;
  storageGb: number | null;
  /** Days of location history kept before purge. */
  routeRetentionDays: number;
  /** Monthly API call allowance; 0 when API access is off. */
  apiCallsPerMonth: number;
}

export type SupportLevel = "community" | "standard" | "priority" | "dedicated";

export interface Plan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  currency: "INR" | "USD";
  trialDays: number;
  limits: PlanLimits;
  features: FeatureSet;
  supportLevel: SupportLevel;
  /** Retired plans stay readable for existing subscribers but can't be sold. */
  archived: boolean;
  createdAt: number;
}

/* ---------------------------------------------------------- subscriptions */

export type SubscriptionStatus =
  | "trial"
  | "active"
  | "past-due"
  | "paused"
  | "suspended"
  | "cancelled";

export type BillingCycle = "monthly" | "annual";

/**
 * A client's subscription. `limitOverrides` / `featureOverrides` let the
 * Super Admin tailor one client without minting a bespoke global plan —
 * the effective entitlement is plan ⊕ overrides (see `entitlements.ts`).
 */
export interface Subscription {
  id: string;
  orgId: string;
  planId: string;
  status: SubscriptionStatus;
  cycle: BillingCycle;
  startedAt: number;
  /** Trial end; also the conversion deadline. */
  trialEndsAt?: number;
  renewsAt: number;
  cancelledAt?: number;
  /** Per-client ceilings that win over the plan's. */
  limitOverrides: Partial<PlanLimits>;
  /** Per-client capability switches that win over the plan's. */
  featureOverrides: Partial<FeatureSet>;
  /** Negotiated price replacing the plan's list price. */
  customPrice?: number;
  discountPercent?: number;
  /** Account credit applied to the next invoice. */
  creditBalance: number;
  /** What happens when a limit is hit. */
  onLimitReached: "block" | "warn" | "overage" | "auto-upgrade";
  notes?: string;
}

/* ----------------------------------------------------------- organisations */

export type OrgStatus =
  | "active"
  | "trial"
  | "suspended"
  | "payment-hold"
  | "cancelled";

export interface BillingProfile {
  legalName: string;
  contactName: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  /** Tax registration (GSTIN in India, VAT/EIN elsewhere) — free-form so no
   *  jurisdiction's rules are baked in. */
  taxIdLabel: string;
  taxId: string;
  taxPercent: number;
  currency: "INR" | "USD";
  paymentMethod: string;
}

export interface Organization {
  id: string;
  name: string;
  code: string;
  industry: string;
  website: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  country: string;
  timezone: string;
  status: OrgStatus;
  billing: BillingProfile;
  branding: {
    appName: string;
    accent: string;
    logoText: string;
    customDomain?: string;
  };
  createdAt: number;
  /** Set while suspended so the client sees why. */
  suspendedReason?: string;
}

/* --------------------------------------------------------------- invoices */

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "paid"
  | "pending"
  | "overdue"
  | "failed"
  | "refunded"
  | "cancelled";

export interface Invoice {
  id: string;
  number: string;
  orgId: string;
  subscriptionId: string;
  /** Pre-tax total. */
  amount: number;
  taxAmount: number;
  currency: "INR" | "USD";
  issuedAt: number;
  dueAt: number;
  paidAt?: number;
  status: InvoiceStatus;
  periodLabel: string;
  paymentMethod: string;
  failureReason?: string;
}

/* ------------------------------------------------------------------ usage */

/** A month of measured consumption, used for utilisation and health. */
export interface UsageSnapshot {
  orgId: string;
  month: string;
  employees: number;
  activeEmployees: number;
  managers: number;
  projects: number;
  storageGb: number;
  checkIns: number;
  trackingSessions: number;
  locationPoints: number;
  workUpdates: number;
  apiCalls: number;
  reportRuns: number;
  activeManagerDays: number;
  gpsErrors: number;
}

/* ---------------------------------------------------------------- support */

export type TicketStatus = "open" | "in-progress" | "waiting" | "resolved";
export type TicketKind =
  | "account"
  | "subscription"
  | "payment"
  | "technical"
  | "access";

export interface SupportTicket {
  id: string;
  orgId: string;
  subject: string;
  body: string;
  kind: TicketKind;
  status: TicketStatus;
  priority: "low" | "normal" | "high" | "urgent";
  openedAt: number;
  updatedAt: number;
  raisedBy: string;
}

/* -------------------------------------------------- platform-wide settings */

export interface PlatformSettings {
  defaultPlanId: string;
  defaultTrialDays: number;
  defaultSamplingSeconds: number;
  defaultRetentionDays: number;
  defaultLateGraceMinutes: number;
  defaultExitAlertMinutes: number;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  signupsEnabled: boolean;
  /** Global kill-switches. A client's explicit override still wins; these
   *  only supply the default when a client has expressed no preference. */
  globalFeatureFlags: Partial<FeatureSet>;
  supportEmail: string;
  termsUrl: string;
  privacyUrl: string;
}

/* ------------------------------------------------------- platform records */

/** Immutable from the normal admin UI — append-only, never edited in place. */
export interface PlatformAuditEntry {
  id: string;
  at: number;
  actorId: string;
  actorName: string;
  orgId?: string;
  action: string;
  target: string;
  previousValue?: string;
  newValue?: string;
  detail?: string;
  ip?: string;
}

/** Super Admin viewing a client's workspace, always recorded. */
export interface ImpersonationSession {
  orgId: string;
  asUserId: string;
  startedAt: number;
  reason: string;
}

export interface PlatformState {
  organizations: Organization[];
  plans: Plan[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  usage: UsageSnapshot[];
  tickets: SupportTicket[];
  platformAudit: PlatformAuditEntry[];
  platformSettings: PlatformSettings;
  impersonating: ImpersonationSession | null;
}
