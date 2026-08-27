/**
 * Workfence — construction workforce attendance & live-site tracking.
 *
 * Domain entities. Everything is serialisable so the whole store can be
 * persisted to localStorage and replayed offline (see `store.tsx`).
 *
 * Timestamps are epoch milliseconds; dates are ISO `YYYY-MM-DD` strings in the
 * project's local calendar so a shift never straddles two "days".
 */

/**
 * Access levels, lowest to highest:
 *   employee   — own attendance and shift only
 *   manager    — the projects they run, inside their client org
 *   admin      — Client Owner/Admin: everything inside their client org
 *   superadmin — Product Owner: the platform itself, across all clients
 */
export type Role = "employee" | "manager" | "admin" | "superadmin";

export type LatLng = { lat: number; lng: number };

/* ------------------------------------------------------------------ users */

export type EmployeeStatus = "active" | "inactive" | "on-leave";

export interface User {
  id: string;
  /** Owning tenant. Empty for the platform Super Admin, who has no org. */
  orgId: string;
  name: string;
  employeeCode: string;
  role: Role;
  designation: string;
  department: string;
  phone: string;
  email?: string;
  /** Initials-based avatar tint; photos are generated, never fetched. */
  avatarHue: number;
  photo?: string;
  status: EmployeeStatus;
  projectIds: string[];
  /** Contracted shift for punctuality scoring, minutes from midnight. */
  shiftStart: number;
  shiftEnd: number;
  joinedAt: number;
  supervisorRating?: number;
}

/* --------------------------------------------------------------- projects */

export type ProjectStatus =
  | "planning"
  | "active"
  | "on-hold"
  | "completed";

export type GeofenceKind = "polygon" | "circle";

export interface Geofence {
  kind: GeofenceKind;
  /** Polygon vertices (>=3) in draw order. Empty for circle fences. */
  polygon: LatLng[];
  /** Circle centre + radius (metres). Ignored for polygon fences. */
  center: LatLng;
  radius: number;
  /** Grace band outside the fence that still counts as "at the gate". */
  bufferMeters: number;
}

/** Named area inside a site — used to label where a worker actually is. */
export interface SiteZone {
  id: string;
  name: string;
  center: LatLng;
  radius: number;
  kind: "work" | "material" | "welfare" | "access" | "hazard";
}

/**
 * What a premise is. Both are geofenced places a worker can be assigned to;
 * the distinction exists because a shift under `outside-only` tracking has to
 * be closed at one of them, and "go back to the office" is a different
 * instruction from "go back to the site".
 */
export type PremiseKind = "site" | "office";

/**
 * When a shift's location trail is recorded.
 *
 * - `full-shift` — continuously from check-in to checkout. The worker's
 *   movement around the site is part of the record.
 * - `outside-only` — nothing is recorded while the worker is inside the
 *   boundary; recording starts when they leave and runs until checkout. For
 *   crews whose on-site movement is nobody's business but whose trips away
 *   from it are: material runs, client visits, site-to-site transfers.
 *
 * The second mode is what makes the checkout rule necessary. If the shift
 * could be closed anywhere, a worker could leave and end the trail in the
 * middle of the trip — so under `outside-only` checkout is only accepted
 * inside one of their assigned premises.
 */
export type TrackingMode = "full-shift" | "outside-only";

export interface Project {
  id: string;
  /** Owning tenant — every project read is scoped by this. */
  orgId: string;
  /** Site or office. Both are valid places to start and end a shift. */
  kind: PremiseKind;
  /** Whether on-site movement is recorded. See {@link TrackingMode}. */
  trackingMode: TrackingMode;
  code: string;
  name: string;
  client: string;
  address: string;
  siteContact: string;
  siteContactPhone: string;
  managerId: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  description: string;
  location: LatLng;
  geofence: Geofence;
  zones: SiteZone[];
  employeeIds: string[];
  /** Rules that decide "late", "early out" and geofence-exit handling. */
  rules: {
    shiftStart: number;
    shiftEnd: number;
    lateGraceMinutes: number;
    minShiftMinutes: number;
    /** Minutes outside the fence before an exit alert is raised. */
    exitAlertMinutes: number;
    autoCheckoutHours: number;
  };
  createdAt: number;
}

/* ----------------------------------------------------------------- shifts */

/**
 * How a shift's clock works.
 *  - `fixed`     — a start and an end on the same calendar day.
 *  - `flexible`  — a required number of minutes; no fixed start/end.
 *  - `overnight` — the end lands on the following calendar day; attendance
 *                  stays filed under the check-in date.
 *  - `custom`    — same mechanics as fixed, named so managers can mark the
 *                  odd one out.
 */
export type ShiftKind = "fixed" | "flexible" | "overnight" | "custom";

/** A named, scheduled break inside a shift — a lunch window, a tea break. */
export interface BreakRule {
  id: string;
  name: string;
  /** Scheduled window, minutes from midnight. Optional — ad-hoc allowances have none. */
  startMinute?: number;
  endMinute?: number;
  durationMinutes: number;
  paid: boolean;
}

/** One overtime pay tier: from `afterHours` of OT onward, this multiplier. */
export interface OvertimeTier {
  afterHours: number;
  multiplier: number;
}

export interface OvertimeConfig {
  enabled: boolean;
  /** Minutes past shift end that count as nothing before OT begins. */
  graceMinutes: number;
  approval: "auto" | "manager";
  /** How the OT hour is priced. */
  method: "fixed-hourly" | "salary-multiplier";
  /** ₹ per OT hour when method is fixed-hourly. */
  hourlyRate: number;
  /** Multiplier tiers when method is salary-multiplier, sorted by afterHours. */
  tiers: OvertimeTier[];
  /** Flat bonus once OT crosses a threshold; null = no bonus rule. */
  bonusAfterHours: number | null;
  bonusAmount: number;
}

/**
 * A reusable shift definition. Assignments point at it; the payroll engine
 * reads it; nothing about pay is hard-coded here beyond structure.
 */
export interface ShiftDef {
  id: string;
  orgId: string;
  name: string;
  code: string;
  kind: ShiftKind;
  /** Minutes from midnight. For overnight shifts end < start. */
  startMinute: number;
  endMinute: number;
  /** Required minutes for flexible shifts; expected minutes otherwise. */
  requiredMinutes: number;
  /** Late grace after startMinute. */
  graceMinutes: number;
  breakRules: BreakRule[];
  maxBreaksPerShift: number;
  minBreakMinutes: number;
  maxBreakMinutes: number;
  /** Whether workers may start breaks themselves from the app. */
  employeeBreaksAllowed: boolean;
  breakApprovalRequired: boolean;
  overtime: OvertimeConfig;
  /** Working days, 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  projectIds: string[];
  status: "active" | "archived";
  createdAt: number;
}

/** Who is on which shift, from when. The latest effective one wins. */
export interface ShiftAssignment {
  id: string;
  employeeId: string;
  shiftId: string;
  /** ISO date this assignment starts applying. */
  effectiveFrom: string;
  assignedBy: string;
  at: number;
}

/* ----------------------------------------------------------- compensation */

export type SalaryType = "monthly" | "daily" | "hourly";

/**
 * One salary revision. History is the list of these — a change appends a new
 * record, it never rewrites an old one.
 */
export interface CompRecord {
  id: string;
  employeeId: string;
  type: SalaryType;
  /** ₹ per month / day / hour according to `type`. */
  amount: number;
  effectiveFrom: string;
  /** Working days per month, for deriving a daily rate from monthly pay. */
  workingDaysPerMonth: number;
  /** Standard paid minutes in a working day, for deriving an hourly rate. */
  standardDayMinutes: number;
  note?: string;
  setBy: string;
  at: number;
}

/** Org-wide payroll rules. Configuration, never code. */
export interface PayPolicy {
  lateDeduction: "none" | "per-minute" | "fixed";
  /** ₹ per late minute beyond grace (per-minute mode). */
  latePerMinuteRate: number;
  /** ₹ once per late day beyond grace (fixed mode). */
  lateFixedAmount: number;
  earlyOutDeduction: "none" | "per-minute" | "fixed";
  earlyPerMinuteRate: number;
  earlyFixedAmount: number;
  absenceDeduction: "full-day" | "none";
  /** Deduct break time beyond the shift's paid allowance. */
  excessBreakUnpaid: boolean;
  /** Whether managers may see salary figures (admins always can). */
  managerSeesSalary: boolean;
}

/* ---------------------------------------------------------------- payroll */

export type PayrollStatus =
  | "draft"
  | "calculated"
  | "review"
  | "approved"
  | "locked";

export interface PayrollAdjustment {
  id: string;
  employeeId: string;
  /** Signed ₹ — positive adds, negative deducts. */
  amount: number;
  note: string;
  by: string;
  at: number;
}

/**
 * One month's payroll for one org. The figures themselves are recomputed
 * from attendance + rules on demand; the run holds the workflow state and
 * the human decisions (adjustments, approval, lock).
 */
export interface PayrollRun {
  id: string;
  orgId: string;
  /** YYYY-MM */
  month: string;
  status: PayrollStatus;
  adjustments: PayrollAdjustment[];
  approvedBy?: string;
  approvedAt?: number;
  lockedAt?: number;
}

/* ------------------------------------------------------------- attendance */

export type AttendanceStatus =
  | "present"
  | "absent"
  | "late"
  | "early-checkout"
  | "missing-checkout"
  | "on-leave"
  | "holiday";

export interface AttendanceMark {
  at: number;
  coords: LatLng;
  accuracy: number;
  /** Data-URL of the captured selfie (or a generated placeholder). */
  selfie: string;
  /** Human-readable zone/landmark resolved from the site plan. */
  place: string;
  insideGeofence: boolean;
  /** Set when the record was captured offline and synced later. */
  syncedAt?: number;
}

/** One break inside a shift. Open while `end` is unset. */
export interface BreakEntry {
  id: string;
  start: number;
  end?: number;
  coordsStart?: LatLng;
  coordsEnd?: LatLng;
  /** Which scheduled break this was taken against, if any. */
  ruleId?: string;
}

/** The optional checkout voice note, recorded on the device. */
export interface VoiceNote {
  /** data-URL of the audio (webm/ogg/mp4 per browser). */
  dataUrl: string;
  seconds: number;
  at: number;
  coords?: LatLng;
  place?: string;
}

export type OvertimeStatus = "auto-approved" | "pending" | "approved" | "rejected";

/** Overtime worked on one attendance day, and what became of it. */
export interface OvertimeRecord {
  minutes: number;
  status: OvertimeStatus;
  /** Manager may trim the minutes on approval; original kept for the trail. */
  approvedMinutes?: number;
  decidedBy?: string;
  decidedAt?: number;
  note?: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  projectId: string;
  date: string;
  checkIn?: AttendanceMark;
  checkOut?: AttendanceMark;
  /** Worked minutes; computed on checkout, null while the shift is open. */
  workedMinutes?: number;
  distanceMeters: number;
  status: AttendanceStatus;
  /** Geofence exit/return events recorded during the shift. */
  events: ShiftEvent[];
  /** Breaks taken during this shift, in order. Absent on old records. */
  breaks?: BreakEntry[];
  /** Shift definition in force when the day opened. */
  shiftId?: string;
  /** Overtime detected at checkout, with its approval state. */
  overtime?: OvertimeRecord;
  /** Optional voice note captured at checkout. */
  voiceNote?: VoiceNote;
  autoClosed?: boolean;
  note?: string;
}

export type ShiftEventKind =
  | "geofence-exit"
  | "geofence-return"
  | "gps-lost"
  | "gps-restored"
  | "low-accuracy"
  | "offline"
  | "synced"
  | "auto-checkout";

export interface ShiftEvent {
  id: string;
  at: number;
  kind: ShiftEventKind;
  detail: string;
}

/* --------------------------------------------------------- location trail */

export interface LocationPoint {
  id: string;
  attendanceId: string;
  employeeId: string;
  projectId: string;
  lat: number;
  lng: number;
  accuracy: number;
  /** metres/second */
  speed: number;
  /** degrees clockwise from true north */
  heading: number;
  at: number;
  /** True while the point sat in the offline outbox. */
  queued?: boolean;
  /**
   * First fix of a new stretch of recording. Only `outside-only` projects
   * produce these: the trail is a series of excursions with the on-site time
   * between them missing entirely, so the distance from the previous point is
   * not travel that was measured and the polyline must not be drawn through
   * the gap.
   */
  segmentStart?: boolean;
}

/** A place the worker stayed put — derived from the trail, not stored raw. */
export interface DwellSegment {
  start: number;
  end: number;
  center: LatLng;
  place: string;
  minutes: number;
}

/* ------------------------------------------------------------ work update */

export const WORK_CATEGORIES = [
  "Site Inspection",
  "Civil Work",
  "Electrical",
  "Plumbing",
  "Material Handling",
  "Quality Inspection",
  "Safety",
  "Supervision",
  "Documentation",
  "Other",
] as const;

export type WorkCategory = (typeof WORK_CATEGORIES)[number];

export interface WorkUpdate {
  id: string;
  employeeId: string;
  projectId: string;
  attendanceId?: string;
  date: string;
  at: number;
  category: WorkCategory;
  /** "shift" = logged during the day, "daily" = end-of-day summary. */
  kind: "shift" | "daily";
  description: string;
  completed?: string;
  inProgress?: string;
  blockers?: string;
  materials?: string;
  safety?: string;
  tomorrow?: string;
  photos: string[];
  voiceNoteSeconds?: number;
  coords?: LatLng;
  place?: string;
  status: "synced" | "queued";
}

/* ---------------------------------------------------------- notifications */

export type NotificationKind =
  | "check-in"
  | "check-out"
  | "late-check-in"
  | "missing-checkout"
  | "geofence-exit"
  | "tracking-interrupted"
  | "low-accuracy"
  | "work-update"
  | "tracking-started"
  | "reminder"
  | "sync";

export interface AppNotification {
  id: string;
  audience: Role;
  /** Scope to one user; undefined = everyone with the audience role. */
  userId?: string;
  kind: NotificationKind;
  title: string;
  body: string;
  at: number;
  read: boolean;
  severity: "info" | "success" | "warning" | "critical";
  link?: string;
}

/* -------------------------------------------------------------- telemetry */

export interface AuditEntry {
  id: string;
  at: number;
  actorId: string;
  action: string;
  target: string;
  detail?: string;
}

/** Anything captured while offline waits here until connectivity returns. */
export interface OutboxItem {
  id: string;
  at: number;
  kind: "location" | "attendance" | "work-update" | "selfie";
  label: string;
  payloadId: string;
}

/* ------------------------------------------------------------------ prefs */

export interface Permissions {
  location: "granted" | "denied" | "prompt";
  backgroundLocation: "granted" | "denied" | "prompt";
  camera: "granted" | "denied" | "prompt";
  notifications: "granted" | "denied" | "prompt";
  privacyAccepted: boolean;
}

export interface Settings {
  /** Where GPS fixes come from. Simulated keeps the app usable off-site. */
  locationSource: "simulated" | "device";
  /** Seconds between recorded fixes — the battery/accuracy dial. */
  samplingSeconds: number;
  /** Discard fixes worse than this many metres. */
  accuracyFloor: number;
  /** Ignore fixes closer than this to the previous one (dedupe). */
  minMoveMeters: number;
  forceOffline: boolean;
  retentionDays: number;
  units: "metric" | "imperial";
}

/* ------------------------------------------------------------------ store */

export interface Session {
  userId: string;
  role: Role;
  at: number;
}

export interface WorkforceState {
  version: number;
  users: User[];
  projects: Project[];
  attendance: Attendance[];
  points: LocationPoint[];
  updates: WorkUpdate[];
  notifications: AppNotification[];
  audit: AuditEntry[];
  outbox: OutboxItem[];
  /* shift → payroll pipeline */
  shifts: ShiftDef[];
  shiftAssignments: ShiftAssignment[];
  comp: CompRecord[];
  payPolicy: PayPolicy;
  payrollRuns: PayrollRun[];
  permissions: Permissions;
  settings: Settings;
  session: Session | null;
  /** Project the signed-in employee is working on today. */
  activeProjectId: string | null;
}
