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
  SupportTicketRow,
  PlatformAuditRow,
  PlatformSettingsRow,
} from "./types";
import type { ProvisionResult, SignupPayload } from "./types";
import type {
  LabourTeam,
  LabourTeamMember,
  GroupAttendanceRecord,
  GroupAttendanceMember,
  ProjectNote,
  ProjectNoteAttachment,
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
  PlatformAuditEntry,
  PlatformSettings,
  Subscription,
  SupportTicket,
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
    phone: r.phone ?? undefined,
    email: r.email ?? "",
    avatarHue: r.avatar_hue,
    photo: r.photo ?? undefined,
    status: r.status,
    projectIds: [],           // filled from project_members
    shiftStart: r.shift_start,
    shiftEnd: r.shift_end,
    joinedAt: ms(r.joined_at),
    supervisorRating: r.supervisor_rating ?? undefined,
    authProvider: r.auth_provider ?? undefined,
    emailVerified: r.email_verified ?? undefined,
    lastSignInAt: r.last_sign_in_at ? ms(r.last_sign_in_at) : undefined,
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

export function toTicket(r: SupportTicketRow): SupportTicket {
  return {
    id: r.id,
    orgId: r.org_id,
    subject: r.subject,
    body: r.body,
    kind: r.kind,
    status: r.status,
    priority: r.priority as SupportTicket["priority"],
    openedAt: ms(r.opened_at),
    updatedAt: ms(r.updated_at),
    raisedBy: r.raised_by,
  };
}

export function toAudit(r: PlatformAuditRow): PlatformAuditEntry {
  return {
    id: r.id,
    at: ms(r.at),
    actorId: r.actor_id ?? "system",
    actorName: r.actor_name,
    orgId: r.org_id ?? undefined,
    action: r.action,
    target: r.target,
    previousValue: r.previous_value ?? undefined,
    newValue: r.new_value ?? undefined,
    detail: r.detail ?? undefined,
    ip: r.ip ?? undefined,
  };
}

/** Keys the database holds; the store lays them over its defaults. */
export function toSettings(r: PlatformSettingsRow): Partial<PlatformSettings> {
  return (r.settings ?? {}) as Partial<PlatformSettings>;
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
  const [orgs, plans, subs, invoices, usage, tickets, audit, settings] = await Promise.all([
    sb.from("organizations").select("*"),
    sb.from("plans").select("*"),
    sb.from("subscriptions").select("*"),
    sb.from("invoices").select("*").order("issued_at", { ascending: false }),
    sb.from("usage_snapshots").select("*"),
    sb.from("support_tickets").select("*").order("opened_at", { ascending: false }),
    // The trail, newest first. RLS answers a client admin with nothing here,
    // which is right: the audit is the platform owner's.
    sb.from("platform_audit").select("*").order("at", { ascending: false }).limit(1000),
    sb.from("platform_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const err =
    orgs.error ?? plans.error ?? subs.error ?? invoices.error ?? usage.error ??
    tickets.error ?? audit.error ?? settings.error;
  if (err) throw err;
  return {
    organizations: (orgs.data ?? []).map(toOrg),
    plans: (plans.data ?? []).map(toPlan),
    subscriptions: (subs.data ?? []).map(toSubscription),
    invoices: (invoices.data ?? []).map(toInvoice),
    usage: (usage.data ?? []).map(toUsage),
    tickets: (tickets.data ?? []).map(toTicket),
    platformAudit: (audit.data ?? []).map(toAudit),
    platformSettings: settings.data ? toSettings(settings.data as PlatformSettingsRow) : null,
  };
}

/* ------------------------------------------------------- platform writes --- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | undefined | null) => (v && UUID.test(v) ? v : null);

export async function upsertOrganization(o: Organization) {
  const sb = requireSupabase();
  const { error } = await sb.from("organizations").upsert({
    id: o.id,
    name: o.name,
    code: o.code,
    industry: o.industry,
    website: o.website,
    contact_name: o.contactName,
    contact_email: o.contactEmail,
    contact_phone: o.contactPhone,
    country: o.country,
    timezone: o.timezone,
    status: o.status,
    billing: o.billing as never,
    branding: o.branding as never,
    suspended_reason: o.suspendedReason ?? null,
    created_at: iso(o.createdAt),
  } as never);
  if (error) throw error;
}

export async function upsertPlan(p: Plan) {
  const sb = requireSupabase();
  const { error } = await sb.from("plans").upsert({
    id: p.id,
    name: p.name,
    description: p.description,
    monthly_price: p.monthlyPrice,
    annual_price: p.annualPrice,
    currency: p.currency,
    trial_days: p.trialDays,
    max_employees: p.limits.employees ?? null,
    max_managers: p.limits.managers ?? null,
    max_projects: p.limits.projects ?? null,
    max_storage_gb: p.limits.storageGb ?? null,
    route_retention_days: p.limits.routeRetentionDays ?? 30,
    api_calls_per_month: p.limits.apiCallsPerMonth ?? 0,
    features: p.features as never,
    support_level: p.supportLevel,
    archived: p.archived,
    created_at: iso(p.createdAt),
  } as never);
  if (error) throw error;
}

export async function upsertSubscription(x: Subscription) {
  const sb = requireSupabase();
  const { error } = await sb.from("subscriptions").upsert({
    id: x.id,
    org_id: x.orgId,
    plan_id: x.planId,
    status: x.status,
    cycle: x.cycle,
    started_at: iso(x.startedAt),
    trial_ends_at: x.trialEndsAt ? iso(x.trialEndsAt) : null,
    renews_at: iso(x.renewsAt),
    cancelled_at: x.cancelledAt ? iso(x.cancelledAt) : null,
    limit_overrides: x.limitOverrides as never,
    feature_overrides: x.featureOverrides as never,
    custom_price: x.customPrice ?? null,
    discount_percent: x.discountPercent ?? null,
    credit_balance: x.creditBalance,
    on_limit_reached: x.onLimitReached,
    notes: x.notes ?? null,
  } as never);
  if (error) throw error;
}

export async function upsertInvoice(i: Invoice) {
  const sb = requireSupabase();
  const { error } = await sb.from("invoices").upsert({
    id: i.id,
    number: i.number,
    org_id: i.orgId,
    subscription_id: uuidOrNull(i.subscriptionId),
    amount: i.amount,
    tax_amount: i.taxAmount,
    currency: i.currency,
    issued_at: iso(i.issuedAt),
    due_at: iso(i.dueAt),
    paid_at: i.paidAt ? iso(i.paidAt) : null,
    status: i.status,
    period_label: i.periodLabel,
    payment_method: i.paymentMethod,
    failure_reason: i.failureReason ?? null,
  } as never);
  if (error) throw error;
}

export async function upsertTicket(t: SupportTicket) {
  const sb = requireSupabase();
  const { error } = await sb.from("support_tickets").upsert({
    id: t.id,
    org_id: t.orgId,
    subject: t.subject,
    body: t.body,
    kind: t.kind,
    status: t.status,
    priority: t.priority,
    raised_by: t.raisedBy,
    opened_at: iso(t.openedAt),
    updated_at: iso(t.updatedAt),
  } as never);
  if (error) throw error;
}

/**
 * Append one audit entry. Only the platform owner may write the trail
 * (RLS), so a refusal is expected for anyone else and is not an error worth
 * showing — the entry stays in their local view and is dropped on the next
 * read, which is the right outcome for a record they were never allowed to
 * make.
 */
export async function insertPlatformAudit(e: PlatformAuditEntry) {
  const sb = requireSupabase();
  const { error } = await sb.from("platform_audit").insert({
    id: e.id,
    at: iso(e.at),
    actor_id: uuidOrNull(e.actorId),
    actor_name: e.actorName,
    org_id: uuidOrNull(e.orgId),
    action: e.action,
    target: e.target,
    previous_value: e.previousValue ?? null,
    new_value: e.newValue ?? null,
    detail: e.detail ?? null,
    ip: e.ip ?? null,
  } as never);
  if (error && error.code !== "42501") throw error;
}

export async function savePlatformSettings(settings: PlatformSettings) {
  const sb = requireSupabase();
  const { error } = await sb
    .from("platform_settings")
    .upsert({ id: 1, settings: settings as never } as never);
  if (error) throw error;
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

/* ------------------------------------------- labour teams, captures, notes */

/*
 * The team-based half of the product.
 *
 * Same bargain as everything above: ids are minted on the client, so an
 * optimistic write and its row have one identity in both places, and a
 * failed push is reported rather than swallowed. No `org_id` filters on
 * reads — row-level security applies them in the database, and the policy
 * is the boundary.
 */

export async function upsertLabourTeam(t: LabourTeam) {
  const sb = requireSupabase();
  const { error } = await sb.from("labour_teams").upsert({
    id: t.id,
    org_id: t.orgId,
    project_id: t.projectId,
    name: t.name,
    type: t.type,
    code: t.code,
    leader_id: t.leaderId ?? null,
    site_engineer_id: t.siteEngineerId ?? null,
    supervisor_id: t.supervisorId ?? null,
    description: t.description ?? null,
    status: t.status,
    start_date: t.startDate ?? null,
    end_date: t.endDate ?? null,
    work_zone_id: t.workZoneId ?? null,
    shift_id: t.shiftId ?? null,
    notes: t.notes ?? null,
    updated_at: new Date(t.updatedAt).toISOString(),
  } as never);
  if (error) throw error;
}

export async function upsertTeamMembers(rows: LabourTeamMember[]) {
  if (rows.length === 0) return;
  const sb = requireSupabase();
  const { error } = await sb.from("labour_team_members").upsert(
    rows.map((m) => ({
      id: m.id,
      org_id: m.orgId,
      team_id: m.teamId,
      employee_id: m.employeeId,
      joined_at: new Date(m.joinedAt).toISOString(),
      left_at: m.leftAt ? new Date(m.leftAt).toISOString() : null,
      status: m.status,
      transferred_to_team_id: m.transferredToTeamId ?? null,
    })) as never,
  );
  if (error) throw error;
}

export async function insertGroupAttendance(
  record: GroupAttendanceRecord,
  members: GroupAttendanceMember[],
) {
  const sb = requireSupabase();
  const { error } = await sb.from("group_attendance").insert({
    id: record.id,
    org_id: record.orgId,
    project_id: record.projectId,
    team_id: record.teamId,
    shift_id: record.shiftId ?? null,
    site_engineer_id: record.siteEngineerId,
    photos: record.photos as never,
    captured_at: new Date(record.capturedAt).toISOString(),
    lat: record.coords?.lat ?? null,
    lng: record.coords?.lng ?? null,
    geofence_status: record.geofenceStatus,
    face_count: record.faceCount,
    matched_count: record.matchedCount,
    status: record.status,
    confirmed_by: record.confirmedBy ?? null,
    confirmed_at: record.confirmedAt ? new Date(record.confirmedAt).toISOString() : null,
    note: record.note ?? null,
  } as never);
  if (error) throw error;

  if (members.length === 0) return;
  const { error: memberError } = await sb.from("group_attendance_members").insert(
    members.map((m) => ({
      id: m.id,
      org_id: m.orgId,
      group_attendance_id: m.groupAttendanceId,
      employee_id: m.employeeId,
      detection_status: m.detectionStatus,
      match_status: m.matchStatus,
      attendance_status: m.attendanceStatus,
      review_status: m.reviewStatus,
      distance: m.distance ?? null,
      attendance_id: m.attendanceId ?? null,
    })) as never,
  );
  if (memberError) throw memberError;
}

export async function upsertProjectNote(n: ProjectNote) {
  const sb = requireSupabase();
  const { error } = await sb.from("project_notes").upsert({
    id: n.id,
    org_id: n.orgId,
    project_id: n.projectId,
    author_id: n.authorId,
    title: n.title,
    body: n.body,
    category: n.category,
    priority: n.priority,
    visibility: n.visibility,
    visible_to: n.visibleTo ?? [],
    status: n.status,
    due_date: n.dueDate ?? null,
    remind_at: n.remindAt ? new Date(n.remindAt).toISOString() : null,
    reminder_sent: n.reminderSent ?? false,
    pinned: n.pinned,
    lat: n.coords?.lat ?? null,
    lng: n.coords?.lng ?? null,
    updated_at: new Date(n.updatedAt).toISOString(),
  } as never);
  if (error) throw error;
}

export async function deleteProjectNote(noteId: string) {
  const sb = requireSupabase();
  const { error } = await sb.from("project_notes").delete().eq("id", noteId);
  if (error) throw error;
}

export async function insertNoteAttachment(a: ProjectNoteAttachment) {
  const sb = requireSupabase();
  const { error } = await sb.from("project_note_attachments").insert({
    id: a.id,
    org_id: a.orgId,
    note_id: a.noteId,
    file: a.file,
    name: a.name,
    type: a.type,
    size: a.size,
    created_by: a.createdBy,
  } as never);
  if (error) throw error;
}

export async function deleteNoteAttachment(attachmentId: string) {
  const sb = requireSupabase();
  const { error } = await sb.from("project_note_attachments").delete().eq("id", attachmentId);
  if (error) throw error;
}

/** Everything team-shaped for one tenant, in the shapes the UI speaks. */
export async function fetchTeamWorld(): Promise<{
  labourTeams: LabourTeam[];
  teamMembers: LabourTeamMember[];
  groupAttendance: GroupAttendanceRecord[];
  groupAttendanceMembers: GroupAttendanceMember[];
  projectNotes: ProjectNote[];
  noteAttachments: ProjectNoteAttachment[];
}> {
  const sb = requireSupabase();
  const [teams, members, captures, captureMembers, notes, attachments] =
    await Promise.all([
      sb.from("labour_teams").select("*"),
      sb.from("labour_team_members").select("*"),
      sb.from("group_attendance").select("*").order("captured_at", { ascending: false }),
      sb.from("group_attendance_members").select("*"),
      sb.from("project_notes").select("*").order("created_at", { ascending: false }),
      sb.from("project_note_attachments").select("*"),
    ]);

  for (const r of [teams, members, captures, captureMembers, notes, attachments]) {
    if (r.error) throw r.error;
  }

  const ms = (v: string | null | undefined) => (v ? new Date(v).getTime() : undefined);

  return {
    labourTeams: (teams.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      projectId: r.project_id as string,
      name: r.name as string,
      type: r.type as string,
      code: r.code as string,
      leaderId: (r.leader_id as string) ?? undefined,
      siteEngineerId: (r.site_engineer_id as string) ?? undefined,
      supervisorId: (r.supervisor_id as string) ?? undefined,
      description: (r.description as string) ?? undefined,
      status: r.status as LabourTeam["status"],
      startDate: (r.start_date as string) ?? undefined,
      endDate: (r.end_date as string) ?? undefined,
      workZoneId: (r.work_zone_id as string) ?? undefined,
      shiftId: (r.shift_id as string) ?? undefined,
      notes: (r.notes as string) ?? undefined,
      createdAt: ms(r.created_at as string) ?? Date.now(),
      updatedAt: ms(r.updated_at as string) ?? Date.now(),
    })),
    teamMembers: (members.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      teamId: r.team_id as string,
      employeeId: r.employee_id as string,
      joinedAt: ms(r.joined_at as string) ?? Date.now(),
      leftAt: ms(r.left_at as string | null),
      status: r.status as LabourTeamMember["status"],
      transferredToTeamId: (r.transferred_to_team_id as string) ?? undefined,
    })),
    groupAttendance: (captures.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      projectId: r.project_id as string,
      teamId: r.team_id as string,
      shiftId: (r.shift_id as string) ?? undefined,
      siteEngineerId: r.site_engineer_id as string,
      photos: (r.photos as string[]) ?? [],
      capturedAt: ms(r.captured_at as string) ?? Date.now(),
      coords:
        r.lat != null && r.lng != null
          ? { lat: r.lat as number, lng: r.lng as number }
          : undefined,
      geofenceStatus: r.geofence_status as GroupAttendanceRecord["geofenceStatus"],
      faceCount: (r.face_count as number) ?? 0,
      matchedCount: (r.matched_count as number) ?? 0,
      status: r.status as GroupAttendanceRecord["status"],
      confirmedBy: (r.confirmed_by as string) ?? undefined,
      confirmedAt: ms(r.confirmed_at as string | null),
      note: (r.note as string) ?? undefined,
    })),
    groupAttendanceMembers: (captureMembers.data ?? []).map(
      (r: Record<string, unknown>) => ({
        id: r.id as string,
        orgId: r.org_id as string,
        groupAttendanceId: r.group_attendance_id as string,
        employeeId: r.employee_id as string,
        detectionStatus: r.detection_status as GroupAttendanceMember["detectionStatus"],
        matchStatus: r.match_status as GroupAttendanceMember["matchStatus"],
        attendanceStatus: r.attendance_status as GroupAttendanceMember["attendanceStatus"],
        reviewStatus: r.review_status as GroupAttendanceMember["reviewStatus"],
        distance: (r.distance as number) ?? undefined,
        attendanceId: (r.attendance_id as string) ?? undefined,
      }),
    ),
    projectNotes: (notes.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      projectId: r.project_id as string,
      authorId: r.author_id as string,
      title: r.title as string,
      body: (r.body as string) ?? "",
      category: r.category as string,
      priority: r.priority as ProjectNote["priority"],
      visibility: r.visibility as ProjectNote["visibility"],
      visibleTo: (r.visible_to as string[]) ?? undefined,
      status: r.status as ProjectNote["status"],
      dueDate: (r.due_date as string) ?? undefined,
      remindAt: ms(r.remind_at as string | null),
      reminderSent: (r.reminder_sent as boolean) ?? false,
      pinned: (r.pinned as boolean) ?? false,
      coords:
        r.lat != null && r.lng != null
          ? { lat: r.lat as number, lng: r.lng as number }
          : undefined,
      createdAt: ms(r.created_at as string) ?? Date.now(),
      updatedAt: ms(r.updated_at as string) ?? Date.now(),
    })),
    noteAttachments: (attachments.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      noteId: r.note_id as string,
      file: r.file as string,
      name: r.name as string,
      type: r.type as ProjectNoteAttachment["type"],
      size: (r.size as number) ?? 0,
      createdBy: r.created_by as string,
      createdAt: ms(r.created_at as string) ?? Date.now(),
    })),
  };
}
