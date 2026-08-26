/**
 * Database types.
 *
 * Regenerate against a live project with:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
 *
 * Hand-maintained here so the repository layer is type-safe before a project
 * exists; the generated file is a drop-in replacement with the same shape.
 */

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type OrgRow = {
  id: string;
  name: string;
  code: string;
  industry: string;
  website: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  country: string;
  timezone: string;
  status: "active" | "trial" | "suspended" | "payment-hold" | "cancelled";
  billing: Json;
  branding: Json;
  suspended_reason: string | null;
  created_at: string;
}

export type PlanRow = {
  id: string;
  name: string;
  description: string;
  monthly_price: number;
  annual_price: number;
  currency: string;
  trial_days: number;
  max_employees: number | null;
  max_managers: number | null;
  max_projects: number | null;
  max_storage_gb: number | null;
  route_retention_days: number;
  api_calls_per_month: number;
  features: Json;
  support_level: string;
  archived: boolean;
  created_at: string;
}

export type SubscriptionRow = {
  id: string;
  org_id: string;
  plan_id: string;
  status: "trial" | "active" | "past-due" | "paused" | "suspended" | "cancelled";
  cycle: "monthly" | "annual";
  started_at: string;
  trial_ends_at: string | null;
  renews_at: string;
  cancelled_at: string | null;
  limit_overrides: Json;
  feature_overrides: Json;
  custom_price: number | null;
  discount_percent: number | null;
  credit_balance: number;
  on_limit_reached: string;
  notes: string | null;
}

export type UserRow = {
  id: string;
  auth_id: string | null;
  org_id: string | null;
  name: string;
  employee_code: string;
  role: "employee" | "manager" | "admin" | "superadmin";
  designation: string;
  department: string;
  phone: string;
  email: string | null;
  avatar_hue: number;
  photo: string | null;
  status: "active" | "inactive" | "on-leave";
  shift_start: number;
  shift_end: number;
  supervisor_rating: number | null;
  joined_at: string;
}

export type ProjectRow = {
  id: string;
  org_id: string;
  kind: "site" | "office";
  tracking_mode: "full-shift" | "outside-only";
  code: string;
  name: string;
  client: string;
  address: string;
  site_contact: string;
  site_contact_phone: string;
  manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: "planning" | "active" | "on-hold" | "completed";
  description: string;
  location: Json;
  geofence_kind: "polygon" | "circle";
  geofence: Json;
  zones: Json;
  rules: Json;
  created_at: string;
}

export type AttendanceRow = {
  id: string;
  org_id: string;
  employee_id: string;
  project_id: string;
  date: string;
  check_in: Json | null;
  check_out: Json | null;
  worked_minutes: number | null;
  distance_meters: number;
  status:
    | "present" | "absent" | "late" | "early-checkout"
    | "missing-checkout" | "on-leave" | "holiday";
  auto_closed: boolean;
  events: Json;
  created_at: string;
}

export type LocationPointRow = {
  id: number;
  org_id: string;
  attendance_id: string;
  employee_id: string;
  project_id: string;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number;
  heading: number;
  at: string;
  offline: boolean;
  /** Opens a new stretch of recording — see LocationPoint.segmentStart. */
  segment_start: boolean;
}

export type WorkUpdateRow = {
  id: string;
  org_id: string;
  employee_id: string;
  project_id: string;
  attendance_id: string | null;
  kind: string;
  category: string;
  description: string;
  detail: Json;
  photos: Json;
  coords: Json | null;
  place: string | null;
  date: string;
  at: string;
}

export type InvoiceRow = {
  id: string;
  number: string;
  org_id: string;
  subscription_id: string | null;
  amount: number;
  tax_amount: number;
  currency: string;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  status:
    | "draft" | "issued" | "paid" | "pending"
    | "overdue" | "failed" | "refunded" | "cancelled";
  period_label: string;
  payment_method: string;
  failure_reason: string | null;
}

export type ProjectMemberRow = {
  project_id: string;
  user_id: string;
  org_id: string;
  assigned_at: string;
}

export type UsageRow = {
  org_id: string;
  month: string;
  employees: number;
  active_employees: number;
  managers: number;
  projects: number;
  storage_gb: number;
  check_ins: number;
  tracking_sessions: number;
  location_points: number;
  work_updates: number;
  api_calls: number;
  report_runs: number;
  active_manager_days: number;
  gps_errors: number;
}

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
}

export type Database = {
  public: {
    Tables: {
      organizations: Table<OrgRow>;
      plans: Table<PlanRow>;
      subscriptions: Table<SubscriptionRow>;
      invoices: Table<InvoiceRow>;
      usage_snapshots: Table<UsageRow>;
      users: Table<UserRow>;
      projects: Table<ProjectRow>;
      attendance: Table<AttendanceRow>;
      location_points: Table<LocationPointRow>;
      work_updates: Table<WorkUpdateRow>;
      project_members: Table<ProjectMemberRow>;
    };
    // Canonical "empty" form used by `supabase gen types`; `Record<string, never>`
    // does not satisfy GenericSchema and silently collapses Insert to `never`.
    Views: { [_ in never]: never };
    Functions: {
      /** Self-serve signup — see supabase/migrations/*_self_serve_signup.sql. */
      provision_company: {
        Args: { payload: SignupPayload };
        Returns: ProvisionResult;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

/* --------------------------------------------------------------- signup --- */

/**
 * Payload for `provision_company`. Deliberately the same shape as the
 * wizard's `CompanyDraft`, so the live and demo paths hand the same object to
 * two different backends instead of each inventing a wire format.
 */
export interface SignupPayload {
  company: string;
  admin: { name: string; phone: string; email?: string };
  site: {
    name: string;
    address: string;
    location: { lat: number; lng: number };
    radius: number;
    trackingMode: "full-shift" | "outside-only";
  };
  office: {
    name: string;
    address: string;
    location: { lat: number; lng: number };
    radius: number;
  } | null;
  crew: Array<{ name: string; phone: string; designation?: string }>;
  timezone?: string;
}

export interface ProvisionResult {
  orgId: string;
  userId: string;
  siteId: string;
  officeId: string | null;
}
