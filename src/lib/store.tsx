"use client";

/**
 * Workfence client store.
 *
 * A single React context that owns the whole workforce dataset:
 *  - hydrates from localStorage, and from Postgres when there is a backend,
 *  - persists every mutation locally and then pushes it,
 *  - runs the live-tracking engine (real `navigator.geolocation` fixes, or a
 *    simulated walk) while a shift is open,
 *  - queues what was captured offline and uploads it on reconnect.
 *
 * Local first, always. A mutation lands here before it goes anywhere, so the
 * app is instant and keeps working with no signal — which is the condition it
 * is actually used in. The push is the second half of that bargain: ids are
 * minted here so a record has one identity in both places, and a write that
 * fails is reported rather than swallowed. See `supabase/sync.ts`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  checkGeofence,
  distanceMeters,
  offsetMeters,
  resolvePlace,
  type FenceCheck,
} from "./geo";
import { fmtDistance, todayISO } from "./format";
import { setActor } from "./actor";
import { assignedPremises, nearestPremise, premiseAt } from "./premises";
import { SEED_VERSION, buildSeedState, makeSelfie } from "./seed";
import { clearDestination, homeFor } from "./routes";
import { showToast } from "./toast";
import {
  DEFAULT_OVERTIME,
  DEFAULT_PAY_POLICY,
  dayMetrics,
  fmtHM,
  monthLocked,
  shiftFor,
} from "./payroll";
import { fmtKmLabel, sanitiseTrack, travelPoints, vehicleOf } from "./allowances";
import {
  DEMO_EMAIL,
  clearDemoData,
  currentPersonaId,
  demoActive,
  personaById,
  setCurrentPersona,
  setDemoActive,
  workforceKey,
  isDemoUserId,
  leaveDemoFor,
} from "./demo/mode";
import { buildDemoData } from "./demo/seed";
import { isLiveBackend } from "./supabase/client";
import { onAuthChange, signOut as authSignOut } from "./supabase/auth";
import {
  fetchOperations,
  fetchWorkforce,
  insertAllowanceDecision,
  insertCheckIn,
  insertCheckOut,
  insertComp,
  insertPoints,
  insertShiftAssignments,
  insertWorkUpdate,
  replaceProjectMembers,
  updateBreaks,
  updateOvertime,
  upsertFoodRule,
  upsertPayPolicy,
  upsertPayrollRun,
  upsertPetrolRule,
  upsertProject,
  upsertShift,
  upsertTravelSession,
  upsertUser,
  deleteUser,
  upsertLabourTeam,
  upsertTeamMembers,
  insertGroupAttendance,
  upsertProjectNote,
  deleteProjectNote,
  insertNoteAttachment,
  deleteNoteAttachment,
  fetchTeamWorld,
} from "./supabase/repository";
import { persist, uid } from "./supabase/sync";
import { nextTeamCode } from "./teams";
import { canCaptureGroupAttendance, canSeeNote } from "./access";
import { dueReminders } from "./notes";
import type {
  AppNotification,
  Attendance,
  AttendanceMark,
  BreakEntry,
  CompRecord,
  FoodRule,
  LatLng,
  LocationPoint,
  OutboxItem,
  OvertimeStatus,
  PayPolicy,
  PayrollRun,
  PayrollStatus,
  Project,
  Role,
  Settings,
  PetrolRule,
  ShiftAssignment,
  ShiftDef,
  ShiftEvent,
  TrackingMode,
  TravelPurpose,
  TravelSession,
  User,
  Vehicle,
  VoiceNote,
  WorkUpdate,
  WorkforceState,
  LabourTeam,
  LabourTeamStatus,
  LabourTeamMember,
  TeamMemberStatus,
  GroupAttendanceRecord,
  GroupAttendanceMember,
  FaceDetectionStatus,
  FaceMatchStatus,
  GeofenceCheck,
  ProjectNote,
  ProjectNoteAttachment,
  NoteStatus,
  WorkCategory,
} from "./types";

// Derived, not written by hand: the key said v3 while the shape was at v5,
// which is the same drift that silently discarded sessions once already.
// `workforceKey()` swaps in the demo namespace while demo mode is on, which
// is what keeps demonstration data and real data from ever meeting.
const STORAGE_KEY = `workfence.v${SEED_VERSION}`;
// Must match the version stamped by buildSeedState() in seed.ts.


let idCounter = Math.floor(Math.random() * 1e6);
/**
 * Id for something that never leaves this device — an outbox entry, a
 * notification, a local audit line. Readable on purpose.
 */
const rid = (p: string) => `${p}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/** Default contracted shift for a freshly provisioned company: 9-to-6. */
const DEFAULT_SHIFT = { start: 9 * 60, end: 18 * 60 };

/** "Born Creative" -> "borncreative.workfence.app", for placeholder addresses. */
function domainFor(company: string): string {
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${slug || "company"}.workfence.app`;
}

/**
 * Employee-code prefix from a company name: "Born Creative" -> "BC".
 * Initials read better on a badge than a slug, and stay short when the name
 * does not. Falls back to WF so a code is never just a number.
 */
function codeStem(company: string): string {
  const initials = company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  return initials || "WF";
}

/**
 * Stable avatar tint from a name, so the same person is the same colour on
 * every device instead of a fresh random one per install.
 */
function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** The company's own name, for codes that used to be hardcoded "NT-". */
function orgNameFor(s: WorkforceState): string {
  const me = s.users.find((u) => u.id === s.session?.userId);
  const mate = s.users.find((u) => u.orgId === me?.orgId && u.role === "admin");
  return s.projects.find((p) => p.orgId === me?.orgId)?.client || mate?.name || "";
}

/** Next free employee code for a company, e.g. AB-0007. */
function nextCode(s: WorkforceState, stem: string): string {
  const n = s.users.filter((u) => u.employeeCode.startsWith(`${stem}-`)).length + 1;
  return `${stem}-${String(n).padStart(4, "0")}`;
}

/** Next free premise code, e.g. AB-S03. */
function nextProjectCode(s: WorkforceState, stem: string): string {
  const n = s.projects.filter((p) => p.code.startsWith(`${stem}-S`)).length + 1;
  return `${stem}-S${String(n).padStart(2, "0")}`;
}

/**
 * Tenant of the signed-in user. New records inherit it, so a manager can
 * never create a record that lands in another client's data.
 */
function currentOrgId(s: WorkforceState): string {
  const u = s.users.find((x) => x.id === s.session?.userId);
  return u?.orgId ?? "";
}

/**
 * Narrow the state to a single tenant. Applied to `state` before it reaches
 * any client surface, so a manager or employee physically cannot read another
 * client's people, projects, attendance, routes or updates — isolation is a
 * property of the data they receive, not of each screen remembering to filter.
 *
 * The platform Super Admin has no org and is deliberately exempt.
 */
function scopeToTenant(s: WorkforceState): WorkforceState {
  const me = s.users.find((x) => x.id === s.session?.userId);
  if (!me || me.role === "superadmin" || !me.orgId) return s;
  const orgId = me.orgId;
  const projectIds = new Set(
    s.projects.filter((p) => p.orgId === orgId).map((p) => p.id),
  );
  const userIds = new Set(s.users.filter((u) => u.orgId === orgId).map((u) => u.id));
  return {
    ...s,
    users: s.users.filter((u) => u.orgId === orgId),
    projects: s.projects.filter((p) => p.orgId === orgId),
    attendance: s.attendance.filter((a) => projectIds.has(a.projectId)),
    points: s.points.filter((pt) => userIds.has(pt.employeeId)),
    updates: s.updates.filter((u) => userIds.has(u.employeeId)),
    notifications: s.notifications.filter((n) => !n.userId || userIds.has(n.userId)),
    shifts: (s.shifts ?? []).filter((x) => x.orgId === orgId),
    shiftAssignments: (s.shiftAssignments ?? []).filter((x) => userIds.has(x.employeeId)),
    comp: (s.comp ?? []).filter((x) => userIds.has(x.employeeId)),
    payrollRuns: (s.payrollRuns ?? []).filter((x) => x.orgId === orgId),
    travelSessions: (s.travelSessions ?? []).filter((x) => userIds.has(x.employeeId)),
    petrolRules: (s.petrolRules ?? []).filter((x) => x.orgId === orgId),
    foodRules: (s.foodRules ?? []).filter((x) => x.orgId === orgId),
    allowanceDecisions: (s.allowanceDecisions ?? []).filter((x) =>
      userIds.has(x.employeeId),
    ),
  };
}

/* ----------------------------------------------------------- live fix */

export interface LiveFix {
  coords: LatLng;
  accuracy: number;
  speed: number;
  heading: number;
  at: number;
  /** True when GPS is flapping (simulated dropouts / real errors). */
  degraded: boolean;
}

export type SimScenario = "outside" | "approach" | "onsite" | "wander-out";

/* --------------------------------------------------------- self-serve setup */

/** A premise as the signup wizard describes it, before it becomes a Project. */
export interface PremiseDraft {
  name: string;
  address: string;
  location: LatLng;
  /** Metres. The wizard offers a slider; there is no sensible universal default. */
  radius: number;
}

/** Somebody the founder invited, from their contacts or typed in by hand. */
export interface CrewInvite {
  name: string;
  /** Optional here: a crew picked from the phone's contacts often has none. */
  email?: string;
  phone?: string;
  designation?: string;
}

export interface CompanyDraft {
  company: string;
  /* Email first: it is what the admin signs in with. */
  admin: { name: string; email: string; phone?: string };
  site: PremiseDraft & { trackingMode: TrackingMode };
  /** Optional: a company that only ever works on site does not need one. */
  office: PremiseDraft | null;
  crew: CrewInvite[];
}

export interface ProvisionedCompany {
  orgId: string;
  admin: User;
  site: Project;
  office: Project | null;
  crew: User[];
}

interface StoreApi {
  state: WorkforceState;
  hydrated: boolean;
  online: boolean;

  /* session */
  login: (role: Role, userId?: string) => void;
  /** Sign in as a record that came from the backend rather than the seed. */
  loginAs: (user: User) => void;
  /** Stand up a whole new tenant from the self-serve signup, and sign in. */
  provisionCompany: (draft: CompanyDraft) => ProvisionedCompany;
  /** Re-read this tenant from the backend — after creating it, for instance. */
  reloadFromBackend: () => Promise<void>;
  logout: () => void;
  currentUser: User | null;
  setActiveProject: (projectId: string) => void;

  /* live position (employee) */
  fix: LiveFix | null;
  fence: FenceCheck | null;
  simScenario: SimScenario;
  setSimScenario: (s: SimScenario) => void;

  /* attendance */
  openShift: Attendance | null;
  checkIn: (
    selfie: string | null,
    faceCheck?: { verified: boolean; distance: number },
  ) => { ok: boolean; reason?: string };
  enrollFace: (userId: string, descriptors: number[][]) => void;
  markPresentFromPhoto: (
    employeeIds: string[],
    projectId: string,
  ) => { marked: number; skipped: number };
  checkOut: (
    selfie: string | null,
    extras?: { voiceNote?: Omit<VoiceNote, "at" | "coords" | "place"> },
  ) => { ok: boolean; reason?: string };
  liveTrail: LocationPoint[];

  /* breaks */
  startBreak: () => { ok: boolean; reason?: string };
  endBreak: () => { ok: boolean; reason?: string };

  /* shift → payroll pipeline */
  saveShift: (patch: Partial<ShiftDef> & { name: string }, id?: string) => ShiftDef;
  archiveShift: (shiftId: string) => void;
  assignShift: (employeeIds: string[], shiftId: string, effectiveFrom: string) => void;
  saveComp: (
    rec: Omit<CompRecord, "id" | "setBy" | "at">,
  ) => { ok: boolean; reason?: string };
  updatePayPolicy: (patch: Partial<PayPolicy>) => void;
  decideOvertimeMany: (
    attendanceIds: string[],
    decision: "approved" | "rejected",
  ) => void;
  decideOvertime: (
    attendanceId: string,
    decision: Extract<OvertimeStatus, "approved" | "rejected">,
    approvedMinutes?: number,
    note?: string,
  ) => void;
  setPayrollStatus: (month: string, status: PayrollStatus) => void;
  /** Append one audit line for a sensitive action a screen performed. */
  logAudit: (action: string, target: string, detail?: string) => void;

  /* demo mode */
  isDemo: boolean;
  /** Seed the demo namespace and sign in as a persona. */
  enterDemo: (personaId: string) => void;
  /** Change seat without signing in again. */
  switchPersona: (personaId: string) => void;
  /** Restore the demonstration to its original state. */
  resetDemo: () => void;
  /** Leave demo mode; real data is exactly as it was left. */
  exitDemo: () => void;

  /* travel & allowances */
  activeTravel: TravelSession | null;
  startTravel: (
    purpose: TravelPurpose,
    note?: string,
    selfie?: string,
  ) => { ok: boolean; reason?: string };
  endTravel: () => { ok: boolean; reason?: string };
  decideTravel: (
    sessionId: string,
    decision: "approved" | "rejected",
    approvedKm?: number,
    note?: string,
  ) => void;
  savePetrolRule: (patch: Partial<PetrolRule> & { name: string }, id?: string) => void;
  saveFoodRule: (patch: Partial<FoodRule> & { name: string }, id?: string) => void;
  archiveAllowanceRule: (kind: "petrol" | "food", id: string) => void;
  decideFoodAllowance: (
    employeeId: string,
    date: string,
    ruleId: string,
    status: "approved" | "rejected",
    note?: string,
  ) => void;
  saveVehicle: (employeeId: string, vehicle: Vehicle | null) => void;
  setProjectTravelTracking: (projectId: string, on: boolean) => void;
  addPayrollAdjustment: (
    month: string,
    employeeId: string,
    amount: number,
    note: string,
  ) => void;

  /* mutations */
  submitWorkUpdate: (u: Partial<WorkUpdate> & { description: string }) => void;
  saveEmployee: (u: Partial<User> & { name: string }, id?: string) => User;
  /**
   * Delete a person and everything logged against them. The platform
   * owner's action, taken from a client's page; the client's own admin
   * deactivates instead, which keeps the history.
   */
  removeUser: (userId: string) => void;
  /** Super-admin: promote/demote a user between employee and manager. */
  setUserRole: (userId: string, role: Role) => void;
  removeEmployeeFromProject: (userId: string, projectId: string) => void;
  assignEmployee: (userId: string, projectId: string) => void;
  saveProject: (p: Partial<Project> & { name: string }, id?: string) => Project;
  updateGeofence: (projectId: string, fence: Project["geofence"]) => void;
  setPermission: (key: keyof WorkforceState["permissions"], value: WorkforceState["permissions"][keyof WorkforceState["permissions"]]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  markNotificationsRead: (audience: Role) => void;
  pushNotification: (n: Omit<AppNotification, "id" | "at" | "read">) => void;
  /* labour teams */
  saveTeam: (patch: Partial<LabourTeam> & { name: string; projectId: string }, id?: string) => LabourTeam;
  setTeamStatus: (teamId: string, status: LabourTeamStatus) => void;
  addTeamMembers: (teamId: string, employeeIds: string[]) => { added: number; skipped: number };
  removeTeamMember: (teamId: string, employeeId: string, status?: TeamMemberStatus) => void;
  transferMember: (employeeId: string, fromTeamId: string, toTeamId: string) => { ok: boolean; reason?: string };
  setTeamLeader: (teamId: string, employeeId: string | undefined) => void;

  /* group attendance */
  submitGroupAttendance: (input: GroupAttendanceInput) => { ok: boolean; groupId?: string; marked: number; reason?: string };

  /** A work update about a whole gang, authored by whoever wrote it. */
  submitTeamUpdate: (input: TeamUpdateInput) => { ok: boolean; reason?: string };
  /** Announce note reminders that have come due, to the people who may read them. */
  fireDueReminders: () => number;

  /* project notes */
  saveNote: (patch: Partial<ProjectNote> & { projectId: string; title: string }, id?: string) => ProjectNote;
  setNotePinned: (noteId: string, pinned: boolean) => void;
  setNoteStatus: (noteId: string, status: NoteStatus) => void;
  deleteNote: (noteId: string) => void;
  addNoteAttachment: (noteId: string, file: Omit<ProjectNoteAttachment, "id" | "orgId" | "noteId" | "createdBy" | "createdAt">) => void;
  removeNoteAttachment: (attachmentId: string) => void;

  /**
   * Wipe this device's copy of everything and start from an empty install.
   *
   * Named for what it does now that there is no seeded demo to return to:
   * against a local store this is the company's only copy, and there is no
   * undo. Callers must confirm before calling it.
   */
  eraseLocalData: () => void;
}

/**
 * One confirmed group capture, as the review screen hands it over.
 *
 * The reviewer's decision travels with every member rather than being
 * inferred from the face matching, because they are allowed to disagree
 * with it — and when they do, that disagreement is the record.
 */
export interface TeamUpdateInput {
  teamId: string;
  category: WorkCategory;
  description: string;
  photos?: string[];
  voiceNoteSeconds?: number;
}

export interface GroupAttendanceInput {
  projectId: string;
  teamId: string;
  shiftId?: string;
  photos: string[];
  coords?: LatLng;
  geofenceStatus: GeofenceCheck;
  faceCount: number;
  note?: string;
  members: Array<{
    employeeId: string;
    detectionStatus: FaceDetectionStatus;
    matchStatus: FaceMatchStatus;
    attendanceStatus: "present" | "absent";
    reviewStatus: "proposed" | "confirmed" | "corrected";
    distance?: number;
  }>;
}

const Ctx = createContext<StoreApi | null>(null);

export function useWorkforce(): StoreApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useWorkforce must be used inside <WorkforceProvider>");
  return api;
}

/* -------------------------------------------------------------- provider */

export function WorkforceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkforceState | null>(null);
  const [fix, setFix] = useState<LiveFix | null>(null);
  const [simScenario, setSimScenarioRaw] = useState<SimScenario>("approach");

  const stateRef = useRef<WorkforceState | null>(null);
  const fixRef = useRef<LiveFix | null>(null);
  const simRef = useRef<SimScenario>("approach");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    fixRef.current = fix;
  }, [fix]);

  /* connectivity — real browser signal AND the demo force-offline switch */
  const navOnline = useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true,
  );
  const online = navOnline && !(state?.settings.forceOffline ?? false);
  const lastRecordedRef = useRef<number>(0);
  /**
   * Whether the trail is currently being written. Only meaningful under
   * `outside-only`, where recording stops and starts within a single shift.
   */
  const recordingRef = useRef<boolean>(false);
  const gpsDropRef = useRef<{ until: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  /**
   * Pull this tenant from the backend into state.
   *
   * Exposed as well as run on mount, because the moment a company is created
   * is the moment local state is most wrong. The RPC builds the organisation,
   * the founder and the crew server-side with ids this client has never seen,
   * and onboarding read back only the founder — so everyone they had just
   * invited existed in Postgres and nowhere on screen, and stayed missing
   * until something else happened to trigger a re-read.
   *
   * The two rules that make it safe to run against a real database are
   * unchanged: it re-runs on sign-in, because every RLS policy resolves
   * through auth.uid() and a read issued before authentication is correctly
   * answered with nothing; and an empty result never overwrites, because zero
   * users means "not authorised" far more often than "empty tenant" — the
   * signed-in person is themselves a row.
   */
  const reloadFromBackend = useCallback(async () => {
    if (!isLiveBackend || demoActive()) return;
    let live: Awaited<ReturnType<typeof fetchWorkforce>>;
    try {
      live = await fetchWorkforce();
    } catch (err) {
      console.error("[Workfence] Supabase hydration failed; staying on local state.", err);
      return;
    }
    if (live.users.length === 0) {
      console.warn(
        "[Workfence] Supabase returned no visible rows — not signed in, " +
          "or this identity is not linked to an organisation. Keeping local state.",
      );
      return;
    }
    setState((prev) =>
      prev
        ? {
            ...prev,
            users: live.users,
            projects: live.projects,
            attendance: live.attendance,
            updates: live.updates,
          }
        : prev,
    );
    // Shifts, salary, payroll, travel and allowance rules follow in their own
    // round: RLS may legitimately answer parts of it with nothing (a manager
    // who may not read salary), and that must not void the workforce read
    // that already succeeded. Teams and notes likewise.
    await Promise.all([
      fetchOperations()
        .then((ops) => {
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  shifts: ops.shifts,
                  shiftAssignments: ops.shiftAssignments,
                  comp: ops.comp,
                  payPolicy: ops.payPolicy ?? prev.payPolicy,
                  payrollRuns: ops.payrollRuns,
                  travelSessions: ops.travelSessions,
                  petrolRules: ops.petrolRules,
                  foodRules: ops.foodRules,
                  allowanceDecisions: ops.allowanceDecisions,
                }
              : prev,
          );
        })
        .catch((err) => {
          console.error(
            "[Workfence] Shift/payroll/allowance hydration failed; keeping local state.",
            err,
          );
        }),
      fetchTeamWorld()
        .then((tw) => {
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  labourTeams: tw.labourTeams,
                  teamMembers: tw.teamMembers,
                  groupAttendance: tw.groupAttendance,
                  groupAttendanceMembers: tw.groupAttendanceMembers,
                  projectNotes: tw.projectNotes,
                  noteAttachments: tw.noteAttachments,
                }
              : prev,
          );
        })
        .catch((err) => {
          console.error("[Workfence] Team/notes hydration failed; keeping local state.", err);
        }),
    ]);
  }, []);

  /* hydrate on the client only — the seed depends on Date.now() */
  useEffect(() => {
    let next: WorkforceState | null = null;
    try {
      const raw = localStorage.getItem(workforceKey());
      if (raw) {
        const parsed = JSON.parse(raw) as WorkforceState;
        // Fields added after this blob was written are filled with their
        // defaults rather than discarding the company (shift → payroll
        // pipeline arrived after v6 shipped).
        if (parsed.version === SEED_VERSION) {
          next = {
            ...parsed,
            shifts: parsed.shifts ?? [],
            shiftAssignments: parsed.shiftAssignments ?? [],
            comp: parsed.comp ?? [],
            payPolicy: { ...DEFAULT_PAY_POLICY, ...(parsed.payPolicy ?? {}) },
            payrollRuns: parsed.payrollRuns ?? [],
            travelSessions: parsed.travelSessions ?? [],
            petrolRules: parsed.petrolRules ?? [],
            foodRules: parsed.foodRules ?? [],
            allowanceDecisions: parsed.allowanceDecisions ?? [],
            // Labour teams, group attendance and project notes arrived after
            // v6 shipped; same bargain as above.
            labourTeams: parsed.labourTeams ?? [],
            teamMembers: parsed.teamMembers ?? [],
            groupAttendance: parsed.groupAttendance ?? [],
            groupAttendanceMembers: parsed.groupAttendanceMembers ?? [],
            projectNotes: parsed.projectNotes ?? [],
            noteAttachments: parsed.noteAttachments ?? [],
          };
        }
      }
    } catch {
      /* corrupted storage → reseed */
    }
    if (!next) {
      // In demo mode an empty namespace means "seed the demonstration"; in
      // real mode it means a fresh install with nothing in it.
      next = demoActive() ? buildDemoData().workforce : buildSeedState();
    }
    // One-time client hydration: localStorage isn't available during SSR,
    // so the initial state has to land in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(next);

    // Live mode: replace the local people/projects/attendance with the
    // signed-in tenant's real rows. Settings, permissions and the session
    // stay local — they are device preferences, not tenant data. A failure
    // here is non-fatal: the app keeps running on what it already has rather
    // than showing a worker an empty screen at the site gate.
    //
    // Two rules make this safe to run against a real database:
    //
    //  1. It re-runs on sign-in. Every RLS policy resolves through
    //     `auth.uid()`, so a read issued before authentication is correctly
    //     answered with nothing. Hydrating once on mount would therefore
    //     always miss.
    //  2. An empty result never overwrites. Zero users means "this caller is
    //     not authorised" far more often than it means "this tenant is
    //     empty" — the signed-in person is themselves a row. Blanking the
    //     app on that reading is the worst possible failure, so it is
    //     treated as no answer at all.
    // Demo mode is local by construction: it never reads or writes a real
    // tenant's rows, whatever backend this build is pointed at.
    if (isLiveBackend && !demoActive()) {
      void reloadFromBackend();
      const off = onAuthChange((signedIn) => {
        if (signedIn) void reloadFromBackend();
      });
      return () => off();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* persist (debounced via rAF batching of React updates) */
  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(workforceKey(), JSON.stringify(state));
    } catch {
      /* quota exceeded — drop oldest trail points and retry once */
      try {
        const slim = { ...state, points: state.points.slice(-4000) };
        localStorage.setItem(workforceKey(), JSON.stringify(slim));
      } catch {
        /* give up quietly; app keeps working in memory */
      }
    }
  }, [state]);

  const mutate = useCallback((fn: (s: WorkforceState) => WorkforceState) => {
    setState((s) => (s ? fn(s) : s));
  }, []);

  /* ------------------------------------------------------------ helpers */

  const currentUser = useMemo(() => {
    if (!state || !state.session) return null;
    const sess = state.session;
    return state.users.find((u) => u.id === sess.userId) ?? null;
  }, [state]);

  /*
   * Publish who is acting, for the platform audit trail.
   *
   * The audit lives in the platform store, which is this store's *parent* in
   * the provider tree and so cannot read the session from context. An effect
   * writing to a plain module — not to state — is the whole bridge; nothing
   * renders from it, it is only read when an entry is appended.
   */
  useEffect(() => {
    setActor(currentUser ? { id: currentUser.id, name: currentUser.name } : null);
  }, [currentUser]);

  const activeProject = useMemo(() => {
    if (!state || !currentUser) return null;
    const pid = state.activeProjectId ?? currentUser.projectIds[0];
    return state.projects.find((p) => p.id === pid) ?? null;
  }, [state, currentUser]);

  const openShift = useMemo(() => {
    if (!state || !currentUser) return null;
    const today = todayISO();
    return (
      state.attendance.find(
        (a) =>
          a.employeeId === currentUser.id &&
          a.date === today &&
          a.checkIn &&
          !a.checkOut &&
          !a.autoClosed,
      ) ?? null
    );
  }, [state, currentUser]);

  const activeTravel = useMemo(() => {
    if (!state || !currentUser) return null;
    return (
      (state.travelSessions ?? []).find(
        (t) => t.employeeId === currentUser.id && t.status === "active",
      ) ?? null
    );
  }, [state, currentUser]);

  const liveTrail = useMemo(() => {
    if (!state || !openShift) return [];
    return state.points
      .filter((p) => p.attendanceId === openShift.id)
      .sort((a, b) => a.at - b.at);
  }, [state, openShift]);

  const fence: FenceCheck | null = useMemo(() => {
    if (!fix || !activeProject) return null;
    return checkGeofence(fix.coords, activeProject.geofence);
  }, [fix, activeProject]);

  const pushNotification = useCallback(
    (n: Omit<AppNotification, "id" | "at" | "read">) => {
      mutate((s) => ({
        ...s,
        notifications: [
          { ...n, id: rid("ntf"), at: Date.now(), read: false },
          ...s.notifications,
        ].slice(0, 200),
      }));
    },
    [mutate],
  );

  /* -------------------------------------------------- simulated GPS walk */

  const setSimScenario = useCallback((sc: SimScenario) => {
    simRef.current = sc;
    setSimScenarioRaw(sc);
  }, []);

  useEffect(() => {
    simRef.current = simScenario;
  }, [simScenario]);

  /** One simulation step — returns the next fix for the employee. */
  const simStep = useCallback((): LiveFix | null => {
    const s = stateRef.current;
    if (!s?.session || s.session.role !== "employee") return null;
    const user = s.users.find((u) => u.id === s.session!.userId);
    if (!user) return null;
    const pid = s.activeProjectId ?? user.projectIds[0];
    const project = s.projects.find((p) => p.id === pid);
    if (!project) return null;

    const gate =
      project.zones.find((z) => z.kind === "access")?.center ?? project.location;
    const prev = fixRef.current;
    const scenario = simRef.current;

    // Occasional GPS dropout window (~4% chance to start, lasts 6–14 s).
    const now = Date.now();
    if (!gpsDropRef.current && Math.random() < 0.02) {
      gpsDropRef.current = { until: now + 6000 + Math.random() * 8000 };
    }
    const degraded = !!gpsDropRef.current && now < gpsDropRef.current.until;
    if (gpsDropRef.current && now >= gpsDropRef.current.until) gpsDropRef.current = null;

    let target: LatLng;
    const shiftOpen = s.attendance.some(
      (a) => a.employeeId === user.id && a.date === todayISO() && a.checkIn && !a.checkOut && !a.autoClosed,
    );
    if (shiftOpen) {
      // Roam the work zones while on shift; drift out when asked to.
      if (scenario === "wander-out") {
        target = offsetMeters(project.location, project.geofence.radius + 160, 210);
      } else {
        const zones = project.zones.filter((z) => z.kind === "work" || z.kind === "material");
        const zone = zones[Math.floor((now / 90000) % zones.length)];
        target = zone?.center ?? project.location;
      }
    } else {
      target =
        scenario === "outside"
          ? offsetMeters(gate, 420, 195)
          : scenario === "onsite"
            ? offsetMeters(project.location, 25, 80)
            : gate; // approach → converge on the gate
    }

    const from = prev?.coords ?? offsetMeters(gate, scenario === "onsite" ? 20 : 430, 200);
    const dist = distanceMeters(from, target);
    // Demo speed-up: sprint when far so scenario switches feel immediate,
    // settle to a walking pace near the target.
    const stride = Math.min(dist, dist > 120 ? 60 + Math.random() * 30 : 14 + Math.random() * 10);
    const heading =
      dist < 2
        ? Math.random() * 360
        : (Math.atan2(target.lng - from.lng, target.lat - from.lat) * 180) / Math.PI;
    const wobbled = offsetMeters(
      offsetMeters(from, stride, ((heading % 360) + 360) % 360),
      Math.random() * 3,
      Math.random() * 360,
    );
    return {
      coords: wobbled,
      accuracy: degraded ? 45 + Math.random() * 40 : 4 + Math.random() * 10,
      speed: dist < 2 ? Math.random() * 0.3 : 1 + Math.random() * 0.6,
      heading: ((heading % 360) + 360) % 360,
      at: now,
      degraded,
    };
  }, []);

  /* Record a fix into the open shift trail (or outbox when offline). */
  const recordFix = useCallback(
    (f: LiveFix) => {
      const s = stateRef.current;
      if (!s?.session) return;
      const user = s.users.find((u) => u.id === s.session!.userId);
      if (!user) return;
      const today = todayISO();
      const shift = s.attendance.find(
        (a) => a.employeeId === user.id && a.date === today && a.checkIn && !a.checkOut && !a.autoClosed,
      );
      if (!shift) return;

      const project = s.projects.find((p) => p.id === shift.projectId);

      // A deliberately-started travel session overrides the shift's privacy
      // silence: the worker asked for this run to be measured (spec §7).
      const travel = (s.travelSessions ?? []).find(
        (t) => t.employeeId === user.id && t.status === "active",
      );

      // Under `outside-only` the boundary is a privacy line, not a warning
      // line: while the worker is inside it, nothing is written at all.
      const offsiteOnly = project?.trackingMode === "outside-only";
      const inside = project
        ? checkGeofence(f.coords, project.geofence).inside
        : false;
      if (!travel && offsiteOnly && inside) {
        // Remember that the next fix outside opens a fresh stretch of trail.
        recordingRef.current = false;
        return;
      }

      const sampleMs = (s.settings.samplingSeconds || 15) * 1000;
      if (f.at - lastRecordedRef.current < sampleMs) return;
      if (f.accuracy > s.settings.accuracyFloor) return; // reject junk fixes

      // A gap in recording means the previous point is not the previous
      // position — the worker moved while the app was not watching. Neither
      // the dedupe nor the odometer may reason across it.
      const segmentStart = offsiteOnly && !recordingRef.current;
      const trail = s.points.filter((p) => p.attendanceId === shift.id);
      const last = segmentStart ? undefined : trail[trail.length - 1];
      if (last) {
        const moved = distanceMeters({ lat: last.lat, lng: last.lng }, f.coords);
        if (moved < s.settings.minMoveMeters) return; // dedupe stationary noise
      }
      lastRecordedRef.current = f.at;
      recordingRef.current = true;

      const isOffline = !(navigator.onLine && !s.settings.forceOffline);
      const point: LocationPoint = {
        id: uid(),
        attendanceId: shift.id,
        employeeId: user.id,
        projectId: shift.projectId,
        lat: f.coords.lat,
        lng: f.coords.lng,
        accuracy: f.accuracy,
        speed: f.speed,
        heading: f.heading,
        at: f.at,
        queued: isOffline || undefined,
        segmentStart: segmentStart || undefined,
        travelSessionId: travel?.id,
      };
      const added = last
        ? distanceMeters({ lat: last.lat, lng: last.lng }, f.coords)
        : 0;

      mutate((prev) => ({
        ...prev,
        points: [...prev.points, point],
        attendance: prev.attendance.map((a) =>
          a.id === shift.id
            ? { ...a, distanceMeters: a.distanceMeters + added }
            : a,
        ),
        outbox: isOffline
          ? [
              ...prev.outbox,
              {
                id: rid("ob"),
                at: f.at,
                kind: "location",
                label: "Location point",
                payloadId: point.id,
              } satisfies OutboxItem,
            ]
          : prev.outbox,
      }));
      // One fix per call rather than a batch: the trail has to survive the
      // phone dying mid-shift, and a buffer that is flushed every few minutes
      // is exactly the stretch of route that would be lost. Offline fixes
      // batch anyway — they queue in the outbox and flush together.
      if (!isOffline) {
        persist("save the location trail", () =>
          insertPoints([point], user.orgId),
        );
      }
    },
    [mutate],
  );

  /* Geofence exit/return events during a shift. */
  const fenceStateRef = useRef<boolean | null>(null);
  const watchFence = useCallback(
    (f: LiveFix) => {
      const s = stateRef.current;
      if (!s?.session) return;
      const user = s.users.find((u) => u.id === s.session!.userId);
      if (!user) return;
      const shift = s.attendance.find(
        (a) => a.employeeId === user.id && a.date === todayISO() && a.checkIn && !a.checkOut && !a.autoClosed,
      );
      if (!shift) {
        fenceStateRef.current = null;
        return;
      }
      const project = s.projects.find((p) => p.id === shift.projectId);
      if (!project) return;
      const inside = checkGeofence(f.coords, project.geofence).inside;
      const was = fenceStateRef.current;
      fenceStateRef.current = inside;
      if (was === null || was === inside) return;

      const ev: ShiftEvent = {
        id: rid("ev"),
        at: f.at,
        kind: inside ? "geofence-return" : "geofence-exit",
        detail: inside
          ? "Re-entered the site boundary"
          : "Left the site boundary during an active shift",
      };
      mutate((prev) => ({
        ...prev,
        attendance: prev.attendance.map((a) =>
          a.id === shift.id ? { ...a, events: [...a.events, ev] } : a,
        ),
      }));
      // Under `outside-only` the boundary crossing *is* the tracking event —
      // leaving starts the recording rather than merely being noted — so the
      // wording has to say what actually just happened.
      const offsiteOnly = project.trackingMode === "outside-only";
      pushNotification({
        audience: "manager",
        kind: "geofence-exit",
        title: inside
          ? `${user.name} returned to site`
          : `${user.name} left the site boundary`,
        body: offsiteOnly
          ? inside
            ? `${project.name} — off-site tracking stopped`
            : `${project.name} — off-site tracking started`
          : `${project.name} — shift stays open per project rules`,
        severity: inside ? "info" : "warning",
      });
      // Returning is only worth telling the worker about under `outside-only`,
      // where it means recording has stopped. On a full-shift project nothing
      // changed when they walked back in, so nothing is said.
      if (!inside || offsiteOnly) {
        pushNotification({
          audience: "employee",
          userId: user.id,
          kind: "geofence-exit",
          title: inside
            ? "Back inside the site — recording stopped"
            : "You've left the site boundary",
          body: offsiteOnly
            ? inside
              ? "Location recording has stopped. It resumes if you leave the site again."
              : "Your route is now being recorded until you check out at a site or office."
            : "Your shift is still running. Tracking continues per project policy.",
          severity: inside ? "info" : "warning",
        });
      }
    },
    [mutate, pushNotification],
  );

  /* Tick loop: simulated source at 1 Hz; device source via watchPosition. */
  useEffect(() => {
    if (!state?.session || state.session.role !== "employee") return;
    if (state.settings.locationSource === "device") {
      if (!("geolocation" in navigator)) return;
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const f: LiveFix = {
            coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            accuracy: pos.coords.accuracy ?? 20,
            speed: pos.coords.speed ?? 0,
            heading: pos.coords.heading ?? 0,
            at: pos.timestamp,
            degraded: (pos.coords.accuracy ?? 20) > 40,
          };
          setFix(f);
          recordFix(f);
          watchFence(f);
        },
        () => {
          setFix((prev) => (prev ? { ...prev, degraded: true } : prev));
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
      watchIdRef.current = id;
      return () => {
        if (watchIdRef.current !== null)
          navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      };
    }
    const timer = window.setInterval(() => {
      const f = simStep();
      if (!f) return;
      setFix(f);
      if (!f.degraded) {
        recordFix(f);
        watchFence(f);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    state?.session,
    state?.settings.locationSource,
    simStep,
    recordFix,
    watchFence,
  ]);

  /**
   * Send what was captured offline, once there is a connection again.
   *
   * This used to empty the outbox on a timer and tell the worker
   * "uploaded successfully" — true enough with no backend to upload to, and
   * data loss with a success message once there was one. It now sends the
   * records and clears only what the server accepted; a failure leaves the
   * queue intact so the next reconnection tries again.
   */
  const flushOutbox = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.outbox.length === 0) return;
    const count = s.outbox.length;

    const settle = () => {
      mutate((prev) => ({
        ...prev,
        outbox: [],
        points: prev.points.map((p) => (p.queued ? { ...p, queued: undefined } : p)),
        updates: prev.updates.map((u) =>
          u.status === "queued" ? { ...u, status: "synced" } : u,
        ),
      }));
      pushNotification({
        audience: "employee",
        userId: stateRef.current?.session?.userId,
        kind: "sync",
        title: "Back online",
        body: isLiveBackend
          ? `${count} queued record${count === 1 ? "" : "s"} uploaded.`
          : `${count} queued record${count === 1 ? "" : "s"} synced to this device.`,
        severity: "success",
      });
    };

    if (!isLiveBackend) {
      // Nowhere to send them: the records already live in the only store
      // there is, and the queue was only ever modelling the wait.
      settle();
      return;
    }

    const me = s.users.find((u) => u.id === s.session?.userId);
    const orgId = me?.orgId ?? "";

    persist("upload what was captured offline", async () => {
      // Shifts first: a trail point references its attendance row, so
      // sending points before the shift exists would be rejected.
      const shiftIds = new Set(
        s.outbox
          .filter((o) => o.kind === "attendance" || o.kind === "selfie")
          .map((o) => o.payloadId),
      );
      for (const id of shiftIds) {
        const a = s.attendance.find((x) => x.id === id);
        if (!a?.checkIn) continue;
        await insertCheckIn({
          id: a.id,
          orgId,
          employeeId: a.employeeId,
          projectId: a.projectId,
          date: a.date,
          mark: a.checkIn,
          status: a.status,
        });
        if (a.checkOut) {
          await insertCheckOut(a.id, {
            mark: a.checkOut,
            workedMinutes: a.workedMinutes ?? 0,
            distanceMeters: a.distanceMeters,
            status: a.status,
          });
        }
      }
      const points = s.points.filter((pt) => pt.queued);
      if (points.length) await insertPoints(points, orgId);
      for (const u of s.updates.filter((x) => x.status === "queued")) {
        await insertWorkUpdate(u, orgId);
      }
      settle();
    });
  }, [mutate, pushNotification]);

  useEffect(() => {
    if (!online) return;
    // A moment's grace: a connection that flickers back should not start an
    // upload it is about to lose.
    const t = window.setTimeout(flushOutbox, 1600);
    return () => window.clearTimeout(t);
  }, [online, state?.outbox.length, flushOutbox]);

  /* --------------------------------------------------------- public API */

  const login = useCallback(
    (role: Role, userId?: string) => {
      mutate((s) => {
        const user =
          (userId && s.users.find((u) => u.id === userId)) ||
          s.users.find((u) => u.role === role);
        if (!user) return s;
        return {
          ...s,
          session: { userId: user.id, role, at: Date.now() },
          activeProjectId: user.projectIds[0] ?? null,
        };
      });
      fenceStateRef.current = null;
      lastRecordedRef.current = 0;
      recordingRef.current = false;
      setFix(null);
    },
    [mutate],
  );

  /**
   * Sign in as a backend record. Distinct from `login` because that one can
   * only pick from state it already holds, and a live sign-in resolves the
   * person before their tenant has been fetched. The record is merged in so
   * the very first render has an identity to draw.
   */
  const loginAs = useCallback(
    (user: User) => {
      /* A real person arriving while the demonstration is on leaves it
         first — the reload brings them back through the gate with the
         company's own data underneath. Demo personas sign in here too, and
         stay where they are. */
      if (!isDemoUserId(user.id) && leaveDemoFor("/")) return;
      mutate((s) => ({
        ...s,
        users: s.users.some((u) => u.id === user.id)
          ? s.users.map((u) => (u.id === user.id ? user : u))
          : [...s.users, user],
        session: { userId: user.id, role: user.role, at: Date.now() },
        activeProjectId: user.projectIds[0] ?? null,
      }));
      fenceStateRef.current = null;
      lastRecordedRef.current = 0;
      recordingRef.current = false;
      setFix(null);
    },
    [mutate],
  );

  const logout = useCallback(() => {
    mutate((s) => ({ ...s, session: null }));
    setFix(null);
    // Clearing the local session while the Supabase token lived on would
    // silently sign the next person in as the last one.
    if (isLiveBackend) void authSignOut();
  }, [mutate]);

  const setActiveProject = useCallback(
    (projectId: string) => mutate((s) => ({ ...s, activeProjectId: projectId })),
    [mutate],
  );

  const checkIn = useCallback(
    (
      selfie: string | null,
      /*
       * Computed by the caller, not here: reading a face is asynchronous
       * model inference and this mutation is synchronous. Passing the
       * verdict in keeps the store the single place that *writes* it.
       */
      faceCheck?: { verified: boolean; distance: number },
    ): { ok: boolean; reason?: string } => {
      const s = stateRef.current;
      const f = fixRef.current;
      if (!s?.session || !f) return { ok: false, reason: "Waiting for a GPS fix." };
      const user = s.users.find((u) => u.id === s.session!.userId);
      if (!user) return { ok: false, reason: "No signed-in employee." };
      const pid = s.activeProjectId ?? user.projectIds[0];
      const project = s.projects.find((p) => p.id === pid);
      if (!project) return { ok: false, reason: "No project assigned." };

      const check = checkGeofence(f.coords, project.geofence);
      if (!check.inside) {
        return {
          ok: false,
          reason:
            "You're outside the project site. Please move inside the site boundary to check in.",
        };
      }
      const today = todayISO();
      const dup = s.attendance.find(
        (a) => a.employeeId === user.id && a.date === today && a.checkIn && !a.autoClosed,
      );
      if (dup && !dup.checkOut) return { ok: false, reason: "You're already checked in." };

      const isOffline = !(navigator.onLine && !s.settings.forceOffline);
      const mark: AttendanceMark = {
        at: Date.now(),
        coords: f.coords,
        accuracy: f.accuracy,
        selfie: selfie ?? makeSelfie(user.name, user.avatarHue, "Check-in"),
        place: resolvePlace(f.coords, project.zones, project.location),
        insideGeofence: true,
        syncedAt: isOffline ? undefined : Date.now(),
        faceCheck,
      };
      // Lateness is judged against the person's assigned shift; the project
      // rules stand in only when no shift has ever been configured.
      const shiftDef = shiftFor(s, user.id, today);
      const lateAfter =
        shiftDef && shiftDef.kind !== "flexible"
          ? shiftDef.startMinute + shiftDef.graceMinutes
          : shiftDef?.kind === "flexible"
            ? null
            : project.rules.shiftStart + project.rules.lateGraceMinutes;
      const late =
        lateAfter !== null &&
        mark.at > new Date(`${today}T00:00:00`).getTime() + lateAfter * 60000;

      const att: Attendance = {
        id: uid(),
        employeeId: user.id,
        projectId: project.id,
        date: today,
        checkIn: mark,
        distanceMeters: 0,
        status: late ? "late" : "present",
        events: [],
        breaks: [],
        shiftId: shiftDef?.id,
      };
      lastRecordedRef.current = 0;
      recordingRef.current = false;
      fenceStateRef.current = true;

      mutate((prev) => ({
        ...prev,
        attendance: [...prev.attendance, att],
        outbox: isOffline
          ? [
              ...prev.outbox,
              { id: rid("ob"), at: mark.at, kind: "attendance", label: "Check-in record", payloadId: att.id },
              { id: rid("ob"), at: mark.at, kind: "selfie", label: "Check-in selfie", payloadId: att.id },
            ]
          : prev.outbox,
      }));
      // The shift is real the moment it is recorded here; the row in Postgres
      // is the same record with the same id, not a second one. Offline it
      // waits in the outbox above and the flush below sends it.
      if (!isOffline) {
        persist("record the check-in", () =>
          insertCheckIn({
            id: att.id,
            orgId: user.orgId,
            employeeId: att.employeeId,
            projectId: att.projectId,
            date: att.date,
            mark,
            status: att.status,
            shiftId: shiftDef?.id,
          }),
        );
      }
      pushNotification({
        audience: "manager",
        kind: late ? "late-check-in" : "check-in",
        title: late ? `Late check-in — ${user.name}` : `${user.name} checked in`,
        body: `${project.name} · ${mark.place}`,
        severity: late ? "warning" : "info",
      });
      pushNotification({
        audience: "employee",
        userId: user.id,
        kind: "tracking-started",
        title: "Check-in successful — tracking started",
        body: `${project.name}. Live location is recorded until you check out.`,
        severity: "success",
      });
      return { ok: true };
    },
    [mutate, pushNotification],
  );

  const checkOut = useCallback(
    (
      selfie: string | null,
      extras?: { voiceNote?: Omit<VoiceNote, "at" | "coords" | "place"> },
    ): { ok: boolean; reason?: string } => {
      const s = stateRef.current;
      const f = fixRef.current;
      if (!s?.session || !f) return { ok: false, reason: "Waiting for a GPS fix." };
      const user = s.users.find((u) => u.id === s.session!.userId);
      if (!user) return { ok: false, reason: "No signed-in employee." };
      const today = todayISO();
      const shift = s.attendance.find(
        (a) => a.employeeId === user.id && a.date === today && a.checkIn && !a.checkOut && !a.autoClosed,
      );
      if (!shift) return { ok: false, reason: "No open shift to check out from." };
      const project = s.projects.find((p) => p.id === shift.projectId);
      if (!project) return { ok: false, reason: "Project not found." };

      // Under `outside-only` the trail only exists while the worker is away
      // from a boundary, so a checkout anywhere else would end the record
      // mid-trip with no way to tell a finished day from an abandoned one.
      // Any premise they are assigned to will do — the site they started at
      // is not the only honest place to sign off.
      let closingAt = project;
      if (project.trackingMode === "outside-only") {
        const premises = assignedPremises(s.projects, user);
        const here = premiseAt(f.coords, premises);
        if (!here) {
          const near = nearestPremise(f.coords, premises);
          return {
            ok: false,
            reason: near
              ? `Checkout has to happen at a site or office. The nearest is ${near.premise.name}, ${fmtDistance(near.distance)} away.`
              : "Checkout has to happen at a site or office, and you aren't assigned to one yet. Ask your manager.",
          };
        }
        // Signing off at the office is allowed, so the place has to be named
        // against the premise they are actually standing in — resolving it
        // against the job's zones would label the office "Main Gate".
        closingAt = here;
      }

      const isOffline = !(navigator.onLine && !s.settings.forceOffline);
      const at = Date.now();
      const mark: AttendanceMark = {
        at,
        coords: f.coords,
        accuracy: f.accuracy,
        selfie: selfie ?? makeSelfie(user.name, user.avatarHue, "Checkout"),
        place:
          closingAt.id === project.id
            ? resolvePlace(f.coords, project.zones, project.location)
            : `${closingAt.name} · ${resolvePlace(f.coords, closingAt.zones, closingAt.location)}`,
        insideGeofence: checkGeofence(f.coords, project.geofence).inside,
        syncedAt: isOffline ? undefined : at,
      };
      // A travel session still running at checkout is the end-of-day
      // workflow (spec §5): the day ends, so the run ends with it, measured
      // and queued for review like any other.
      const openTravel = (s.travelSessions ?? []).find(
        (t) => t.employeeId === user.id && t.status === "active",
      );
      let travelSessions = s.travelSessions ?? [];
      if (openTravel) {
        const track = sanitiseTrack(travelPoints(s, openTravel.id));
        travelSessions = travelSessions.map((t) =>
          t.id === openTravel.id
            ? {
                ...t,
                end: {
                  kind: "project" as const,
                  name: resolvePlace(f.coords, project.zones, project.location),
                  coords: f.coords,
                  at,
                  projectId: project.id,
                },
                distanceMeters: Math.round(track.meters),
                flags: track.flags,
                status: "pending" as const,
              }
            : t,
        );
      }

      // A break that was never ended closes itself at checkout — the walk to
      // the gate ends both.
      const closedBreaks: BreakEntry[] = (shift.breaks ?? []).map((b) =>
        b.end ? b : { ...b, end: at, coordsEnd: f.coords },
      );

      // Measure the day against the assigned shift: net working time, and
      // overtime past the configured grace. The record carries the numbers'
      // approval state; the payroll engine prices them later.
      const shiftDef =
        (s.shifts ?? []).find((x) => x.id === shift.shiftId) ??
        shiftFor(s, user.id, today);
      const closed: Attendance = { ...shift, breaks: closedBreaks, checkOut: mark };
      const metrics = shiftDef ? dayMetrics(closed, shiftDef, at) : null;
      const worked = metrics
        ? Math.round(metrics.netMinutes)
        : Math.round((at - shift.checkIn!.at) / 60000);
      const otMinutes = Math.round(metrics?.overtimeMinutes ?? 0);
      const otApproval = shiftDef?.overtime.approval ?? "auto";
      const overtime =
        otMinutes > 0
          ? {
              minutes: otMinutes,
              status: (otApproval === "auto"
                ? "auto-approved"
                : "pending") as OvertimeStatus,
            }
          : undefined;

      const voiceNote: VoiceNote | undefined = extras?.voiceNote
        ? {
            ...extras.voiceNote,
            at,
            coords: f.coords,
            place: mark.place,
          }
        : undefined;

      const early =
        at <
        new Date(`${today}T00:00:00`).getTime() +
          project.rules.shiftEnd * 60000 -
          30 * 60000;
      const status =
        shift.status === "late" ? "late" : early ? "early-checkout" : "present";

      fenceStateRef.current = null;
      mutate((prev) => ({
        ...prev,
        travelSessions: openTravel ? travelSessions : prev.travelSessions,
        attendance: prev.attendance.map((a) =>
          a.id === shift.id
            ? {
                ...a,
                checkOut: mark,
                workedMinutes: worked,
                status,
                breaks: closedBreaks,
                overtime,
                voiceNote,
              }
            : a,
        ),
        outbox: isOffline
          ? [
              ...prev.outbox,
              { id: rid("ob"), at, kind: "attendance", label: "Checkout record", payloadId: shift.id },
              { id: rid("ob"), at, kind: "selfie", label: "Checkout selfie", payloadId: shift.id },
            ]
          : prev.outbox,
      }));
      if (!isOffline && openTravel) {
        const closed = travelSessions.find((t) => t.id === openTravel.id);
        if (closed) {
          persist("close the travel session", () =>
            upsertTravelSession(closed, user.orgId),
          );
        }
      }
      if (!isOffline) {
        persist("record the checkout", () =>
          insertCheckOut(shift.id, {
            mark,
            workedMinutes: worked,
            distanceMeters: shift.distanceMeters,
            status,
            breaks: closedBreaks,
            overtime,
            voiceNote,
          }),
        );
      }
      pushNotification({
        audience: "manager",
        kind: "check-out",
        title: `${user.name} checked out`,
        body: `${project.name} · ${fmtHM(worked)} worked${voiceNote ? " · voice note attached" : ""}`,
        severity: early ? "warning" : "info",
      });
      if (overtime?.status === "pending") {
        pushNotification({
          audience: "manager",
          kind: "check-out",
          title: `Overtime pending approval — ${user.name}`,
          body: `${fmtHM(otMinutes)} past shift end at ${project.name}`,
          severity: "warning",
        });
      }
      return { ok: true };
    },
    [mutate, pushNotification],
  );

  /* ------------------------------------------------------------- breaks */

  const startBreak = useCallback((): { ok: boolean; reason?: string } => {
    const s = stateRef.current;
    const f = fixRef.current;
    if (!s?.session) return { ok: false, reason: "Not signed in." };
    const user = s.users.find((u) => u.id === s.session!.userId);
    if (!user) return { ok: false, reason: "No signed-in employee." };
    const today = todayISO();
    const shift = s.attendance.find(
      (a) => a.employeeId === user.id && a.date === today && a.checkIn && !a.checkOut && !a.autoClosed,
    );
    if (!shift) return { ok: false, reason: "No active shift." };
    const breaks = shift.breaks ?? [];
    if (breaks.some((b) => !b.end)) return { ok: false, reason: "A break is already running." };
    const def = (s.shifts ?? []).find((x) => x.id === shift.shiftId) ?? shiftFor(s, user.id, today);
    if (def && !def.employeeBreaksAllowed) {
      return { ok: false, reason: "Breaks on this shift are started by your manager." };
    }
    if (def && breaks.length >= def.maxBreaksPerShift) {
      return {
        ok: false,
        reason: `This shift allows ${def.maxBreaksPerShift} break${def.maxBreaksPerShift === 1 ? "" : "s"} — you've taken them.`,
      };
    }
    const entry: BreakEntry = {
      id: rid("brk"),
      start: Date.now(),
      coordsStart: f?.coords,
    };
    const nextBreaks = [...breaks, entry];
    mutate((prev) => ({
      ...prev,
      attendance: prev.attendance.map((a) =>
        a.id === shift.id ? { ...a, breaks: nextBreaks } : a,
      ),
    }));
    persist("record the break", () => updateBreaks(shift.id, nextBreaks));
    return { ok: true };
  }, [mutate]);

  const endBreak = useCallback((): { ok: boolean; reason?: string } => {
    const s = stateRef.current;
    const f = fixRef.current;
    if (!s?.session) return { ok: false, reason: "Not signed in." };
    const user = s.users.find((u) => u.id === s.session!.userId);
    if (!user) return { ok: false, reason: "No signed-in employee." };
    const today = todayISO();
    const shift = s.attendance.find(
      (a) => a.employeeId === user.id && a.date === today && a.checkIn && !a.checkOut && !a.autoClosed,
    );
    const open = shift?.breaks?.find((b) => !b.end);
    if (!shift || !open) return { ok: false, reason: "No break is running." };
    const at = Date.now();
    const nextBreaks = (shift.breaks ?? []).map((b) =>
      b.id === open.id ? { ...b, end: at, coordsEnd: f?.coords } : b,
    );
    mutate((prev) => ({
      ...prev,
      attendance: prev.attendance.map((a) =>
        a.id === shift.id ? { ...a, breaks: nextBreaks } : a,
      ),
    }));
    persist("record the end of the break", () =>
      updateBreaks(shift.id, nextBreaks),
    );
    return { ok: true };
  }, [mutate]);

  /* ------------------------------------------- shift → payroll pipeline */

  /** One audit line for a sensitive action. Appended, never rewritten. */
  const auditLine = (
    s: WorkforceState,
    action: string,
    target: string,
    detail: string,
  ) => ({
    id: rid("aud"),
    at: Date.now(),
    actorId: s.session?.userId ?? "system",
    action,
    target,
    detail,
  });

  const saveShift = useCallback(
    (patch: Partial<ShiftDef> & { name: string }, id?: string): ShiftDef => {
      let saved: ShiftDef | null = null;
      mutate((s) => {
        if (id) {
          const shifts = (s.shifts ?? []).map((x) => {
            if (x.id !== id) return x;
            saved = { ...x, ...patch, id };
            return saved;
          });
          return {
            ...s,
            shifts,
            audit: [
              auditLine(s, "shift.update", id, `${patch.name} modified`),
              ...s.audit,
            ].slice(0, 200),
          };
        }
        const created: ShiftDef = {
          id: uid(),
          orgId: patch.orgId ?? currentOrgId(s),
          name: patch.name,
          code: patch.code ?? `SH-${((s.shifts ?? []).length + 1).toString().padStart(2, "0")}`,
          kind: patch.kind ?? "fixed",
          startMinute: patch.startMinute ?? 8 * 60 + 30,
          endMinute: patch.endMinute ?? 17 * 60 + 30,
          requiredMinutes: patch.requiredMinutes ?? 8 * 60,
          graceMinutes: patch.graceMinutes ?? 15,
          breakRules: patch.breakRules ?? [
            { id: rid("brl"), name: "Lunch", startMinute: 13 * 60, endMinute: 13 * 60 + 45, durationMinutes: 45, paid: false },
          ],
          maxBreaksPerShift: patch.maxBreaksPerShift ?? 3,
          minBreakMinutes: patch.minBreakMinutes ?? 5,
          maxBreakMinutes: patch.maxBreakMinutes ?? 90,
          employeeBreaksAllowed: patch.employeeBreaksAllowed ?? true,
          breakApprovalRequired: patch.breakApprovalRequired ?? false,
          overtime: patch.overtime ?? { ...DEFAULT_OVERTIME },
          workingDays: patch.workingDays ?? [1, 2, 3, 4, 5, 6],
          projectIds: patch.projectIds ?? [],
          status: patch.status ?? "active",
          createdAt: Date.now(),
        };
        saved = created;
        return {
          ...s,
          shifts: [...(s.shifts ?? []), created],
          audit: [
            auditLine(s, "shift.create", created.id, created.name),
            ...s.audit,
          ].slice(0, 200),
        };
      });
      const shift = saved!;
      persist("save the shift", () => upsertShift(shift));
      showToast(id ? `${shift.name} updated` : `${shift.name} created`);
      return shift;
    },
    [mutate],
  );

  const archiveShift = useCallback(
    (shiftId: string) => {
      mutate((s) => ({
        ...s,
        shifts: (s.shifts ?? []).map((x) =>
          x.id === shiftId ? { ...x, status: "archived" } : x,
        ),
        audit: [
          auditLine(s, "shift.archive", shiftId, ""),
          ...s.audit,
        ].slice(0, 200),
      }));
      const archived = stateRef.current?.shifts.find((x) => x.id === shiftId);
      if (archived) {
        persist("archive the shift", () => upsertShift(archived));
        showToast(`${archived.name} deleted`, "danger");
      }
    },
    [mutate],
  );

  const assignShift = useCallback(
    (employeeIds: string[], shiftId: string, effectiveFrom: string) => {
      let written: ShiftAssignment[] = [];
      let orgId = "";
      mutate((s) => {
        const name = (s.shifts ?? []).find((x) => x.id === shiftId)?.name ?? shiftId;
        const rows: ShiftAssignment[] = employeeIds.map((employeeId) => ({
          id: rid("sha"),
          employeeId,
          shiftId,
          effectiveFrom,
          assignedBy: s.session?.userId ?? "system",
          at: Date.now(),
        }));
        written = rows;
        orgId = currentOrgId(s);
        return {
          ...s,
          shiftAssignments: [...(s.shiftAssignments ?? []), ...rows],
          audit: [
            auditLine(
              s,
              "shift.assign",
              shiftId,
              `${name} → ${employeeIds.length} people, effective ${effectiveFrom}`,
            ),
            ...s.audit,
          ].slice(0, 200),
        };
      });
      persist("assign the shift", () => insertShiftAssignments(written, orgId));
      showToast(
        `Shift assigned to ${employeeIds.length} ${employeeIds.length === 1 ? "person" : "people"}`,
      );
    },
    [mutate],
  );

  const saveComp = useCallback(
    (rec: Omit<CompRecord, "id" | "setBy" | "at">): { ok: boolean; reason?: string } => {
      const st = stateRef.current;
      if (!st) return { ok: false, reason: "Not ready." };
      // Salary history is append-only: a change is a new revision on its own
      // effective date, and the payroll engine reads whichever was in force.
      const prev = (st.comp ?? [])
        .filter((c) => c.employeeId === rec.employeeId)
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
        .pop();
      const record: CompRecord = {
        ...rec,
        id: rid("cmp"),
        setBy: st.session?.userId ?? "system",
        at: Date.now(),
      };
      mutate((s) => ({
        ...s,
        comp: [...(s.comp ?? []), record],
        audit: [
          auditLine(
            s,
            prev ? "salary.update" : "salary.create",
            rec.employeeId,
            `${prev ? `₹${prev.amount}/${prev.type} → ` : ""}₹${rec.amount}/${rec.type}, effective ${rec.effectiveFrom}${rec.note ? ` — ${rec.note}` : ""}`,
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      persist("save the salary revision", () =>
        insertComp(record, currentOrgId(st)),
      );
      showToast("Salary saved");
      return { ok: true };
    },
    [mutate],
  );

  const updatePayPolicy = useCallback(
    (patch: Partial<PayPolicy>) => {
      mutate((s) => ({
        ...s,
        payPolicy: { ...(s.payPolicy ?? DEFAULT_PAY_POLICY), ...patch },
        audit: [
          auditLine(s, "paypolicy.update", "org", Object.keys(patch).join(", ")),
          ...s.audit,
        ].slice(0, 200),
      }));
      const st = stateRef.current;
      if (st) {
        persist("save the pay policy", () =>
          upsertPayPolicy(st.payPolicy, currentOrgId(st)),
        );
      }
    },
    [mutate],
  );

  /**
   * Decide many overtime records at once.
   *
   * A month of a large crew is dozens of near-identical rows, and deciding
   * them one at a time is not review — it is data entry. One pass, one
   * audit line naming the count, and one notification per worker, because
   * each of them is still owed the news about their own pay.
   *
   * Each record keeps the minutes it was raised with. There is no bulk
   * edit: changing an amount is a per-person judgement, and doing it to
   * forty people at once is exactly the mistake this should not make easy.
   */
  const decideOvertimeMany = useCallback(
    (
      attendanceIds: string[],
      decision: Extract<OvertimeStatus, "approved" | "rejected">,
    ) => {
      const st = stateRef.current;
      if (!st || attendanceIds.length === 0) return;
      const ids = new Set(attendanceIds);
      const affected = st.attendance.filter((a) => ids.has(a.id) && a.overtime);
      if (affected.length === 0) return;

      mutate((s) => ({
        ...s,
        attendance: s.attendance.map((a) =>
          ids.has(a.id) && a.overtime
            ? {
                ...a,
                overtime: {
                  ...a.overtime,
                  status: decision,
                  approvedMinutes: decision === "approved" ? a.overtime.minutes : 0,
                  decidedBy: s.session?.userId,
                  decidedAt: Date.now(),
                },
              }
            : a,
        ),
        audit: [
          auditLine(
            s,
            decision === "approved" ? "overtime.approve.bulk" : "overtime.reject.bulk",
            `${affected.length} records`,
            affected
              .map((a) => `${a.employeeId}:${a.date}:${a.overtime!.minutes}m`)
              .join(", ")
              .slice(0, 400),
          ),
          ...s.audit,
        ].slice(0, 200),
      }));

      for (const a of affected) {
        const decided = stateRef.current?.attendance.find((x) => x.id === a.id);
        if (decided) {
          persist("record the overtime decision", () =>
            updateOvertime(a.id, decided.overtime),
          );
        }
        const worker = st.users.find((u) => u.id === a.employeeId);
        if (worker) {
          pushNotification({
            audience: "employee",
            userId: worker.id,
            kind: "check-out",
            title: decision === "approved" ? "Overtime approved" : "Overtime not approved",
            body: `${fmtHM(a.overtime!.minutes)} on ${a.date}`,
            severity: decision === "approved" ? "success" : "warning",
          });
        }
      }

      showToast(
        `${affected.length} overtime ${affected.length === 1 ? "record" : "records"} ${decision}`,
        decision === "approved" ? "success" : "danger",
      );
    },
    [mutate, pushNotification],
  );

  const decideOvertime = useCallback(
    (
      attendanceId: string,
      decision: Extract<OvertimeStatus, "approved" | "rejected">,
      approvedMinutes?: number,
      note?: string,
    ) => {
      const st = stateRef.current;
      const att = st?.attendance.find((a) => a.id === attendanceId);
      if (!att?.overtime) return;
      const worker = st?.users.find((u) => u.id === att.employeeId);
      mutate((s) => ({
        ...s,
        attendance: s.attendance.map((a) =>
          a.id === attendanceId && a.overtime
            ? {
                ...a,
                overtime: {
                  ...a.overtime,
                  status: decision,
                  approvedMinutes:
                    decision === "approved"
                      ? Math.round(approvedMinutes ?? a.overtime.minutes)
                      : 0,
                  decidedBy: s.session?.userId,
                  decidedAt: Date.now(),
                  note,
                },
              }
            : a,
        ),
        audit: [
          auditLine(
            s,
            `overtime.${decision}`,
            attendanceId,
            `${worker?.name ?? att.employeeId} · ${fmtHM(att.overtime!.minutes)}${
              decision === "approved" && approvedMinutes != null && Math.round(approvedMinutes) !== att.overtime!.minutes
                ? ` → ${fmtHM(approvedMinutes)}`
                : ""
            }${note ? ` — ${note}` : ""}`,
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      const decided = stateRef.current?.attendance.find((a) => a.id === attendanceId);
      if (decided) {
        persist("record the overtime decision", () =>
          updateOvertime(attendanceId, decided.overtime),
        );
      }
      if (worker) {
        pushNotification({
          audience: "employee",
          userId: worker.id,
          kind: "check-out",
          title: decision === "approved" ? "Overtime approved" : "Overtime not approved",
          body: `${fmtHM(approvedMinutes ?? att.overtime.minutes)} on ${att.date}${note ? ` — ${note}` : ""}`,
          severity: decision === "approved" ? "success" : "warning",
        });
      }
      showToast(
        decision === "approved" ? "Overtime approved" : "Overtime rejected",
        decision === "approved" ? "success" : "danger",
      );
    },
    [mutate, pushNotification],
  );

  const logAudit = useCallback(
    (action: string, target: string, detail?: string) => {
      mutate((s) => ({
        ...s,
        audit: [auditLine(s, action, target, detail ?? ""), ...s.audit].slice(0, 200),
      }));
    },
    // auditLine is a plain helper defined above; it never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutate],
  );

  const setPayrollStatus = useCallback(
    (month: string, status: PayrollStatus) => {
      mutate((s) => {
        const orgId = currentOrgId(s);
        const existing = (s.payrollRuns ?? []).find(
          (r) => r.month === month && r.orgId === orgId,
        );
        const now = Date.now();
        const run: PayrollRun = existing
          ? {
              ...existing,
              status,
              approvedBy:
                status === "approved" ? s.session?.userId : existing.approvedBy,
              approvedAt: status === "approved" ? now : existing.approvedAt,
              lockedAt: status === "locked" ? now : existing.lockedAt,
            }
          : {
              id: rid("prl"),
              orgId,
              month,
              status,
              adjustments: [],
              approvedBy: status === "approved" ? s.session?.userId : undefined,
              approvedAt: status === "approved" ? now : undefined,
              lockedAt: status === "locked" ? now : undefined,
            };
        return {
          ...s,
          payrollRuns: existing
            ? (s.payrollRuns ?? []).map((r) => (r.id === existing.id ? run : r))
            : [...(s.payrollRuns ?? []), run],
          audit: [
            auditLine(s, `payroll.${status}`, month, ""),
            ...s.audit,
          ].slice(0, 200),
        };
      });
      const saved = (stateRef.current?.payrollRuns ?? []).find(
        (r) => r.month === month,
      );
      if (saved) persist("save the payroll run", () => upsertPayrollRun(saved));
      showToast(`Payroll ${status}`);
    },
    [mutate],
  );

  const addPayrollAdjustment = useCallback(
    (month: string, employeeId: string, amount: number, note: string) => {
      mutate((s) => {
        const orgId = currentOrgId(s);
        let run = (s.payrollRuns ?? []).find(
          (r) => r.month === month && r.orgId === orgId,
        );
        const adjustment = {
          id: rid("adj"),
          employeeId,
          amount,
          note,
          by: s.session?.userId ?? "system",
          at: Date.now(),
        };
        // A locked month is never silently corrected — the adjustment IS the
        // correction record, on the run, in the audit trail (spec §18).
        if (!run) {
          run = { id: rid("prl"), orgId, month, status: "draft", adjustments: [] };
        }
        const next = { ...run, adjustments: [...run.adjustments, adjustment] };
        const worker = s.users.find((u) => u.id === employeeId);
        return {
          ...s,
          payrollRuns: (s.payrollRuns ?? []).some((r) => r.id === next.id)
            ? (s.payrollRuns ?? []).map((r) => (r.id === next.id ? next : r))
            : [...(s.payrollRuns ?? []), next],
          audit: [
            auditLine(
              s,
              "payroll.adjust",
              month,
              `${worker?.name ?? employeeId}: ${amount >= 0 ? "+" : ""}₹${amount} — ${note}${monthLocked(s, month) ? " (after lock)" : ""}`,
            ),
            ...s.audit,
          ].slice(0, 200),
        };
      });
    },
    [mutate],
  );

  /* ----------------------------------------------------- travel sessions */

  const startTravel = useCallback(
    (
      purpose: TravelPurpose,
      note?: string,
      selfie?: string,
    ): { ok: boolean; reason?: string } => {
      const s = stateRef.current;
      const f = fixRef.current;
      if (!s?.session || !f) return { ok: false, reason: "Waiting for a GPS fix." };
      const user = s.users.find((u) => u.id === s.session!.userId);
      if (!user) return { ok: false, reason: "No signed-in employee." };
      if ((s.travelSessions ?? []).some((t) => t.employeeId === user.id && t.status === "active")) {
        return { ok: false, reason: "A travel session is already running." };
      }
      const pid = s.activeProjectId ?? user.projectIds[0];
      const project = s.projects.find((p) => p.id === pid);
      if (!project) return { ok: false, reason: "No project assigned." };
      if (!project.travelTracking) {
        return {
          ok: false,
          reason: "Travel tracking isn't enabled on this project. Ask your manager.",
        };
      }
      const today = todayISO();
      const shift = s.attendance.find(
        (a) => a.employeeId === user.id && a.date === today && a.checkIn && !a.checkOut && !a.autoClosed,
      );

      // Where the run starts is recorded as a named place, not just a fix:
      // at a premise the anchor is that premise, anywhere else it is the
      // worker's own position (spec §2, §3).
      const at = premiseAt(f.coords, assignedPremises(s.projects, user));
      const session: TravelSession = {
        id: uid(),
        employeeId: user.id,
        projectId: project.id,
        attendanceId: shift?.id,
        date: today,
        start: {
          kind: at ? (at.kind === "office" ? "office" : "project") : "custom",
          name: at ? at.name : resolvePlace(f.coords, project.zones, project.location),
          address: at?.address || undefined,
          coords: f.coords,
          at: Date.now(),
          projectId: at?.id,
        },
        purpose,
        note: note?.trim() || undefined,
        vehicleType: vehicleOf(user),
        distanceMeters: 0,
        flags: [],
        status: "active",
        selfie,
      };
      persist("start the travel session", () =>
        upsertTravelSession(session, user.orgId),
      );
      mutate((prev) => ({
        ...prev,
        travelSessions: [...(prev.travelSessions ?? []), session],
        audit: [
          auditLine(prev, "travel.start", session.id, `${user.name} · ${purpose} from ${session.start.name}`),
          ...prev.audit,
        ].slice(0, 200),
      }));
      pushNotification({
        audience: "manager",
        kind: "geofence-exit",
        title: `${user.name} started work travel`,
        body: `${purpose} · from ${session.start.name}`,
        severity: "info",
      });
      return { ok: true };
    },
    [mutate, pushNotification],
  );

  const endTravel = useCallback((): { ok: boolean; reason?: string } => {
    const s = stateRef.current;
    const f = fixRef.current;
    if (!s?.session || !f) return { ok: false, reason: "Waiting for a GPS fix." };
    const user = s.users.find((u) => u.id === s.session!.userId);
    if (!user) return { ok: false, reason: "No signed-in employee." };
    const session = (s.travelSessions ?? []).find(
      (t) => t.employeeId === user.id && t.status === "active",
    );
    if (!session) return { ok: false, reason: "No travel session is running." };

    // Measure the run now, through the sanitiser: drift, jumps and gaps are
    // scored out here, once, and the flags kept for the reviewer (spec §8).
    const track = sanitiseTrack(travelPoints(s, session.id));
    const at = premiseAt(f.coords, assignedPremises(s.projects, user));
    const project = s.projects.find((p) => p.id === session.projectId);
    const ended: TravelSession = {
      ...session,
      end: {
        kind: at ? (at.kind === "office" ? "office" : "project") : "custom",
        name: at
          ? at.name
          : project
            ? resolvePlace(f.coords, project.zones, project.location)
            : "Journey end",
        address: at?.address || undefined,
        coords: f.coords,
        at: Date.now(),
        projectId: at?.id,
      },
      distanceMeters: Math.round(track.meters),
      flags: track.flags,
      status: "pending",
    };
    persist("save the travel session", () =>
      upsertTravelSession(ended, user.orgId),
    );
    mutate((prev) => ({
      ...prev,
      travelSessions: (prev.travelSessions ?? []).map((t) =>
        t.id === session.id ? ended : t,
      ),
      audit: [
        auditLine(
          prev,
          "travel.end",
          session.id,
          `${user.name} · ${fmtKmLabel(track.meters)}${track.flags.length ? ` · ${track.flags.length} flag${track.flags.length === 1 ? "" : "s"}` : ""}`,
        ),
        ...prev.audit,
      ].slice(0, 200),
    }));
    pushNotification({
      audience: "manager",
      kind: "geofence-exit",
      title: `${user.name} ended work travel`,
      body: `${fmtKmLabel(track.meters)} · ${session.purpose} · awaiting review`,
      severity: track.flags.length ? "warning" : "info",
    });
    return { ok: true };
  }, [mutate, pushNotification]);

  const decideTravel = useCallback(
    (
      sessionId: string,
      decision: "approved" | "rejected",
      approvedKm?: number,
      note?: string,
    ) => {
      const st = stateRef.current;
      const session = (st?.travelSessions ?? []).find((t) => t.id === sessionId);
      if (!session) return;
      const worker = st?.users.find((u) => u.id === session.employeeId);
      mutate((s) => ({
        ...s,
        travelSessions: (s.travelSessions ?? []).map((t) =>
          t.id === sessionId
            ? {
                ...t,
                status: decision,
                approvedMeters:
                  decision === "approved" && approvedKm != null
                    ? Math.round(approvedKm * 1000)
                    : t.approvedMeters,
                decidedBy: s.session?.userId,
                decidedAt: Date.now(),
                decisionNote: note,
              }
            : t,
        ),
        audit: [
          auditLine(
            s,
            `travel.${decision}`,
            sessionId,
            `${worker?.name ?? session.employeeId} · ${fmtKmLabel(session.distanceMeters)}${
              decision === "approved" && approvedKm != null
                ? ` → ${approvedKm.toFixed(1)} km`
                : ""
            }${note ? ` — ${note}` : ""}`,
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      const settled = stateRef.current?.travelSessions.find(
        (t) => t.id === sessionId,
      );
      if (settled && worker) {
        persist("record the travel decision", () =>
          upsertTravelSession(settled, worker.orgId),
        );
      }
      if (worker) {
        pushNotification({
          audience: "employee",
          userId: worker.id,
          kind: "check-out",
          title: decision === "approved" ? "Travel approved" : "Travel not approved",
          body: `${session.date} · ${session.purpose}${note ? ` — ${note}` : ""}`,
          severity: decision === "approved" ? "success" : "warning",
        });
      }
      showToast(
        decision === "approved" ? "Travel approved" : "Travel rejected",
        decision === "approved" ? "success" : "danger",
      );
    },
    [mutate, pushNotification],
  );

  /* ------------------------------------------------------ allowance rules */

  const savePetrolRule = useCallback(
    (patch: Partial<PetrolRule> & { name: string }, id?: string) => {
      mutate((s) => {
        if (id) {
          return {
            ...s,
            petrolRules: (s.petrolRules ?? []).map((r) =>
              r.id === id ? { ...r, ...patch, id } : r,
            ),
            audit: [
              auditLine(s, "allowance.petrol.update", id, patch.name),
              ...s.audit,
            ].slice(0, 200),
          };
        }
        const created: PetrolRule = {
          id: uid(),
          orgId: currentOrgId(s),
          name: patch.name,
          vehicleType: patch.vehicleType ?? "two-wheeler",
          ratePerKm: patch.ratePerKm ?? 5,
          maxDailyKm: patch.maxDailyKm ?? null,
          maxDailyAmount: patch.maxDailyAmount ?? null,
          approval: patch.approval ?? "manager",
          projectIds: patch.projectIds ?? [],
          employeeIds: patch.employeeIds ?? [],
          effectiveFrom: patch.effectiveFrom ?? todayISO(),
          status: "active",
          createdAt: Date.now(),
        };
        return {
          ...s,
          petrolRules: [...(s.petrolRules ?? []), created],
          audit: [
            auditLine(
              s,
              "allowance.petrol.create",
              created.id,
              `${created.name} · ₹${created.ratePerKm}/km`,
            ),
            ...s.audit,
          ].slice(0, 200),
        };
      });
      const saved = (stateRef.current?.petrolRules ?? []).find(
        (r) => r.id === id || r.name === patch.name,
      );
      if (saved) persist("save the petrol rule", () => upsertPetrolRule(saved));
    },
    [mutate],
  );

  const saveFoodRule = useCallback(
    (patch: Partial<FoodRule> & { name: string }, id?: string) => {
      mutate((s) => {
        if (id) {
          return {
            ...s,
            foodRules: (s.foodRules ?? []).map((r) =>
              r.id === id ? { ...r, ...patch, id } : r,
            ),
            audit: [
              auditLine(s, "allowance.food.update", id, patch.name),
              ...s.audit,
            ].slice(0, 200),
          };
        }
        const created: FoodRule = {
          id: uid(),
          orgId: currentOrgId(s),
          name: patch.name,
          meal: patch.meal ?? "Breakfast",
          startMinute: patch.startMinute ?? 6 * 60 + 30,
          endMinute: patch.endMinute ?? 7 * 60,
          trigger: patch.trigger ?? "check-in",
          amount: patch.amount ?? 100,
          projectIds: patch.projectIds ?? [],
          employeeIds: patch.employeeIds ?? [],
          shiftIds: patch.shiftIds ?? [],
          approval: patch.approval ?? "auto",
          effectiveFrom: patch.effectiveFrom ?? todayISO(),
          status: "active",
          createdAt: Date.now(),
        };
        return {
          ...s,
          foodRules: [...(s.foodRules ?? []), created],
          audit: [
            auditLine(
              s,
              "allowance.food.create",
              created.id,
              `${created.name} · ₹${created.amount}`,
            ),
            ...s.audit,
          ].slice(0, 200),
        };
      });
      const saved = (stateRef.current?.foodRules ?? []).find(
        (r) => r.id === id || r.name === patch.name,
      );
      if (saved) persist("save the food rule", () => upsertFoodRule(saved));
    },
    [mutate],
  );

  const archiveAllowanceRule = useCallback(
    (kind: "petrol" | "food", id: string) => {
      mutate((s) => ({
        ...s,
        petrolRules:
          kind === "petrol"
            ? (s.petrolRules ?? []).map((r) =>
                r.id === id ? { ...r, status: "archived" } : r,
              )
            : s.petrolRules,
        foodRules:
          kind === "food"
            ? (s.foodRules ?? []).map((r) =>
                r.id === id ? { ...r, status: "archived" } : r,
              )
            : s.foodRules,
        audit: [
          auditLine(s, `allowance.${kind}.archive`, id, ""),
          ...s.audit,
        ].slice(0, 200),
      }));
      const st = stateRef.current;
      if (kind === "petrol") {
        const r = st?.petrolRules.find((x) => x.id === id);
        if (r) persist("archive the petrol rule", () => upsertPetrolRule(r));
      } else {
        const r = st?.foodRules.find((x) => x.id === id);
        if (r) persist("archive the food rule", () => upsertFoodRule(r));
      }
    },
    [mutate],
  );

  const decideFoodAllowance = useCallback(
    (
      employeeId: string,
      date: string,
      ruleId: string,
      status: "approved" | "rejected",
      note?: string,
    ) => {
      mutate((s) => {
        const worker = s.users.find((u) => u.id === employeeId);
        const rule = (s.foodRules ?? []).find((r) => r.id === ruleId);
        return {
          ...s,
          allowanceDecisions: [
            ...(s.allowanceDecisions ?? []),
            {
              id: rid("alw"),
              employeeId,
              date,
              ruleId,
              status,
              by: s.session?.userId ?? "system",
              at: Date.now(),
              note,
            },
          ],
          audit: [
            auditLine(
              s,
              `allowance.food.${status}`,
              ruleId,
              `${worker?.name ?? employeeId} · ${rule?.name ?? ruleId} · ${date}`,
            ),
            ...s.audit,
          ].slice(0, 200),
        };
      });
      const st = stateRef.current;
      const written = (st?.allowanceDecisions ?? [])[
        (st?.allowanceDecisions ?? []).length - 1
      ];
      if (st && written) {
        persist("record the allowance decision", () =>
          insertAllowanceDecision(written, currentOrgId(st)),
        );
      }
    },
    [mutate],
  );

  const saveVehicle = useCallback(
    (employeeId: string, vehicle: Vehicle | null) => {
      mutate((s) => {
        const worker = s.users.find((u) => u.id === employeeId);
        return {
          ...s,
          users: s.users.map((u) =>
            u.id === employeeId ? { ...u, vehicle: vehicle ?? undefined } : u,
          ),
          audit: [
            auditLine(
              s,
              "vehicle.update",
              employeeId,
              `${worker?.name ?? employeeId} · ${vehicle ? `${vehicle.type} (${vehicle.ownership})` : "removed"}`,
            ),
            ...s.audit,
          ].slice(0, 200),
        };
      });
      const person = stateRef.current?.users.find((u) => u.id === employeeId);
      if (person) persist("save the vehicle", () => upsertUser(person, person.orgId));
    },
    [mutate],
  );

  const setProjectTravelTracking = useCallback(
    (projectId: string, on: boolean) => {
      mutate((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === projectId ? { ...p, travelTracking: on } : p,
        ),
        audit: [
          auditLine(s, "travel.tracking", projectId, on ? "enabled" : "disabled"),
          ...s.audit,
        ].slice(0, 200),
      }));
      const project = stateRef.current?.projects.find((p) => p.id === projectId);
      if (project) {
        persist("save the travel policy", () => upsertProject(project));
      }
    },
    [mutate],
  );

  const submitWorkUpdate = useCallback(
    (u: Partial<WorkUpdate> & { description: string }) => {
      const s = stateRef.current;
      if (!s?.session) return;
      const user = s.users.find((x) => x.id === s.session!.userId);
      if (!user) return;
      const pid = u.projectId ?? s.activeProjectId ?? user.projectIds[0];
      const project = s.projects.find((p) => p.id === pid);
      const f = fixRef.current;
      const isOffline = !(navigator.onLine && !s.settings.forceOffline);
      const today = todayISO();
      const shift = s.attendance.find(
        (a) => a.employeeId === user.id && a.date === today && a.checkIn,
      );
      const update: WorkUpdate = {
        id: uid(),
        employeeId: user.id,
        projectId: pid ?? "",
        attendanceId: shift?.id,
        date: today,
        at: Date.now(),
        category: u.category ?? "Other",
        kind: u.kind ?? "shift",
        description: u.description,
        completed: u.completed,
        inProgress: u.inProgress,
        blockers: u.blockers,
        materials: u.materials,
        safety: u.safety,
        tomorrow: u.tomorrow,
        photos: u.photos ?? [],
        voiceNoteSeconds: u.voiceNoteSeconds,
        coords: f?.coords,
        place:
          f && project ? resolvePlace(f.coords, project.zones, project.location) : undefined,
        status: isOffline ? "queued" : "synced",
      };
      mutate((prev) => ({
        ...prev,
        updates: [update, ...prev.updates],
        outbox: isOffline
          ? [
              ...prev.outbox,
              { id: rid("ob"), at: update.at, kind: "work-update", label: "Work update", payloadId: update.id },
            ]
          : prev.outbox,
      }));
      if (!isOffline) {
        persist("save the work update", () => insertWorkUpdate(update, user.orgId));
      }
      pushNotification({
        audience: "manager",
        kind: "work-update",
        title: `Work update — ${user.name}`,
        body: update.description.slice(0, 80),
        severity: "info",
      });
    },
    [mutate, pushNotification],
  );

  /**
   * Push a project's roster after it changes.
   *
   * Assign and remove both come down to the same fact — this is who is on
   * this project now — so both send the whole set rather than a delta. Read
   * from the ref after the mutation so the membership sent is the one that
   * actually landed, not the one the caller intended.
   */
  const syncRoster = useCallback((projectId: string) => {
    const s = stateRef.current;
    const project = s?.projects.find((p) => p.id === projectId);
    if (!project) return;
    persist("update who is on the project", () =>
      replaceProjectMembers(projectId, project.employeeIds, project.orgId),
    );
  }, []);

  const setUserRole = useCallback(
    (userId: string, role: Role) => {
      mutate((s) => {
        const target = s.users.find((u) => u.id === userId);
        // The platform owner cannot be demoted — somebody has to hold the
        // keys, and there is no seeded row to fall back on any more. Stated
        // against the role rather than an id, because the id belongs to
        // whichever real person was seated by the bootstrap.
        if (!target || target.role === "superadmin") return s;
        const actor = s.session?.userId ?? "system";
        return {
          ...s,
          users: s.users.map((u) => (u.id === userId ? { ...u, role } : u)),
          audit: [
            {
              id: rid("aud"),
              at: Date.now(),
              actorId: actor,
              action: "role-change",
              target: userId,
              detail: `${target.name} → ${role}`,
            },
            ...s.audit,
          ].slice(0, 200),
        };
      });
      const s = stateRef.current;
      const target = s?.users.find((u) => u.id === userId);
      if (target && target.role !== "superadmin") {
        persist("change the role", () =>
          upsertUser({ ...target, role }, target.orgId),
        );
      }
    },
    [mutate],
  );

  /**
   * Mark a group of people present, from a supervisor's photo.
   *
   * Not a check-in. There is no selfie of their own and no GPS fix from
   * their phone, so the record says who marked it and how — a day recorded
   * this way must never be mistaken for one somebody walked through a gate
   * for themselves.
   *
   * Anyone already marked today is skipped rather than overwritten: the
   * supervisor photographing a crew does not know who has already checked
   * in, and a second pass must not move the first one's time.
   */
  const markPresentFromPhoto = useCallback(
    (employeeIds: string[], projectId: string) => {
      const st = stateRef.current;
      if (!st || employeeIds.length === 0) return { marked: 0, skipped: 0 };
      const today = todayISO();
      const already = new Set(
        st.attendance.filter((a) => a.date === today).map((a) => a.employeeId),
      );
      const fresh = employeeIds.filter((id) => !already.has(id));
      const project = st.projects.find((p) => p.id === projectId);
      const at = Date.now();
      const by = st.session?.userId ?? "system";

      if (fresh.length) {
        mutate((s) => {
          const rows: Attendance[] = fresh.map((employeeId) => {
            const u = s.users.find((x) => x.id === employeeId);
            return {
              id: rid("att"),
              employeeId,
              projectId,
              date: today,
              checkIn: {
                at,
                coords: project?.location ?? { lat: 0, lng: 0 },
                accuracy: 0,
                selfie: makeSelfie(u?.name ?? "?", u?.avatarHue ?? 0, "Group photo"),
                place: project?.name ?? "Site",
                insideGeofence: true,
                syncedAt: at,
              },
              distanceMeters: 0,
              status: "present",
              events: [],
              markedBy: { userId: by, method: "group-photo", at },
            };
          });
          return {
            ...s,
            attendance: [...rows, ...s.attendance],
            audit: [
              auditLine(
                s,
                "attendance.group-photo",
                `${rows.length} people`,
                rows
                  .map((r) => s.users.find((u) => u.id === r.employeeId)?.name ?? r.employeeId)
                  .join(", ")
                  .slice(0, 400),
              ),
              ...s.audit,
            ].slice(0, 200),
          };
        });
      }

      const skipped = employeeIds.length - fresh.length;
      showToast(
        skipped
          ? `${fresh.length} marked present · ${skipped} already in`
          : `${fresh.length} marked present`,
      );
      return { marked: fresh.length, skipped };
    },
    [mutate],
  );

  /* ------------------------------------------------------ labour teams */

  /**
   * Create or amend a gang.
   *
   * Teams are amended, never replaced: the code stays put once issued
   * because it is painted on a board and read aloud, and the members live
   * in their own dated rows so editing a team never disturbs its history.
   */
  const saveTeam = useCallback(
    (patch: Partial<LabourTeam> & { name: string; projectId: string }, id?: string) => {
      const st = stateRef.current!;
      const now = Date.now();
      const orgId = st.users.find((u) => u.id === st.session?.userId)?.orgId ?? "";
      const existing = id ? st.labourTeams.find((t) => t.id === id) : undefined;

      const team: LabourTeam = {
        id: existing?.id ?? rid("team"),
        orgId: existing?.orgId ?? orgId,
        projectId: patch.projectId,
        name: patch.name.trim(),
        type: (patch.type ?? existing?.type ?? "General Labour").trim(),
        code: existing?.code ?? patch.code ?? nextTeamCode(st, patch.projectId),
        leaderId: patch.leaderId ?? existing?.leaderId,
        siteEngineerId: patch.siteEngineerId ?? existing?.siteEngineerId,
        supervisorId: patch.supervisorId ?? existing?.supervisorId,
        description: patch.description ?? existing?.description,
        status: patch.status ?? existing?.status ?? "active",
        startDate: patch.startDate ?? existing?.startDate,
        endDate: patch.endDate ?? existing?.endDate,
        workZoneId: patch.workZoneId ?? existing?.workZoneId,
        shiftId: patch.shiftId ?? existing?.shiftId,
        notes: patch.notes ?? existing?.notes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      mutate((s) => ({
        ...s,
        labourTeams: existing
          ? s.labourTeams.map((t) => (t.id === team.id ? team : t))
          : [team, ...s.labourTeams],
        audit: [
          auditLine(
            s,
            existing ? "team.update" : "team.create",
            team.name,
            `${team.type} · ${s.projects.find((p) => p.id === team.projectId)?.name ?? team.projectId}`,
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      persist(existing ? "save the team" : "create the team", () =>
        upsertLabourTeam(team),
      );
      showToast(existing ? "Team updated" : `${team.name} created`);
      return team;
    },
    [mutate],
  );

  const setTeamStatus = useCallback(
    (teamId: string, status: LabourTeamStatus) => {
      /* Built before the mutation, so the same row goes to state and to
         Postgres — stateRef lags a render and would push the old status. */
      const before = stateRef.current?.labourTeams.find((t) => t.id === teamId);
      if (before) {
        persist("change the team status", () =>
          upsertLabourTeam({ ...before, status, updatedAt: Date.now() }),
        );
      }
      mutate((s) => {
        const team = s.labourTeams.find((t) => t.id === teamId);
        if (!team) return s;
        return {
          ...s,
          labourTeams: s.labourTeams.map((t) =>
            t.id === teamId ? { ...t, status, updatedAt: Date.now() } : t,
          ),
          audit: [auditLine(s, "team.status", team.name, status), ...s.audit].slice(0, 200),
        };
      });
      showToast(`Team ${status}`);
    },
    [mutate],
  );

  const addTeamMembers = useCallback(
    (teamId: string, employeeIds: string[]) => {
      const st = stateRef.current!;
      const already = new Set(
        st.teamMembers.filter((m) => m.teamId === teamId && !m.leftAt).map((m) => m.employeeId),
      );
      const fresh = employeeIds.filter((id) => !already.has(id));
      if (fresh.length === 0) {
        showToast("Already on this team", "info");
        return { added: 0, skipped: employeeIds.length };
      }
      const now = Date.now();
      const orgId = st.labourTeams.find((t) => t.id === teamId)?.orgId ?? "";

      /* Built here, not read back from state after the mutation: stateRef is
         synced in an effect and so lags a render, and a push that reads it
         immediately would send the previous state. */
      const rows: LabourTeamMember[] = fresh.map((employeeId) => ({
        id: rid("tm"),
        orgId,
        teamId,
        employeeId,
        joinedAt: now,
        status: "active" as const,
      }));

      mutate((s) => ({
        ...s,
        teamMembers: [...rows, ...s.teamMembers],
        audit: [
          auditLine(
            s,
            "team.member.add",
            s.labourTeams.find((t) => t.id === teamId)?.name ?? teamId,
            fresh.map((id) => s.users.find((u) => u.id === id)?.name ?? id).join(", ").slice(0, 400),
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      persist("add labour to the team", () => upsertTeamMembers(rows));
      showToast(`${fresh.length} added to the team`);
      return { added: fresh.length, skipped: employeeIds.length - fresh.length };
    },
    [mutate],
  );

  /** End a spell. The row stays; only its end date and reason are written. */
  const removeTeamMember = useCallback(
    (teamId: string, employeeId: string, status: TeamMemberStatus = "inactive") => {
      const now = Date.now();
      const closed = (stateRef.current?.teamMembers ?? [])
        .filter((m) => m.teamId === teamId && m.employeeId === employeeId && !m.leftAt)
        .map((m) => ({ ...m, leftAt: now, status }));
      mutate((s) => ({
        ...s,
        teamMembers: s.teamMembers.map((m) =>
          m.teamId === teamId && m.employeeId === employeeId && !m.leftAt
            ? { ...m, leftAt: now, status }
            : m,
        ),
        // A leader who has left the gang is not its leader.
        labourTeams: s.labourTeams.map((t) =>
          t.id === teamId && t.leaderId === employeeId
            ? { ...t, leaderId: undefined, updatedAt: now }
            : t,
        ),
        audit: [
          auditLine(
            s,
            "team.member.remove",
            s.labourTeams.find((t) => t.id === teamId)?.name ?? teamId,
            `${s.users.find((u) => u.id === employeeId)?.name ?? employeeId} · ${status}`,
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      persist("remove from the team", () => upsertTeamMembers(closed));
      showToast("Removed from team");
    },
    [mutate],
  );

  const transferMember = useCallback(
    (employeeId: string, fromTeamId: string, toTeamId: string) => {
      const st = stateRef.current!;
      if (fromTeamId === toTeamId) return { ok: false, reason: "Same team" };
      const to = st.labourTeams.find((t) => t.id === toTeamId);
      if (!to) return { ok: false, reason: "Team not found" };
      const now = Date.now();
      const joined: LabourTeamMember = {
        id: rid("tm"),
        orgId: to.orgId,
        teamId: toTeamId,
        employeeId,
        joinedAt: now,
        status: "active",
      };
      const left = (stateRef.current?.teamMembers ?? [])
        .filter((m) => m.teamId === fromTeamId && m.employeeId === employeeId && !m.leftAt)
        .map((m) => ({
          ...m,
          leftAt: now,
          status: "transferred" as const,
          transferredToTeamId: toTeamId,
        }));

      mutate((s) => ({
        ...s,
        teamMembers: [
          joined,
          ...s.teamMembers.map((m) =>
            m.teamId === fromTeamId && m.employeeId === employeeId && !m.leftAt
              ? { ...m, leftAt: now, status: "transferred" as const, transferredToTeamId: toTeamId }
              : m,
          ),
        ],
        labourTeams: s.labourTeams.map((t) =>
          t.id === fromTeamId && t.leaderId === employeeId
            ? { ...t, leaderId: undefined, updatedAt: now }
            : t,
        ),
        audit: [
          auditLine(
            s,
            "team.member.transfer",
            s.users.find((u) => u.id === employeeId)?.name ?? employeeId,
            `${s.labourTeams.find((t) => t.id === fromTeamId)?.name ?? fromTeamId} → ${to.name}`,
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      persist("transfer the worker", () => upsertTeamMembers([...left, joined]));
      showToast(`Transferred to ${to.name}`);
      return { ok: true };
    },
    [mutate],
  );

  const setTeamLeader = useCallback(
    (teamId: string, employeeId: string | undefined) => {
      const before = stateRef.current?.labourTeams.find((t) => t.id === teamId);
      if (before) {
        persist("set the team leader", () =>
          upsertLabourTeam({ ...before, leaderId: employeeId, updatedAt: Date.now() }),
        );
      }
      mutate((s) => ({
        ...s,
        labourTeams: s.labourTeams.map((t) =>
          t.id === teamId ? { ...t, leaderId: employeeId, updatedAt: Date.now() } : t,
        ),
        audit: [
          auditLine(
            s,
            "team.leader",
            s.labourTeams.find((t) => t.id === teamId)?.name ?? teamId,
            employeeId ? (s.users.find((u) => u.id === employeeId)?.name ?? employeeId) : "cleared",
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      showToast("Team leader updated");
    },
    [mutate],
  );

  /* -------------------------------------------------- group attendance */

  /**
   * Commit one reviewed group capture.
   *
   * Three rules, and each exists because breaking it produces a register
   * that lies:
   *
   *  - Nothing is written for a worker who already has a day today. A gang
   *    photographed after individual check-ins must not create a second
   *    record; the capture still stores what it saw, so the evidence is
   *    kept without the headcount being counted twice (spec §16).
   *  - Only workers on the team are marked. The reviewer can correct a
   *    match, but they cannot conjure attendance for someone who is not on
   *    the gang from a screen that is meant to reduce proxy marking.
   *  - The attendance row records that a person marked it and from what.
   *    A day from a photograph is a different kind of record from a day
   *    someone checked into, and it says so.
   */
  const submitGroupAttendance = useCallback(
    (input: GroupAttendanceInput) => {
      const st = stateRef.current;
      if (!st) return { ok: false, marked: 0, reason: "Not ready" };
      const by = st.session?.userId;
      if (!by) return { ok: false, marked: 0, reason: "Not signed in" };
      if (!canCaptureGroupAttendance(st, by, input.projectId)) {
        return { ok: false, marked: 0, reason: "Not permitted on this project" };
      }

      const team = st.labourTeams.find((t) => t.id === input.teamId);
      if (!team) return { ok: false, marked: 0, reason: "Team not found" };

      const roster = new Set(
        st.teamMembers
          .filter((m) => m.teamId === input.teamId && !m.leftAt)
          .map((m) => m.employeeId),
      );
      const onTeam = input.members.filter((m) => roster.has(m.employeeId));

      const today = todayISO();
      const alreadyIn = new Set(
        st.attendance.filter((a) => a.date === today).map((a) => a.employeeId),
      );

      const at = Date.now();
      const groupId = rid("ga");
      const project = st.projects.find((p) => p.id === input.projectId);
      const orgId = team.orgId;

      const toMark = onTeam.filter(
        (m) => m.attendanceStatus === "present" && !alreadyIn.has(m.employeeId),
      );

      /* Everything is built from the state we already hold, before the
         mutation, so the same objects go into local state and into the
         push. Reading them back afterwards would read a render too early. */
      const rows: Attendance[] = toMark.map((m) => {
          const u = st.users.find((x) => x.id === m.employeeId);
          return {
            id: rid("att"),
            employeeId: m.employeeId,
            projectId: input.projectId,
            date: today,
            checkIn: {
              at,
              /* The engineer's fix, not the worker's — they were not holding
                 the phone. Attributed rather than invented (spec §18). */
              coords: input.coords ?? project?.location ?? { lat: 0, lng: 0 },
              accuracy: 0,
              selfie: makeSelfie(u?.name ?? "?", u?.avatarHue ?? 0, "Group photo"),
              place: project?.name ?? "Site",
              insideGeofence: input.geofenceStatus === "inside",
              syncedAt: at,
            },
            distanceMeters: 0,
            status: "present",
            events: [],
            shiftId: input.shiftId ?? team.shiftId,
            markedBy: {
              userId: by,
              method: "group-photo",
              at,
              groupAttendanceId: groupId,
              teamId: input.teamId,
            },
          };
      });

      const attendanceByEmployee = new Map(rows.map((r) => [r.employeeId, r.id]));

      const record: GroupAttendanceRecord = {
          id: groupId,
          orgId,
          projectId: input.projectId,
          teamId: input.teamId,
          shiftId: input.shiftId ?? team.shiftId,
          siteEngineerId: by,
          photos: input.photos,
          capturedAt: at,
          coords: input.coords,
          geofenceStatus: input.geofenceStatus,
          faceCount: input.faceCount,
          matchedCount: onTeam.filter((m) => m.matchStatus === "matched").length,
          status: "confirmed",
          confirmedBy: by,
          confirmedAt: at,
          note: input.note,
        };

      const members: GroupAttendanceMember[] = onTeam.map((m) => ({
          id: rid("gam"),
          orgId,
          groupAttendanceId: groupId,
          employeeId: m.employeeId,
          detectionStatus: m.detectionStatus,
          matchStatus: m.matchStatus,
          attendanceStatus: m.attendanceStatus,
          reviewStatus: m.reviewStatus,
          distance: m.distance,
        attendanceId:
          attendanceByEmployee.get(m.employeeId) ??
          st.attendance.find(
            (a) => a.employeeId === m.employeeId && a.date === today,
          )?.id,
      }));

      mutate((s) => {
        return {
          ...s,
          attendance: [...rows, ...s.attendance],
          groupAttendance: [record, ...s.groupAttendance],
          groupAttendanceMembers: [...members, ...s.groupAttendanceMembers],
          audit: [
            auditLine(
              s,
              "attendance.group",
              `${team.name} · ${record.id}`,
              `${input.faceCount} faces · ${rows.length} marked · geofence ${input.geofenceStatus}`,
            ),
            ...s.audit,
          ].slice(0, 200),
        };
      });

      const skipped = onTeam.filter(
        (m) => m.attendanceStatus === "present" && alreadyIn.has(m.employeeId),
      ).length;
      persist("record the group attendance", () =>
        insertGroupAttendance(record, members),
      );
      showToast(
        skipped
          ? `${toMark.length} marked · ${skipped} already in`
          : `${toMark.length} marked present`,
      );
      return { ok: true, groupId, marked: toMark.length };
    },
    [mutate],
  );

  /**
   * A work update about a gang.
   *
   * Written by a person — the site engineer standing in front of the team —
   * and tagged with the team it describes. Everything else is picked up from
   * where and when it was written rather than typed: the project, the zone
   * the author is standing in, the time and the fix. A supervisor recording
   * what a gang did should be answering one question, not filling a form.
   */
  const submitTeamUpdate = useCallback(
    (input: TeamUpdateInput) => {
      const st = stateRef.current;
      if (!st?.session) return { ok: false, reason: "Not signed in" };
      const author = st.users.find((u) => u.id === st.session!.userId);
      const team = st.labourTeams.find((t) => t.id === input.teamId);
      if (!author || !team) return { ok: false, reason: "Team not found" };
      if (!canCaptureGroupAttendance(st, author.id, team.projectId)) {
        return { ok: false, reason: "Not permitted on this project" };
      }
      if (input.description.trim().length < 4) {
        return { ok: false, reason: "Say what the team did." };
      }

      const project = st.projects.find((p) => p.id === team.projectId);
      const f = fixRef.current;
      const isOffline = !(navigator.onLine && !st.settings.forceOffline);
      const zone = project?.zones.find((z) => z.id === team.workZoneId);

      const update: WorkUpdate = {
        id: uid(),
        employeeId: author.id,
        projectId: team.projectId,
        teamId: team.id,
        date: todayISO(),
        at: Date.now(),
        category: input.category,
        kind: "shift",
        description: input.description.trim(),
        photos: input.photos ?? [],
        voiceNoteSeconds: input.voiceNoteSeconds,
        coords: f?.coords,
        /* The team's zone when it has one — that is where the gang works,
           and it is more useful than where the author happens to stand. */
        place:
          zone?.name ??
          (f && project
            ? resolvePlace(f.coords, project.zones, project.location)
            : undefined),
        status: isOffline ? "queued" : "synced",
      };

      mutate((prev) => ({
        ...prev,
        updates: [update, ...prev.updates],
        outbox: isOffline
          ? [
              ...prev.outbox,
              {
                id: rid("ob"),
                at: update.at,
                kind: "work-update",
                label: `${team.name} update`,
                payloadId: update.id,
              },
            ]
          : prev.outbox,
        audit: [
          auditLine(prev, "team.update.log", team.name, input.category),
          ...prev.audit,
        ].slice(0, 200),
      }));

      if (!isOffline) {
        persist("record the team update", () => insertWorkUpdate(update, author.orgId));
      }
      showToast(`Logged against ${team.name}`);
      return { ok: true };
    },
    [mutate],
  );

  /**
   * Announce note reminders that have fallen due.
   *
   * Two rules. A reminder is announced once — `reminderSent` is the latch,
   * and without it a screen that polls would re-announce the same note every
   * few seconds. And it reaches only people entitled to read the note: the
   * reminder repeats the title, so a reminder with a wider audience than its
   * note would leak the note.
   */
  const fireDueReminders = useCallback(() => {
    const st = stateRef.current;
    if (!st) return 0;
    const due = dueReminders(st);
    if (due.length === 0) return 0;

    mutate((s) => {
      const notes: AppNotification[] = [];
      for (const n of due) {
        const project = s.projects.find((p) => p.id === n.projectId);
        for (const u of s.users) {
          if (!canSeeNote(s, n, u.id)) continue;
          notes.push({
            id: rid("ntf"),
            audience: u.role,
            userId: u.id,
            kind: "reminder",
            title: n.title,
            body: `${project?.name ?? "Project"}${n.body ? ` · ${n.body.slice(0, 90)}` : ""}`,
            at: Date.now(),
            read: false,
            severity:
              n.priority === "critical"
                ? "critical"
                : n.priority === "important"
                  ? "warning"
                  : "info",
            link: `/manager/notes?project=${n.projectId}&note=${n.id}`,
          });
        }
      }
      const dueIds = new Set(due.map((n) => n.id));
      return {
        ...s,
        projectNotes: s.projectNotes.map((n) =>
          dueIds.has(n.id) ? { ...n, reminderSent: true } : n,
        ),
        notifications: [...notes, ...s.notifications].slice(0, 300),
      };
    });

    for (const n of due) {
      persist("mark the reminder sent", () =>
        upsertProjectNote({ ...n, reminderSent: true }),
      );
    }
    return due.length;
  }, [mutate]);

  /* --------------------------------------------------------- project notes */

  const saveNote = useCallback(
    (patch: Partial<ProjectNote> & { projectId: string; title: string }, id?: string) => {
      const st = stateRef.current!;
      const now = Date.now();
      const author = st.session?.userId ?? "system";
      const orgId = st.users.find((u) => u.id === author)?.orgId ?? "";
      const existing = id ? st.projectNotes.find((n) => n.id === id) : undefined;

      const note: ProjectNote = {
        id: existing?.id ?? rid("note"),
        orgId: existing?.orgId ?? orgId,
        projectId: patch.projectId,
        authorId: existing?.authorId ?? author,
        title: patch.title.trim(),
        body: (patch.body ?? existing?.body ?? "").trim(),
        category: patch.category ?? existing?.category ?? "General",
        priority: patch.priority ?? existing?.priority ?? "normal",
        /* Default-closed: a note nobody chose an audience for is a note for
           the people who run the job, not for the whole site. */
        visibility: patch.visibility ?? existing?.visibility ?? "managers-engineers",
        visibleTo: patch.visibleTo ?? existing?.visibleTo,
        status: patch.status ?? existing?.status ?? "open",
        dueDate: patch.dueDate ?? existing?.dueDate,
        remindAt: patch.remindAt ?? existing?.remindAt,
        reminderSent: existing?.reminderSent,
        pinned: patch.pinned ?? existing?.pinned ?? false,
        coords: patch.coords ?? existing?.coords,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      mutate((s) => ({
        ...s,
        projectNotes: existing
          ? s.projectNotes.map((n) => (n.id === note.id ? note : n))
          : [note, ...s.projectNotes],
        audit: [
          auditLine(
            s,
            existing ? "note.update" : "note.create",
            note.title,
            `${note.category} · ${note.priority} · ${note.visibility}`,
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      persist(existing ? "save the note" : "add the note", () => upsertProjectNote(note));
      showToast(existing ? "Note updated" : "Note added");
      return note;
    },
    [mutate],
  );

  const setNotePinned = useCallback(
    (noteId: string, pinned: boolean) => {
      const before = stateRef.current?.projectNotes.find((n) => n.id === noteId);
      if (before) {
        persist("pin the note", () =>
          upsertProjectNote({ ...before, pinned, updatedAt: Date.now() }),
        );
      }
      mutate((s) => ({
        ...s,
        projectNotes: s.projectNotes.map((n) =>
          n.id === noteId ? { ...n, pinned, updatedAt: Date.now() } : n,
        ),
      }));
      showToast(pinned ? "Pinned to the project" : "Unpinned");
    },
    [mutate],
  );

  const setNoteStatus = useCallback(
    (noteId: string, status: NoteStatus) => {
      const before = stateRef.current?.projectNotes.find((n) => n.id === noteId);
      if (before) {
        persist("update the note status", () =>
          upsertProjectNote({ ...before, status, updatedAt: Date.now() }),
        );
      }
      mutate((s) => ({
        ...s,
        projectNotes: s.projectNotes.map((n) =>
          n.id === noteId ? { ...n, status, updatedAt: Date.now() } : n,
        ),
      }));
      showToast(status === "done" ? "Marked done" : `Note ${status}`);
    },
    [mutate],
  );

  const deleteNote = useCallback(
    (noteId: string) => {
      mutate((s) => {
        const note = s.projectNotes.find((n) => n.id === noteId);
        return {
          ...s,
          projectNotes: s.projectNotes.filter((n) => n.id !== noteId),
          noteAttachments: s.noteAttachments.filter((a) => a.noteId !== noteId),
          audit: note
            ? [auditLine(s, "note.delete", note.title, note.category), ...s.audit].slice(0, 200)
            : s.audit,
        };
      });
      persist("delete the note", () => deleteProjectNote(noteId));
      showToast("Note deleted");
    },
    [mutate],
  );

  const addNoteAttachment = useCallback(
    (
      noteId: string,
      file: Omit<ProjectNoteAttachment, "id" | "orgId" | "noteId" | "createdBy" | "createdAt">,
    ) => {
      const st = stateRef.current!;
      const by = st.session?.userId ?? "system";
      const orgId = st.projectNotes.find((n) => n.id === noteId)?.orgId ?? "";
      const row: ProjectNoteAttachment = {
        ...file,
        id: rid("att"),
        orgId,
        noteId,
        createdBy: by,
        createdAt: Date.now(),
      };
      mutate((s) => ({ ...s, noteAttachments: [...s.noteAttachments, row] }));
      persist("attach the file", () => insertNoteAttachment(row));
      showToast("Attached");
    },
    [mutate],
  );

  const removeNoteAttachment = useCallback(
    (attachmentId: string) => {
      mutate((s) => ({
        ...s,
        noteAttachments: s.noteAttachments.filter((a) => a.id !== attachmentId),
      }));
      persist("remove the attachment", () => deleteNoteAttachment(attachmentId));
    },
    [mutate],
  );

  /**
   * Store an enrolled face.
   *
   * Descriptors only — the photographs the samples came from are already
   * discarded by the time this is called. Passing an empty array removes
   * the enrolment, which is how someone withdraws it.
   */
  const enrollFace = useCallback(
    (userId: string, descriptors: number[][]) => {
      mutate((s) => ({
        ...s,
        users: s.users.map((u) =>
          u.id === userId
            ? {
                ...u,
                face: descriptors.length
                  ? {
                      descriptors,
                      enrolledAt: Date.now(),
                      enrolledBy: s.session?.userId,
                    }
                  : undefined,
              }
            : u,
        ),
        audit: [
          auditLine(
            s,
            descriptors.length ? "face.enroll" : "face.remove",
            s.users.find((u) => u.id === userId)?.name ?? userId,
            descriptors.length ? `${descriptors.length} samples` : "enrolment removed",
          ),
          ...s.audit,
        ].slice(0, 200),
      }));
      showToast(descriptors.length ? "Face enrolled" : "Face enrolment removed");
    },
    [mutate],
  );

  const removeUser = useCallback(
    (userId: string) => {
      mutate((s) => ({
        ...s,
        users: s.users.filter((u) => u.id !== userId),
        projects: s.projects.map((p) =>
          p.employeeIds.includes(userId)
            ? { ...p, employeeIds: p.employeeIds.filter((id) => id !== userId) }
            : p,
        ),
        attendance: s.attendance.filter((a) => a.employeeId !== userId),
        points: s.points.filter((pt) => pt.employeeId !== userId),
        updates: s.updates.filter((u) => u.employeeId !== userId),
        session: s.session?.userId === userId ? null : s.session,
      }));
      persist("remove the person", () => deleteUser(userId));
    },
    [mutate],
  );

  const saveEmployee = useCallback(
    (patch: Partial<User> & { name: string }, id?: string): User => {
      let saved: User | null = null;
      mutate((s) => {
        if (id) {
          const users = s.users.map((u) => {
            if (u.id !== id) return u;
            saved = { ...u, ...patch, id };
            return saved;
          });
          return { ...s, users };
        }
        const created: User = {
          id: uid(),
          orgId: patch.orgId ?? currentOrgId(s),
          name: patch.name,
          email: patch.email ?? "",
          employeeCode:
            patch.employeeCode ?? nextCode(s, codeStem(orgNameFor(s))),
          role: "employee",
          designation: patch.designation ?? "Worker",
          department: patch.department ?? "Civil",
          phone: patch.phone ?? "",
          avatarHue: patch.avatarHue ?? Math.floor(Math.random() * 360),
          status: patch.status ?? "active",
          projectIds: patch.projectIds ?? [],
          shiftStart: patch.shiftStart ?? 8 * 60 + 30,
          shiftEnd: patch.shiftEnd ?? 17 * 60 + 30,
          joinedAt: Date.now(),
        };
        saved = created;
        const projects = s.projects.map((p) =>
          created.projectIds.includes(p.id)
            ? { ...p, employeeIds: [...new Set([...p.employeeIds, created.id])] }
            : p,
        );
        return { ...s, users: [...s.users, created], projects };
      });
      const person = saved!;
      persist("save the person", async () => {
        await upsertUser(person, person.orgId);
        // A new hire assigned to sites in the same breath: the membership
        // rows are part of saving them, not a separate thing the manager
        // has to remember to do.
        for (const projectId of person.projectIds) {
          const project = stateRef.current?.projects.find((p) => p.id === projectId);
          if (project) {
            await replaceProjectMembers(projectId, project.employeeIds, person.orgId);
          }
        }
      });
      showToast(id ? `${person.name} updated` : `${person.name} added`);
      return person;
    },
    [mutate],
  );

  const assignEmployee = useCallback(
    (userId: string, projectId: string) => {
      mutate((s) => ({
        ...s,
        users: s.users.map((u) =>
          u.id === userId
            ? { ...u, projectIds: [...new Set([...u.projectIds, projectId])] }
            : u,
        ),
        projects: s.projects.map((p) =>
          p.id === projectId
            ? { ...p, employeeIds: [...new Set([...p.employeeIds, userId])] }
            : p,
        ),
        audit: [
          { id: rid("aud"), at: Date.now(), actorId: s.session?.userId ?? "system", action: "employee.assign", target: projectId, detail: userId },
          ...s.audit,
        ],
      }));
      syncRoster(projectId);
    },
    [mutate, syncRoster],
  );

  const removeEmployeeFromProject = useCallback(
    (userId: string, projectId: string) => {
      mutate((s) => ({
        ...s,
        users: s.users.map((u) =>
          u.id === userId
            ? { ...u, projectIds: u.projectIds.filter((p) => p !== projectId) }
            : u,
        ),
        projects: s.projects.map((p) =>
          p.id === projectId
            ? { ...p, employeeIds: p.employeeIds.filter((e) => e !== userId) }
            : p,
        ),
      }));
      syncRoster(projectId);
    },
    [mutate, syncRoster],
  );

  const saveProject = useCallback(
    (patch: Partial<Project> & { name: string }, id?: string): Project => {
      let saved: Project | null = null;
      mutate((s) => {
        if (id) {
          const projects = s.projects.map((p) => {
            if (p.id !== id) return p;
            saved = { ...p, ...patch, id };
            return saved;
          });
          return { ...s, projects };
        }
        const loc = patch.location ?? { lat: 11.03, lng: 77.0 };
        const created: Project = {
          id: uid(),
          orgId: patch.orgId ?? currentOrgId(s),
          kind: patch.kind ?? "site",
          // Defaults to recording the whole shift: the stricter policy is the
          // safer thing to arrive at by accident, and turning it off is a
          // deliberate choice the manager makes at creation.
          trackingMode: patch.trackingMode ?? "full-shift",
          code: patch.code ?? nextProjectCode(s, codeStem(orgNameFor(s))),
          name: patch.name,
          client: patch.client ?? "",
          address: patch.address ?? "",
          siteContact: patch.siteContact ?? "",
          siteContactPhone: patch.siteContactPhone ?? "",
          // Whoever is creating it owns it until they hand it over. There is
          // no seeded manager to fall back on any more, and an unowned project
          // has nobody to raise a geofence alert with.
          managerId: s.session?.userId ?? "",
          startDate: patch.startDate ?? todayISO(),
          endDate: patch.endDate ?? "",
          status: patch.status ?? "planning",
          description: patch.description ?? "",
          location: loc,
          geofence:
            patch.geofence ?? {
              kind: "circle",
              polygon: [],
              center: loc,
              radius: 150,
              bufferMeters: 40,
            },
          zones: patch.zones ?? [],
          employeeIds: patch.employeeIds ?? [],
          rules:
            patch.rules ?? {
              shiftStart: 8 * 60 + 30,
              shiftEnd: 17 * 60 + 30,
              lateGraceMinutes: 15,
              minShiftMinutes: 7 * 60,
              exitAlertMinutes: 10,
              autoCheckoutHours: 14,
            },
          createdAt: Date.now(),
        };
        saved = created;
        return { ...s, projects: [...s.projects, created] };
      });
      const project = saved!;
      persist("save the project", () => upsertProject(project));
      showToast(id ? `${project.name} updated` : `${project.name} created`);
      return project;
    },
    [mutate],
  );

  const updateGeofence = useCallback(
    (projectId: string, geofence: Project["geofence"]) => {
      mutate((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === projectId ? { ...p, geofence } : p)),
        audit: [
          { id: rid("aud"), at: Date.now(), actorId: s.session?.userId ?? "system", action: "geofence.update", target: projectId, detail: `${geofence.kind} boundary saved` },
          ...s.audit,
        ],
      }));
      const project = stateRef.current?.projects.find((p) => p.id === projectId);
      if (project) persist("save the boundary", () => upsertProject(project));
    },
    [mutate],
  );

  const setPermission = useCallback<StoreApi["setPermission"]>(
    (key, value) => {
      mutate((s) => ({ ...s, permissions: { ...s.permissions, [key]: value } }));
    },
    [mutate],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      mutate((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    },
    [mutate],
  );

  const markNotificationsRead = useCallback(
    (audience: Role) => {
      mutate((s) => ({
        ...s,
        notifications: s.notifications.map((n) =>
          n.audience === audience ? { ...n, read: true } : n,
        ),
      }));
    },
    [mutate],
  );

  /**
   * Stand up a whole new tenant from the self-serve signup, in one write.
   *
   * Everything a company needs for the product to work on the very next
   * screen: the founder as its admin, the first site with a boundary drawn
   * around it, optionally an office to close shifts at, and whoever they
   * invited. One `mutate`, because a half-provisioned company is worse than
   * none — an admin with no site, or a site with no crew, is a dead end the
   * app offers no way out of.
   *
   * Unlike every other creator here it cannot call `currentOrgId`: nobody is
   * signed in yet, which is the whole point. The tenant id is minted here and
   * handed back, so the commercial record in the platform store is filed
   * against the same organisation rather than a second one.
   */
  const provisionCompany = useCallback(
    (draft: CompanyDraft): ProvisionedCompany => {
      const now = Date.now();
      const orgId = uid();
      const adminId = uid();
      const siteId = uid();
      const officeId = draft.office ? uid() : null;
      const premiseIds = [siteId, ...(officeId ? [officeId] : [])];

      const crew: User[] = draft.crew.map((c, i) => ({
        id: uid(),
        orgId,
        name: c.name,
        employeeCode: `${codeStem(draft.company)}-${String(i + 2).padStart(4, "0")}`,
        role: "employee",
        designation: c.designation?.trim() || "Worker",
        department: "Site",
        /* Email is the identity, so a crew member invited without one gets a
           placeholder on the org's domain rather than an empty key that two
           people could share. It is editable the moment they are opened. */
        email: c.email?.trim() || `${c.name.toLowerCase().replace(/[^a-z]+/g, ".")}.${i + 2}@${domainFor(draft.company)}`,
        phone: c.phone,
        avatarHue: hueFor(c.name),
        status: "active",
        projectIds: premiseIds,
        shiftStart: DEFAULT_SHIFT.start,
        shiftEnd: DEFAULT_SHIFT.end,
        joinedAt: now,
      }));

      const admin: User = {
        id: adminId,
        orgId,
        name: draft.admin.name,
        employeeCode: `${codeStem(draft.company)}-0001`,
        role: "admin",
        designation: "Client Administrator",
        department: "Management",
        phone: draft.admin.phone,
        email: draft.admin.email?.trim() || `admin@${domainFor(draft.company)}`,
        avatarHue: hueFor(draft.admin.name),
        status: "active",
        projectIds: premiseIds,
        shiftStart: DEFAULT_SHIFT.start,
        shiftEnd: DEFAULT_SHIFT.end,
        joinedAt: now,
      };

      const roster = [admin.id, ...crew.map((c) => c.id)];

      const premise = (
        id: string,
        d: PremiseDraft,
        kind: Project["kind"],
        trackingMode: TrackingMode,
        code: string,
        description: string,
      ): Project => ({
        id,
        orgId,
        kind,
        trackingMode,
        code,
        name: d.name,
        client: draft.company,
        address: d.address,
        siteContact: draft.admin.name,
        siteContactPhone: draft.admin.phone ?? "",
        // The founder runs everything until they hand a site to someone else;
        // an unowned project has no one to raise a geofence alert with.
        managerId: adminId,
        startDate: todayISO(),
        endDate: "",
        status: "active",
        description,
        location: d.location,
        geofence: {
          kind: "circle",
          polygon: [],
          center: d.location,
          radius: d.radius,
          bufferMeters: 40,
        },
        zones: [],
        employeeIds: roster,
        rules: {
          shiftStart: DEFAULT_SHIFT.start,
          shiftEnd: DEFAULT_SHIFT.end,
          lateGraceMinutes: 15,
          minShiftMinutes: 7 * 60,
          exitAlertMinutes: 10,
          autoCheckoutHours: 14,
        },
        createdAt: now,
      });

      const site = premise(
        siteId,
        draft.site,
        "site",
        draft.site.trackingMode,
        `${codeStem(draft.company)}-S01`,
        "Your first site. Redraw the boundary and add zones from Projects.",
      );
      const office = draft.office
        ? premise(
            officeId!,
            draft.office,
            "office",
            "full-shift",
            `${codeStem(draft.company)}-HO1`,
            "Office premise. Crews working away from a site can start and end the day here.",
          )
        : null;

      // Day one comes with a working shift: contracted hours, a lunch break,
      // and auto-approved overtime — everything the manager can reshape later
      // from Shifts. Assigned to the whole crew from today.
      const generalShift: ShiftDef = {
        id: uid(),
        orgId,
        name: "General Shift",
        code: "SH-01",
        kind: "fixed",
        startMinute: DEFAULT_SHIFT.start,
        endMinute: DEFAULT_SHIFT.end,
        requiredMinutes: DEFAULT_SHIFT.end - DEFAULT_SHIFT.start - 60,
        graceMinutes: 15,
        breakRules: [
          {
            id: rid("brl"),
            name: "Lunch",
            startMinute: 13 * 60,
            endMinute: 13 * 60 + 45,
            durationMinutes: 45,
            paid: false,
          },
        ],
        maxBreaksPerShift: 3,
        minBreakMinutes: 5,
        maxBreakMinutes: 90,
        employeeBreaksAllowed: true,
        breakApprovalRequired: false,
        overtime: { ...DEFAULT_OVERTIME },
        workingDays: [1, 2, 3, 4, 5, 6],
        projectIds: premiseIds,
        status: "active",
        createdAt: now,
      };
      const shiftAssignments: ShiftAssignment[] = roster.map((employeeId) => ({
        id: rid("sha"),
        employeeId,
        shiftId: generalShift.id,
        effectiveFrom: todayISO(),
        assignedBy: adminId,
        at: now,
      }));

      mutate((s) => {
        // Idempotent: React may invoke an updater twice, and provisioning a
        // company twice would double the whole tenant.
        if (s.users.some((u) => u.id === adminId)) return s;
        return {
          ...s,
          users: [...s.users, admin, ...crew],
          projects: [...s.projects, site, ...(office ? [office] : [])],
          shifts: [...(s.shifts ?? []), generalShift],
          shiftAssignments: [...(s.shiftAssignments ?? []), ...shiftAssignments],
          audit: [
            {
              id: rid("aud"),
              at: now,
              actorId: adminId,
              action: "company.provision",
              target: draft.company,
              detail:
                `${premiseIds.length} premise${premiseIds.length === 1 ? "" : "s"}, ` +
                `${crew.length} invited`,
            },
            ...s.audit,
          ],
          session: { userId: adminId, role: "admin" as Role, at: now },
          activeProjectId: siteId,
        };
      });

      fenceStateRef.current = null;
      lastRecordedRef.current = 0;
      recordingRef.current = false;
      setFix(null);

      return { orgId, admin, site, office, crew };
    },
    [mutate],
  );

  /* ------------------------------------------------------------ demo mode */

  /**
   * Enter demo mode as a persona.
   *
   * The data is seeded into the demo namespace and the page is reloaded
   * rather than swapped in place: both stores choose their storage key at
   * hydration, and a reload is the honest way to make every provider agree
   * on which world it is in.
   */
  const enterDemo = useCallback((personaId: string) => {
    const persona = personaById(personaId);
    if (!persona) return;
    const data = buildDemoData();
    data.workforce.session = {
      userId: persona.userId,
      role: persona.role,
      at: Date.now(),
    };
    setDemoActive(true);
    setCurrentPersona(persona.id);
    try {
      localStorage.setItem(workforceKey(), JSON.stringify(data.workforce));
      localStorage.setItem(
        workforceKey().replace(".v", ".platform.v"),
        JSON.stringify(data.platform),
      );
    } catch {
      /* storage full — the demo still runs from memory this session */
    }
    // Land on the persona's own home, not wherever the visit had been
    // heading before the demo was chosen.
    clearDestination();
    window.location.href = homeFor(persona.role);
  }, []);

  const switchPersona = useCallback(
    (personaId: string) => {
      const persona = personaById(personaId);
      if (!persona) return;
      setCurrentPersona(persona.id);
      clearDestination();
      mutate((s) => {
        const user = s.users.find((u) => u.id === persona.userId);
        return {
          ...s,
          session: {
            userId: persona.userId,
            role: persona.role,
            at: Date.now(),
          },
          activeProjectId: user?.projectIds[0] ?? s.activeProjectId,
        };
      });
      setFix(null);
    },
    [mutate],
  );

  const resetDemo = useCallback(() => {
    const persona = personaById(currentPersonaId());
    clearDemoData();
    enterDemo(persona?.id ?? "owner");
  }, [enterDemo]);

  const exitDemo = useCallback(() => {
    setDemoActive(false);
    window.location.href = "/";
  }, []);

  const eraseLocalData = useCallback(() => {
    try {
      localStorage.removeItem(workforceKey());
    } catch {
      /* private mode, or storage already gone — the reset below still holds */
    }
    setFix(null);
    setState(buildSeedState());
  }, []);

  if (!state) {
    // Consistent SSR + first client render; hydrate happens in the effect.
    return <WorkforceBoot />;
  }
  const api: StoreApi = {
    // Consumers only ever see their own tenant's slice.
    state: scopeToTenant(state),
    hydrated: true,
    online,
    login,
    loginAs,
    provisionCompany,
    reloadFromBackend,
    logout,
    currentUser,
    setActiveProject,
    fix,
    fence,
    simScenario,
    setSimScenario,
    openShift,
    checkIn,
    enrollFace,
    markPresentFromPhoto,
    checkOut,
    liveTrail,
    startBreak,
    endBreak,
    saveShift,
    archiveShift,
    assignShift,
    saveComp,
    updatePayPolicy,
    decideOvertime,
    decideOvertimeMany,
    setPayrollStatus,
    addPayrollAdjustment,
    logAudit,
    saveTeam,
    setTeamStatus,
    addTeamMembers,
    removeTeamMember,
    transferMember,
    setTeamLeader,
    submitGroupAttendance,
    submitTeamUpdate,
    fireDueReminders,
    saveNote,
    setNotePinned,
    setNoteStatus,
    deleteNote,
    addNoteAttachment,
    removeNoteAttachment,
    isDemo: demoActive(),
    enterDemo,
    switchPersona,
    resetDemo,
    exitDemo,
    activeTravel,
    startTravel,
    endTravel,
    decideTravel,
    savePetrolRule,
    saveFoodRule,
    archiveAllowanceRule,
    decideFoodAllowance,
    saveVehicle,
    setProjectTravelTracking,
    submitWorkUpdate,
    saveEmployee,
    removeUser,
    setUserRole,
    removeEmployeeFromProject,
    assignEmployee,
    saveProject,
    updateGeofence,
    setPermission,
    updateSettings,
    markNotificationsRead,
    pushNotification,
    eraseLocalData,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function subscribeToConnectivity(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function WorkforceBoot() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--wf-bg)]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-amber-400" />
        <p className="text-sm font-medium tracking-wide text-white/60">
          Loading Workfence…
        </p>
      </div>
    </div>
  );
}
