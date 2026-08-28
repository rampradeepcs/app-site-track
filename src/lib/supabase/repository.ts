"use client";

/**
 * Repository layer — maps Postgres rows to the domain types the UI already
 * speaks, so screens are unchanged whether data comes from the local
 * store or from Supabase.
 *
 * Note what is deliberately absent: no `org_id` filters. Row-level security
 * applies them in the database, so a bug here cannot widen access — the
 * policy is the boundary, and these queries simply ask for what they need.
 */

import { requireSupabase } from "./client";
import type {
  AllowanceDecisionRow,
  AttendanceRow,
  CompRow,
  FoodRuleRow,
  InvoiceRow,
  LocationPointRow,
  OrgRow,
  PayPolicyRow,
  PayrollRunRow,
  PetrolRuleRow,
  PlanRow,
  ProjectRow,
  ShiftAssignmentRow,
  ShiftRow,
  TravelSessionRow,
  SubscriptionRow,
  UsageRow,
  UserRow,
  WorkUpdateRow,
} from "./types";
import type { ProvisionResult, SignupPayload } from "./types";
import type {
  AllowanceDecision,
  Attendance,
  AttendanceMark,
  CompRecord,
  FoodRule,
  LocationPoint,
  PayPolicy,
  PayrollRun,
  PetrolRule,
  Project,
  ShiftAssignment,
  ShiftDef,
  TravelSession,
  User,
  Vehicle,
  WorkUpdate,
} from "../types";
import type {
  Invoice,
  Organization,
  Plan,
  Subscription,
  UsageSnapshot,
} from "../saas-types";

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
const iso = (n: number) => new Date(n).toISOString();

/* ------------------------------------------------------------- mappers --- */

export function toUser(r: UserRow): User {
  return {
    vehicle: (r.vehicle as unknown as Vehicle) ?? undefined,
    id: r.id,
    orgId: r.org_id ?? "",
    name: r.name,
    employeeCode: r.employee_code,
    role: r.role,
    designation: r.designation,
    department: r.department,
    phone: r.phone,
    email: r.email ?? undefined,
    avatarHue: r.avatar_hue,
    photo: r.photo ?? undefined,
    status: r.status,
    projectIds: [],           // filled from project_members
    shiftStart: r.shift_start,
    shiftEnd: r.shift_end,
    joinedAt: ms(r.joined_at),
    supervisorRating: r.supervisor_rating ?? undefined,
  };
}

export function toProject(r: ProjectRow): Project {
  const fence = r.geofence as unknown as Project["geofence"];
  return {
    id: r.id,
    orgId: r.org_id,
    kind: r.kind,
    trackingMode: r.tracking_mode,
    code: r.code,
    name: r.name,
    client: r.client,
    address: r.address,
    siteContact: r.site_contact,
    siteContactPhone: r.site_contact_phone,
    managerId: r.manager_id ?? "",
    startDate: r.start_date ?? "",
    endDate: r.end_date ?? "",
    status: r.status,
    description: r.description,
    location: r.location as unknown as Project["location"],
    geofence: { ...fence, kind: r.geofence_kind },
    zones: (r.zones ?? []) as unknown as Project["zones"],
    employeeIds: [],          // filled from project_members
    rules: (r.rules ?? {}) as unknown as Project["rules"],
    createdAt: ms(r.created_at),
  };
}

export function toAttendance(r: AttendanceRow): Attendance {
  return {
    id: r.id,
    employeeId: r.employee_id,
    projectId: r.project_id,
    date: r.date,
    checkIn: (r.check_in as unknown as AttendanceMark) ?? null,
    checkOut: (r.check_out as unknown as AttendanceMark) ?? null,
    workedMinutes: r.worked_minutes ?? undefined,
    distanceMeters: Number(r.distance_meters),
    status: r.status,
    autoClosed: r.auto_closed,
    events: (r.events ?? []) as unknown as Attendance["events"],
    breaks: (r.breaks ?? []) as unknown as Attendance["breaks"],
    shiftId: r.shift_id ?? undefined,
    overtime: (r.overtime as unknown as Attendance["overtime"]) ?? undefined,
    voiceNote: (r.voice_note as unknown as Attendance["voiceNote"]) ?? undefined,
  };
}

export function toPoint(r: LocationPointRow): LocationPoint {
  return {
    id: String(r.id),
    employeeId: r.employee_id,
    projectId: r.project_id,
    attendanceId: r.attendance_id,
    lat: r.lat,
    lng: r.lng,
    accuracy: r.accuracy,
    speed: r.speed,
    heading: r.heading,
    at: ms(r.at),
    queued: r.offline,
    segmentStart: r.segment_start || undefined,
    travelSessionId: r.travel_session_id ?? undefined,
  };
}

export function toWorkUpdate(r: WorkUpdateRow): WorkUpdate {
  const d = (r.detail ?? {}) as Record<string, string>;
  return {
    id: r.id,
    employeeId: r.employee_id,
    projectId: r.project_id,
    attendanceId: r.attendance_id ?? undefined,
    kind: r.kind as WorkUpdate["kind"],
    category: r.category as WorkUpdate["category"],
    description: r.description,
    completed: d.completed,
    inProgress: d.inProgress,
    blockers: d.blockers,
    materials: d.materials,
    safety: d.safety,
    tomorrow: d.tomorrow,
    photos: (r.photos ?? []) as string[],
    coords: (r.coords as unknown as WorkUpdate["coords"]) ?? undefined,
    place: r.place ?? undefined,
    date: r.date,
    at: ms(r.at),
    // Anything read back from Postgres is, by definition, synced.
    status: "synced",
  };
}

export function toOrg(r: OrgRow): Organization {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    industry: r.industry,
    website: r.website,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    country: r.country,
    timezone: r.timezone,
    status: r.status,
    billing: r.billing as unknown as Organization["billing"],
    branding: r.branding as unknown as Organization["branding"],
    suspendedReason: r.suspended_reason ?? undefined,
    createdAt: ms(r.created_at),
  };
}

export function toPlan(r: PlanRow): Plan {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    monthlyPrice: Number(r.monthly_price),
    annualPrice: Number(r.annual_price),
    currency: r.currency as Plan["currency"],
    trialDays: r.trial_days,
    limits: {
      employees: r.max_employees,
      managers: r.max_managers,
      projects: r.max_projects,
      storageGb: r.max_storage_gb,
      routeRetentionDays: r.route_retention_days,
      apiCallsPerMonth: r.api_calls_per_month,
    },
    features: r.features as unknown as Plan["features"],
    supportLevel: r.support_level as Plan["supportLevel"],
    archived: r.archived,
    createdAt: ms(r.created_at),
  };
}

export function toSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id,
    orgId: r.org_id,
    planId: r.plan_id,
    status: r.status,
    cycle: r.cycle,
    startedAt: ms(r.started_at),
    trialEndsAt: r.trial_ends_at ? ms(r.trial_ends_at) : undefined,
    renewsAt: ms(r.renews_at),
    cancelledAt: r.cancelled_at ? ms(r.cancelled_at) : undefined,
    limitOverrides: (r.limit_overrides ?? {}) as Subscription["limitOverrides"],
    featureOverrides: (r.feature_overrides ?? {}) as Subscription["featureOverrides"],
    customPrice: r.custom_price ?? undefined,
    discountPercent: r.discount_percent ?? undefined,
    creditBalance: Number(r.credit_balance),
    onLimitReached: r.on_limit_reached as Subscription["onLimitReached"],
    notes: r.notes ?? undefined,
  };
}

export function toInvoice(r: InvoiceRow): Invoice {
  return {
    id: r.id,
    number: r.number,
    orgId: r.org_id,
    subscriptionId: r.subscription_id ?? "",
    amount: Number(r.amount),
    taxAmount: Number(r.tax_amount),
    currency: r.currency as Invoice["currency"],
    issuedAt: ms(r.issued_at),
    dueAt: ms(r.due_at),
    paidAt: r.paid_at ? ms(r.paid_at) : undefined,
    status: r.status,
    periodLabel: r.period_label,
    paymentMethod: r.payment_method,
    failureReason: r.failure_reason ?? undefined,
  };
}

export function toUsage(r: UsageRow): UsageSnapshot {
  return {
    orgId: r.org_id,
    month: r.month,
    employees: r.employees,
    activeEmployees: r.active_employees,
    managers: r.managers,
    projects: r.projects,
    storageGb: Number(r.storage_gb),
    checkIns: r.check_ins,
    trackingSessions: r.tracking_sessions,
    locationPoints: Number(r.location_points),
    workUpdates: r.work_updates,
    apiCalls: Number(r.api_calls),
    reportRuns: r.report_runs,
    activeManagerDays: r.active_manager_days,
    gpsErrors: r.gps_errors,
  };
}

/* ---------------------------------------------------------------- reads --- */

/** Everything the client app needs for the signed-in tenant, in one round. */
export async function fetchWorkforce() {
  const sb = requireSupabase();
  const [users, projects, members, attendance, updates] = await Promise.all([
    sb.from("users").select("*"),
    sb.from("projects").select("*"),
    sb.from("project_members").select("project_id,user_id"),
    sb.from("attendance").select("*").order("date", { ascending: false }).limit(2000),
    sb.from("work_updates").select("*").order("at", { ascending: false }).limit(500),
  ]);
  const err = users.error ?? projects.error ?? attendance.error ?? updates.error;
  if (err) throw err;

  const mapped = {
    users: (users.data ?? []).map(toUser),
    projects: (projects.data ?? []).map(toProject),
    attendance: (attendance.data ?? []).map(toAttendance),
    updates: (updates.data ?? []).map(toWorkUpdate),
  };
  // Re-hydrate the many-to-many both ways.
  for (const m of (members.data ?? []) as Array<{ project_id: string; user_id: string }>) {
    mapped.users.find((u) => u.id === m.user_id)?.projectIds.push(m.project_id);
    mapped.projects.find((p) => p.id === m.project_id)?.employeeIds.push(m.user_id);
  }
  return mapped;
}

/** Route for one shift — the heaviest read in the product, so it is scoped. */
export async function fetchTrail(attendanceId: string): Promise<LocationPoint[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("location_points")
    .select("*")
    .eq("attendance_id", attendanceId)
    .order("at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toPoint);
}

/** Platform-side state; RLS returns only this caller's slice. */
export async function fetchPlatform() {
  const sb = requireSupabase();
  const [orgs, plans, subs, invoices, usage] = await Promise.all([
    sb.from("organizations").select("*"),
    sb.from("plans").select("*"),
    sb.from("subscriptions").select("*"),
    sb.from("invoices").select("*").order("issued_at", { ascending: false }),
    sb.from("usage_snapshots").select("*"),
  ]);
  const err = orgs.error ?? plans.error ?? subs.error ?? invoices.error ?? usage.error;
  if (err) throw err;
  return {
    organizations: (orgs.data ?? []).map(toOrg),
    plans: (plans.data ?? []).map(toPlan),
    subscriptions: (subs.data ?? []).map(toSubscription),
    invoices: (invoices.data ?? []).map(toInvoice),
    usage: (usage.data ?? []).map(toUsage),
  };
}

/* --------------------------------------------------------------- writes --- */

export async function insertCheckIn(a: {
  /** Minted by the client, so the shift has one identity in both places. */
  id: string;
  orgId: string;
  employeeId: string;
  projectId: string;
  date: string;
  mark: AttendanceMark;
  status: Attendance["status"];
  /** Shift in force when the day opened, so lateness is reproducible. */
  shiftId?: string;
}) {
  const sb = requireSupabase();
  // Upsert, not insert: a device that captured the shift offline and flushes
  // twice must not create a second row, and the table's (employee, date,
  // project) unique constraint would reject the retry as an error the worker
  // cannot act on.
  const { data, error } = await sb
    .from("attendance")
    .upsert({
      id: a.id,
      org_id: a.orgId,
      employee_id: a.employeeId,
      project_id: a.projectId,
      date: a.date,
      check_in: a.mark as never,
      status: a.status,
      shift_id: a.shiftId ?? null,
    } as never)
    .select()
    .single();
  if (error) throw error;
  return toAttendance(data as AttendanceRow);
}

export async function insertCheckOut(
  attendanceId: string,
  patch: {
    mark: AttendanceMark;
    workedMinutes: number;
    distanceMeters: number;
    status: Attendance["status"];
    breaks?: Attendance["breaks"];
    overtime?: Attendance["overtime"];
    voiceNote?: Attendance["voiceNote"];
  },
) {
  const sb = requireSupabase();
  const { error } = await sb
    .from("attendance")
    .update({
      check_out: patch.mark as never,
      worked_minutes: patch.workedMinutes,
      distance_meters: patch.distanceMeters,
      status: patch.status,
      breaks: (patch.breaks ?? []) as never,
      overtime: (patch.overtime ?? null) as never,
      voice_note: (patch.voiceNote ?? null) as never,
    })
    .eq("id", attendanceId);
  if (error) throw error;
}

/** Breaks are written as they happen, so an interrupted shift keeps them. */
export async function updateBreaks(
  attendanceId: string,
  breaks: Attendance["breaks"],
) {
  const sb = requireSupabase();
  const { error } = await sb
    .from("attendance")
    .update({ breaks: (breaks ?? []) as never })
    .eq("id", attendanceId);
  if (error) throw error;
}

/** Overtime approval, rejection or an edited duration. */
export async function updateOvertime(
  attendanceId: string,
  overtime: Attendance["overtime"],
) {
  const sb = requireSupabase();
  const { error } = await sb
    .from("attendance")
    .update({ overtime: (overtime ?? null) as never })
    .eq("id", attendanceId);
  if (error) throw error;
}

/**
 * Location points are written in batches rather than one-per-fix: a shift
 * produces thousands, and batching is what keeps ingestion affordable and
 * lets an offline device flush its outbox in a single round trip.
 */
export async function insertPoints(points: LocationPoint[], orgId: string) {
  if (points.length === 0) return;
  const sb = requireSupabase();
  const { error } = await sb.from("location_points").insert(
    points.map((p) => ({
      org_id: orgId,
      attendance_id: p.attendanceId,
      employee_id: p.employeeId,
      project_id: p.projectId,
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      speed: p.speed,
      heading: p.heading,
      at: iso(p.at),
      offline: p.queued ?? false,
      segment_start: p.segmentStart ?? false,
      travel_session_id: p.travelSessionId ?? null,
    })),
  );
  if (error) throw error;
}

export async function insertWorkUpdate(u: WorkUpdate, orgId: string) {
  const sb = requireSupabase();
  const { error } = await sb.from("work_updates").insert({
    org_id: orgId,
    employee_id: u.employeeId,
    project_id: u.projectId,
    attendance_id: u.attendanceId ?? null,
    kind: u.kind,
    category: u.category,
    description: u.description,
    detail: {
      completed: u.completed,
      inProgress: u.inProgress,
      blockers: u.blockers,
      materials: u.materials,
      safety: u.safety,
      tomorrow: u.tomorrow,
    } as never,
    photos: (u.photos ?? []) as never,
    coords: (u.coords ?? null) as never,
    place: u.place ?? null,
    date: u.date,
    at: iso(u.at),
  });
  if (error) throw error;
}

/**
 * Self-serve signup.
 *
 * One RPC rather than a series of inserts, because the tenant it creates is
 * the thing every RLS policy resolves *through*: until the organisation and
 * the admin row exist, the caller belongs nowhere and no policy can admit
 * their writes. The database function is the only place that can create both,
 * and it does so in one transaction — see the migration for why a
 * half-provisioned company is the failure worth designing against.
 */
export async function provisionCompanyRemote(
  payload: SignupPayload,
): Promise<ProvisionResult> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("provision_company", { payload });
  if (error) throw error;
  return data as ProvisionResult;
}

/**
 * Create or update one person.
 *
 * The id is generated by the client, not the database. Every record that can
 * be persisted is minted as a UUID up front, so the row a manager just added
 * has the same identity in this browser and in Postgres — and anything
 * pointing at it (a shift, a trail, a project membership) does not have to be
 * rewritten once the server answers.
 */
export async function upsertUser(u: User, orgId: string) {
  const sb = requireSupabase();
  const { error } = await sb.from("users").upsert({
    id: u.id,
    org_id: orgId,
    name: u.name,
    employee_code: u.employeeCode,
    role: u.role,
    designation: u.designation,
    department: u.department,
    phone: u.phone,
    email: u.email ?? null,
    avatar_hue: u.avatarHue,
    photo: u.photo ?? null,
    status: u.status,
    vehicle: (u.vehicle ?? null) as never,
    shift_start: u.shiftStart,
    shift_end: u.shiftEnd,
    joined_at: iso(u.joinedAt),
  } as never);
  if (error) throw error;
}

export async function upsertProject(p: Project) {
  const sb = requireSupabase();
  const { error } = await sb.from("projects").upsert({
    id: p.id,
    org_id: p.orgId,
    kind: p.kind,
    tracking_mode: p.trackingMode,
    travel_tracking: p.travelTracking ?? false,
    code: p.code,
    name: p.name,
    client: p.client,
    address: p.address,
    site_contact: p.siteContact,
    site_contact_phone: p.siteContactPhone,
    manager_id: p.managerId || null,
    start_date: p.startDate || null,
    end_date: p.endDate || null,
    status: p.status,
    description: p.description,
    location: p.location as never,
    geofence_kind: p.geofence.kind,
    geofence: p.geofence as never,
    zones: p.zones as never,
    rules: p.rules as never,
  } as never);
  if (error) throw error;
}

/**
 * Make the roster of a project match `userIds` exactly.
 *
 * Delete-then-insert rather than a diff: the set is small (a crew, not a
 * customer base), the whole thing arrives together from the UI, and a diff
 * would need to be right about a membership row that another manager may have
 * changed in between. Replacing states the intent — this is the roster now.
 */
export async function replaceProjectMembers(
  projectId: string,
  userIds: string[],
  orgId: string,
) {
  const sb = requireSupabase();
  const { error: delError } = await sb
    .from("project_members")
    .delete()
    .eq("project_id", projectId);
  if (delError) throw delError;
  if (userIds.length === 0) return;
  const { error } = await sb.from("project_members").insert(
    userIds.map((user_id) => ({ project_id: projectId, user_id, org_id: orgId })),
  );
  if (error) throw error;
}

/* ------------------ shifts, payroll, travel, allowances (mappers) -------- */

export function toShift(r: ShiftRow): ShiftDef {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    code: r.code,
    kind: r.kind,
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    requiredMinutes: r.required_minutes,
    graceMinutes: r.grace_minutes,
    breakRules: (r.break_rules ?? []) as unknown as ShiftDef["breakRules"],
    maxBreaksPerShift: r.max_breaks_per_shift,
    minBreakMinutes: r.min_break_minutes,
    maxBreakMinutes: r.max_break_minutes,
    employeeBreaksAllowed: r.employee_breaks_allowed,
    breakApprovalRequired: r.break_approval_required,
    overtime: r.overtime as unknown as ShiftDef["overtime"],
    workingDays: r.working_days,
    projectIds: r.project_ids,
    status: r.status,
    createdAt: ms(r.created_at),
  };
}

export function toShiftAssignment(r: ShiftAssignmentRow): ShiftAssignment {
  return {
    id: r.id,
    employeeId: r.employee_id,
    shiftId: r.shift_id,
    effectiveFrom: r.effective_from,
    assignedBy: r.assigned_by ?? "",
    at: ms(r.at),
  };
}

export function toComp(r: CompRow): CompRecord {
  return {
    id: r.id,
    employeeId: r.employee_id,
    type: r.type,
    amount: Number(r.amount),
    effectiveFrom: r.effective_from,
    workingDaysPerMonth: r.working_days_per_month,
    standardDayMinutes: r.standard_day_minutes,
    note: r.note ?? undefined,
    setBy: r.set_by ?? "",
    at: ms(r.at),
  };
}

export function toPayPolicy(r: PayPolicyRow): PayPolicy {
  return {
    lateDeduction: r.late_deduction as PayPolicy["lateDeduction"],
    latePerMinuteRate: Number(r.late_per_minute_rate),
    lateFixedAmount: Number(r.late_fixed_amount),
    earlyOutDeduction: r.early_out_deduction as PayPolicy["earlyOutDeduction"],
    earlyPerMinuteRate: Number(r.early_per_minute_rate),
    earlyFixedAmount: Number(r.early_fixed_amount),
    absenceDeduction: r.absence_deduction as PayPolicy["absenceDeduction"],
    excessBreakUnpaid: r.excess_break_unpaid,
    managerSeesSalary: r.manager_sees_salary,
  };
}

export function toPayrollRun(r: PayrollRunRow): PayrollRun {
  return {
    id: r.id,
    orgId: r.org_id,
    month: r.month,
    status: r.status,
    adjustments: (r.adjustments ?? []) as unknown as PayrollRun["adjustments"],
    approvedBy: r.approved_by ?? undefined,
    approvedAt: r.approved_at ? ms(r.approved_at) : undefined,
    lockedAt: r.locked_at ? ms(r.locked_at) : undefined,
  };
}

export function toTravelSession(r: TravelSessionRow): TravelSession {
  return {
    id: r.id,
    employeeId: r.employee_id,
    projectId: r.project_id,
    attendanceId: r.attendance_id ?? undefined,
    date: r.date,
    start: r.start_anchor as unknown as TravelSession["start"],
    end: (r.end_anchor as unknown as TravelSession["end"]) ?? undefined,
    purpose: r.purpose as TravelSession["purpose"],
    note: r.note ?? undefined,
    vehicleType: r.vehicle_type,
    distanceMeters: Number(r.distance_meters),
    approvedMeters:
      r.approved_meters === null ? undefined : Number(r.approved_meters),
    flags: (r.flags ?? []) as unknown as TravelSession["flags"],
    status: r.status,
    decidedBy: r.decided_by ?? undefined,
    decidedAt: r.decided_at ? ms(r.decided_at) : undefined,
    decisionNote: r.decision_note ?? undefined,
    selfie: r.selfie ?? undefined,
  };
}

export function toPetrolRule(r: PetrolRuleRow): PetrolRule {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    vehicleType: r.vehicle_type,
    ratePerKm: Number(r.rate_per_km),
    maxDailyKm: r.max_daily_km === null ? null : Number(r.max_daily_km),
    maxDailyAmount:
      r.max_daily_amount === null ? null : Number(r.max_daily_amount),
    approval: r.approval,
    projectIds: r.project_ids,
    employeeIds: r.employee_ids,
    effectiveFrom: r.effective_from,
    status: r.status,
    createdAt: ms(r.created_at),
  };
}

export function toFoodRule(r: FoodRuleRow): FoodRule {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    meal: r.meal as FoodRule["meal"],
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    trigger: r.trigger_event as FoodRule["trigger"],
    amount: Number(r.amount),
    projectIds: r.project_ids,
    employeeIds: r.employee_ids,
    shiftIds: r.shift_ids,
    approval: r.approval,
    effectiveFrom: r.effective_from,
    status: r.status,
    createdAt: ms(r.created_at),
  };
}

export function toAllowanceDecision(r: AllowanceDecisionRow): AllowanceDecision {
  return {
    id: r.id,
    employeeId: r.employee_id,
    date: r.date,
    ruleId: r.rule_id,
    status: r.status,
    by: r.decided_by ?? "",
    at: ms(r.at),
    note: r.note ?? undefined,
  };
}

/* --------------------------------------------------------------- reads --- */

/**
 * The shift → payroll → allowance half of a tenant's data.
 *
 * Split from `fetchWorkforce` because RLS may legitimately answer parts of it
 * with nothing: a manager reading an organisation whose pay policy withholds
 * salary gets an empty `comp`, and that is a correct answer, not a failure.
 * Each result is therefore taken on its own rather than one error voiding the
 * whole round.
 */
export async function fetchOperations() {
  const sb = requireSupabase();
  const [
    shifts,
    assignments,
    comp,
    policy,
    runs,
    travel,
    petrol,
    food,
    decisions,
  ] = await Promise.all([
    sb.from("shifts").select("*"),
    sb.from("shift_assignments").select("*"),
    sb.from("compensation").select("*"),
    sb.from("pay_policies").select("*").maybeSingle(),
    sb.from("payroll_runs").select("*"),
    sb.from("travel_sessions").select("*").order("date", { ascending: false }).limit(2000),
    sb.from("petrol_rules").select("*"),
    sb.from("food_rules").select("*"),
    sb.from("allowance_decisions").select("*").limit(2000),
  ]);
  return {
    shifts: (shifts.data ?? []).map(toShift),
    shiftAssignments: (assignments.data ?? []).map(toShiftAssignment),
    comp: (comp.data ?? []).map(toComp),
    payPolicy: policy.data ? toPayPolicy(policy.data as PayPolicyRow) : null,
    payrollRuns: (runs.data ?? []).map(toPayrollRun),
    travelSessions: (travel.data ?? []).map(toTravelSession),
    petrolRules: (petrol.data ?? []).map(toPetrolRule),
    foodRules: (food.data ?? []).map(toFoodRule),
    allowanceDecisions: (decisions.data ?? []).map(toAllowanceDecision),
  };
}

/* -------------------------------------------------------------- writes --- */

export async function upsertShift(sh: ShiftDef) {
  const sb = requireSupabase();
  const { error } = await sb.from("shifts").upsert({
    id: sh.id,
    org_id: sh.orgId,
    name: sh.name,
    code: sh.code,
    kind: sh.kind,
    start_minute: sh.startMinute,
    end_minute: sh.endMinute,
    required_minutes: sh.requiredMinutes,
    grace_minutes: sh.graceMinutes,
    break_rules: sh.breakRules as never,
    max_breaks_per_shift: sh.maxBreaksPerShift,
    min_break_minutes: sh.minBreakMinutes,
    max_break_minutes: sh.maxBreakMinutes,
    employee_breaks_allowed: sh.employeeBreaksAllowed,
    break_approval_required: sh.breakApprovalRequired,
    overtime: sh.overtime as never,
    working_days: sh.workingDays,
    project_ids: sh.projectIds,
    status: sh.status,
  } as never);
  if (error) throw error;
}

export async function insertShiftAssignments(
  rows: ShiftAssignment[],
  orgId: string,
) {
  if (rows.length === 0) return;
  const sb = requireSupabase();
  const { error } = await sb.from("shift_assignments").insert(
    rows.map((a) => ({
      id: a.id,
      org_id: orgId,
      employee_id: a.employeeId,
      shift_id: a.shiftId,
      effective_from: a.effectiveFrom,
      assigned_by: a.assignedBy || null,
    })) as never,
  );
  if (error) throw error;
}

/** Salary is insert-only: a revision is a new row, never an edit. */
export async function insertComp(c: CompRecord, orgId: string) {
  const sb = requireSupabase();
  const { error } = await sb.from("compensation").insert({
    id: c.id,
    org_id: orgId,
    employee_id: c.employeeId,
    type: c.type,
    amount: c.amount,
    effective_from: c.effectiveFrom,
    working_days_per_month: c.workingDaysPerMonth,
    standard_day_minutes: c.standardDayMinutes,
    note: c.note ?? null,
    set_by: c.setBy || null,
  } as never);
  if (error) throw error;
}

export async function upsertPayPolicy(p: PayPolicy, orgId: string) {
  const sb = requireSupabase();
  const { error } = await sb.from("pay_policies").upsert({
    org_id: orgId,
    late_deduction: p.lateDeduction,
    late_per_minute_rate: p.latePerMinuteRate,
    late_fixed_amount: p.lateFixedAmount,
    early_out_deduction: p.earlyOutDeduction,
    early_per_minute_rate: p.earlyPerMinuteRate,
    early_fixed_amount: p.earlyFixedAmount,
    absence_deduction: p.absenceDeduction,
    excess_break_unpaid: p.excessBreakUnpaid,
    manager_sees_salary: p.managerSeesSalary,
    updated_at: new Date().toISOString(),
  } as never);
  if (error) throw error;
}

export async function upsertPayrollRun(r: PayrollRun) {
  const sb = requireSupabase();
  const { error } = await sb.from("payroll_runs").upsert(
    {
      id: r.id,
      org_id: r.orgId,
      month: r.month,
      status: r.status,
      adjustments: r.adjustments as never,
      approved_by: r.approvedBy ?? null,
      approved_at: r.approvedAt ? iso(r.approvedAt) : null,
      locked_at: r.lockedAt ? iso(r.lockedAt) : null,
    } as never,
    { onConflict: "org_id,month" },
  );
  if (error) throw error;
}

export async function upsertTravelSession(t: TravelSession, orgId: string) {
  const sb = requireSupabase();
  const { error } = await sb.from("travel_sessions").upsert({
    id: t.id,
    org_id: orgId,
    employee_id: t.employeeId,
    project_id: t.projectId,
    attendance_id: t.attendanceId ?? null,
    date: t.date,
    start_anchor: t.start as never,
    end_anchor: (t.end ?? null) as never,
    purpose: t.purpose,
    note: t.note ?? null,
    vehicle_type: t.vehicleType,
    distance_meters: t.distanceMeters,
    approved_meters: t.approvedMeters ?? null,
    flags: t.flags as never,
    status: t.status,
    decided_by: t.decidedBy ?? null,
    decided_at: t.decidedAt ? iso(t.decidedAt) : null,
    decision_note: t.decisionNote ?? null,
    selfie: t.selfie ?? null,
  } as never);
  if (error) throw error;
}

export async function upsertPetrolRule(r: PetrolRule) {
  const sb = requireSupabase();
  const { error } = await sb.from("petrol_rules").upsert({
    id: r.id,
    org_id: r.orgId,
    name: r.name,
    vehicle_type: r.vehicleType,
    rate_per_km: r.ratePerKm,
    max_daily_km: r.maxDailyKm,
    max_daily_amount: r.maxDailyAmount,
    approval: r.approval,
    project_ids: r.projectIds,
    employee_ids: r.employeeIds,
    effective_from: r.effectiveFrom,
    status: r.status,
  } as never);
  if (error) throw error;
}

export async function upsertFoodRule(r: FoodRule) {
  const sb = requireSupabase();
  const { error } = await sb.from("food_rules").upsert({
    id: r.id,
    org_id: r.orgId,
    name: r.name,
    meal: r.meal,
    start_minute: r.startMinute,
    end_minute: r.endMinute,
    trigger_event: r.trigger,
    amount: r.amount,
    project_ids: r.projectIds,
    employee_ids: r.employeeIds,
    shift_ids: r.shiftIds,
    approval: r.approval,
    effective_from: r.effectiveFrom,
    status: r.status,
  } as never);
  if (error) throw error;
}

export async function insertAllowanceDecision(
  d: AllowanceDecision,
  orgId: string,
) {
  const sb = requireSupabase();
  const { error } = await sb.from("allowance_decisions").insert({
    id: d.id,
    org_id: orgId,
    employee_id: d.employeeId,
    date: d.date,
    rule_id: d.ruleId,
    status: d.status,
    decided_by: d.by || null,
    note: d.note ?? null,
  } as never);
  if (error) throw error;
}
