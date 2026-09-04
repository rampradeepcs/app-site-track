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
  vehicle: Json | null;
  /* Written by the database at every sign-in from the identity provider —
     see supabase/migrations/*_sync_profile_from_provider.sql. Never sent
     back up by the app. */
  auth_provider: string | null;
  auth_profile: Json | null;
  email_verified: boolean;
  last_sign_in_at: string | null;
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
  travel_tracking: boolean;
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
  shift_id: string | null;
  breaks: Json;
  overtime: Json | null;
  voice_note: Json | null;
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
  travel_session_id: string | null;
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

export type SupportTicketRow = {
  id: string;
  org_id: string;
  subject: string;
  body: string;
  kind: "account" | "subscription" | "payment" | "technical" | "access";
  status: "open" | "in-progress" | "waiting" | "resolved";
  priority: string;
  raised_by: string;
  opened_at: string;
  updated_at: string;
}

export type PlatformAuditRow = {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string;
  org_id: string | null;
  action: string;
  target: string;
  previous_value: string | null;
  new_value: string | null;
  detail: string | null;
  ip: string | null;
}

/** One row, id 1: the platform-wide settings object as JSON. */
export type PlatformSettingsRow = {
  id: number;
  settings: Json;
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


/* ------------------------------------- labour teams, captures and notes -- */

export type LabourTeamRow = {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  type: string;
  code: string;
  leader_id: string | null;
  site_engineer_id: string | null;
  supervisor_id: string | null;
  description: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  work_zone_id: string | null;
  shift_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LabourTeamMemberRow = {
  id: string;
  org_id: string;
  team_id: string;
  employee_id: string;
  joined_at: string;
  left_at: string | null;
  status: string;
  transferred_to_team_id: string | null;
};

export type GroupAttendanceRow = {
  id: string;
  org_id: string;
  project_id: string;
  team_id: string;
  shift_id: string | null;
  site_engineer_id: string;
  photos: string[];
  captured_at: string;
  lat: number | null;
  lng: number | null;
  geofence_status: string;
  face_count: number;
  matched_count: number;
  status: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  note: string | null;
};

export type GroupAttendanceMemberRow = {
  id: string;
  org_id: string;
  group_attendance_id: string;
  employee_id: string;
  detection_status: string;
  match_status: string;
  attendance_status: string;
  review_status: string;
  distance: number | null;
  attendance_id: string | null;
};

export type ProjectNoteRow = {
  id: string;
  org_id: string;
  project_id: string;
  author_id: string;
  title: string;
  body: string;
  category: string;
  priority: string;
  visibility: string;
  visible_to: string[];
  status: string;
  due_date: string | null;
  remind_at: string | null;
  reminder_sent: boolean;
  pinned: boolean;
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
};

export type ProjectNoteAttachmentRow = {
  id: string;
  org_id: string;
  note_id: string;
  file: string;
  name: string;
  type: string;
  size: number;
  created_by: string;
  created_at: string;
};

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
      /** usage_snapshots computed from the operational tables at read time. */
      usage_live: Table<UsageRow>;
      support_tickets: Table<SupportTicketRow>;
      platform_audit: Table<PlatformAuditRow>;
      platform_settings: Table<PlatformSettingsRow>;
      users: Table<UserRow>;
      projects: Table<ProjectRow>;
      attendance: Table<AttendanceRow>;
      location_points: Table<LocationPointRow>;
      work_updates: Table<WorkUpdateRow>;
      project_members: Table<ProjectMemberRow>;
      shifts: Table<ShiftRow>;
      shift_assignments: Table<ShiftAssignmentRow>;
      compensation: Table<CompRow>;
      pay_policies: Table<PayPolicyRow>;
      payroll_runs: Table<PayrollRunRow>;
      travel_sessions: Table<TravelSessionRow>;
      petrol_rules: Table<PetrolRuleRow>;
      food_rules: Table<FoodRuleRow>;
      allowance_decisions: Table<AllowanceDecisionRow>;
      labour_teams: Table<LabourTeamRow>;
      labour_team_members: Table<LabourTeamMemberRow>;
      group_attendance: Table<GroupAttendanceRow>;
      group_attendance_members: Table<GroupAttendanceMemberRow>;
      project_notes: Table<ProjectNoteRow>;
      project_note_attachments: Table<ProjectNoteAttachmentRow>;
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
      /**
       * Links the caller to an unclaimed worker record bearing their
       * confirmed address. Returns the row id, or null when there is none —
       * see supabase/migrations/*_claim_user_record_on_sign_in.sql.
       */
      claim_user_record: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      /**
       * Links (if needed) and refreshes the caller's own record from what
       * Google or Outlook said about them, and returns it. Empty for an
       * account on no company — see
       * supabase/migrations/*_sync_profile_from_provider.sql.
       */
      sync_my_profile: {
        Args: Record<string, never>;
        Returns: UserRow[];
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
  admin: { name: string; email: string; phone?: string };
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
  crew: Array<{ name: string; email?: string; phone?: string; designation?: string }>;
  timezone?: string;
}

export interface ProvisionResult {
  orgId: string;
  userId: string;
  siteId: string;
  officeId: string | null;
}

/* ------------------------- shifts, payroll, travel, allowances ----------- */

export type ShiftRow = {
  id: string;
  org_id: string;
  name: string;
  code: string;
  kind: "fixed" | "flexible" | "overnight" | "custom";
  start_minute: number;
  end_minute: number;
  required_minutes: number;
  grace_minutes: number;
  break_rules: Json;
  max_breaks_per_shift: number;
  min_break_minutes: number;
  max_break_minutes: number;
  employee_breaks_allowed: boolean;
  break_approval_required: boolean;
  overtime: Json;
  working_days: number[];
  project_ids: string[];
  status: "active" | "archived";
  created_at: string;
};

export type ShiftAssignmentRow = {
  id: string;
  org_id: string;
  employee_id: string;
  shift_id: string;
  effective_from: string;
  assigned_by: string | null;
  at: string;
};

export type CompRow = {
  id: string;
  org_id: string;
  employee_id: string;
  type: "monthly" | "daily" | "hourly";
  amount: number;
  effective_from: string;
  working_days_per_month: number;
  standard_day_minutes: number;
  note: string | null;
  set_by: string | null;
  at: string;
};

export type PayPolicyRow = {
  org_id: string;
  late_deduction: string;
  late_per_minute_rate: number;
  late_fixed_amount: number;
  early_out_deduction: string;
  early_per_minute_rate: number;
  early_fixed_amount: number;
  absence_deduction: string;
  excess_break_unpaid: boolean;
  manager_sees_salary: boolean;
  updated_at: string;
};

export type PayrollRunRow = {
  id: string;
  org_id: string;
  month: string;
  status: "draft" | "calculated" | "review" | "approved" | "locked";
  adjustments: Json;
  approved_by: string | null;
  approved_at: string | null;
  locked_at: string | null;
};

export type TravelSessionRow = {
  id: string;
  org_id: string;
  employee_id: string;
  project_id: string;
  attendance_id: string | null;
  date: string;
  start_anchor: Json;
  end_anchor: Json | null;
  purpose: string;
  note: string | null;
  vehicle_type: "two-wheeler" | "four-wheeler" | "none";
  distance_meters: number;
  approved_meters: number | null;
  flags: Json;
  status: "active" | "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  selfie: string | null;
};

export type PetrolRuleRow = {
  id: string;
  org_id: string;
  name: string;
  vehicle_type: "two-wheeler" | "four-wheeler" | "none";
  rate_per_km: number;
  max_daily_km: number | null;
  max_daily_amount: number | null;
  approval: "auto" | "manager";
  project_ids: string[];
  employee_ids: string[];
  effective_from: string;
  status: "active" | "archived";
  created_at: string;
};

export type FoodRuleRow = {
  id: string;
  org_id: string;
  name: string;
  meal: string;
  start_minute: number;
  end_minute: number;
  trigger_event: string;
  amount: number;
  project_ids: string[];
  employee_ids: string[];
  shift_ids: string[];
  approval: "auto" | "manager";
  effective_from: string;
  status: "active" | "archived";
  created_at: string;
};

export type AllowanceDecisionRow = {
  id: string;
  org_id: string;
  employee_id: string;
  date: string;
  rule_id: string;
  status: "approved" | "rejected";
  decided_by: string | null;
  at: string;
  note: string | null;
};
