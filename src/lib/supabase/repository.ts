"use client";

/**
 * Repository layer — maps Postgres rows to the domain types the UI already
 * speaks, so screens are unchanged whether data comes from the seeded demo
 * store or from Supabase.
 *
 * Note what is deliberately absent: no `org_id` filters. Row-level security
 * applies them in the database, so a bug here cannot widen access — the
 * policy is the boundary, and these queries simply ask for what they need.
 */

import { requireSupabase } from "./client";
import type {
  AttendanceRow,
  InvoiceRow,
  LocationPointRow,
  OrgRow,
  PlanRow,
  ProjectRow,
  SubscriptionRow,
  UsageRow,
  UserRow,
  WorkUpdateRow,
} from "./types";
import type { ProvisionResult, SignupPayload } from "./types";
import type {
  Attendance,
  AttendanceMark,
  LocationPoint,
  Project,
  User,
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
    } as never)
    .select()
    .single();
  if (error) throw error;
  return toAttendance(data as AttendanceRow);
}

export async function insertCheckOut(
  attendanceId: string,
  patch: { mark: AttendanceMark; workedMinutes: number; distanceMeters: number; status: Attendance["status"] },
) {
  const sb = requireSupabase();
  const { error } = await sb
    .from("attendance")
    .update({
      check_out: patch.mark as never,
      worked_minutes: patch.workedMinutes,
      distance_meters: patch.distanceMeters,
      status: patch.status,
    })
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
