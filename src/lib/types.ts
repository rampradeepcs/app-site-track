/**
 * SiteTrack — construction workforce attendance & live-site tracking.
 *
 * Domain entities. Everything is serialisable so the whole store can be
 * persisted to localStorage and replayed offline (see `store.tsx`).
 *
 * Timestamps are epoch milliseconds; dates are ISO `YYYY-MM-DD` strings in the
 * project's local calendar so a shift never straddles two "days".
 */

export type Role = "employee" | "manager" | "admin";

export type LatLng = { lat: number; lng: number };

/* ------------------------------------------------------------------ users */

export type EmployeeStatus = "active" | "inactive" | "on-leave";

export interface User {
  id: string;
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

export interface Project {
  id: string;
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
  mapStyle: "dark" | "light";
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
  permissions: Permissions;
  settings: Settings;
  session: Session | null;
  /** Project the signed-in employee is working on today. */
  activeProjectId: string | null;
}
