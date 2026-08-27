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
import {
  DEFAULT_OVERTIME,
  DEFAULT_PAY_POLICY,
  dayMetrics,
  fmtHM,
  monthLocked,
  shiftFor,
} from "./payroll";
import { isLiveBackend } from "./supabase/client";
import { onAuthChange, signOut as authSignOut } from "./supabase/auth";
import {
  fetchWorkforce,
  insertCheckIn,
  insertCheckOut,
  insertPoints,
  insertWorkUpdate,
  replaceProjectMembers,
  upsertProject,
  upsertUser,
} from "./supabase/repository";
import { persist, uid } from "./supabase/sync";
import type {
  AppNotification,
  Attendance,
  AttendanceMark,
  BreakEntry,
  CompRecord,
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
  ShiftAssignment,
  ShiftDef,
  ShiftEvent,
  TrackingMode,
  User,
  VoiceNote,
  WorkUpdate,
  WorkforceState,
} from "./types";

// Derived, not written by hand: the key said v3 while the shape was at v5,
// which is the same drift that silently discarded sessions once already.
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
  phone: string;
  designation?: string;
}

export interface CompanyDraft {
  company: string;
  admin: { name: string; phone: string; email?: string };
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
  checkIn: (selfie: string | null) => { ok: boolean; reason?: string };
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
  decideOvertime: (
    attendanceId: string,
    decision: Extract<OvertimeStatus, "approved" | "rejected">,
    approvedMinutes?: number,
    note?: string,
  ) => void;
  setPayrollStatus: (month: string, status: PayrollStatus) => void;
  addPayrollAdjustment: (
    month: string,
    employeeId: string,
    amount: number,
    note: string,
  ) => void;

  /* mutations */
  submitWorkUpdate: (u: Partial<WorkUpdate> & { description: string }) => void;
  saveEmployee: (u: Partial<User> & { name: string }, id?: string) => User;
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
  /**
   * Wipe this device's copy of everything and start from an empty install.
   *
   * Named for what it does now that there is no seeded demo to return to:
   * against a local store this is the company's only copy, and there is no
   * undo. Callers must confirm before calling it.
   */
  eraseLocalData: () => void;
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

  /* hydrate on the client only — the seed depends on Date.now() */
  useEffect(() => {
    let next: WorkforceState | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
          };
        }
      }
    } catch {
      /* corrupted storage → reseed */
    }
    if (!next) next = buildSeedState();
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
    if (isLiveBackend) {
      let cancelled = false;
      const hydrate = () => {
        fetchWorkforce()
          .then((live) => {
            if (cancelled) return;
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
          })
          .catch((err) => {
            console.error("[Workfence] Supabase hydration failed; staying on local state.", err);
          });
      };
      hydrate(); // a persisted session may already be valid
      const off = onAuthChange((signedIn) => {
        if (signedIn) hydrate();
      });
      return () => {
        cancelled = true;
        off();
      };
    }
  }, []);

  /* persist (debounced via rAF batching of React updates) */
  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota exceeded — drop oldest trail points and retry once */
      try {
        const slim = { ...state, points: state.points.slice(-4000) };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
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

      // Under `outside-only` the boundary is a privacy line, not a warning
      // line: while the worker is inside it, nothing is written at all.
      const offsiteOnly = project?.trackingMode === "outside-only";
      const inside = project
        ? checkGeofence(f.coords, project.geofence).inside
        : false;
      if (offsiteOnly && inside) {
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
    (selfie: string | null): { ok: boolean; reason?: string } => {
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
      if (!isOffline) {
        persist("record the checkout", () =>
          insertCheckOut(shift.id, {
            mark,
            workedMinutes: worked,
            distanceMeters: shift.distanceMeters,
            status,
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
    mutate((prev) => ({
      ...prev,
      attendance: prev.attendance.map((a) =>
        a.id === shift.id ? { ...a, breaks: [...(a.breaks ?? []), entry] } : a,
      ),
    }));
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
    mutate((prev) => ({
      ...prev,
      attendance: prev.attendance.map((a) =>
        a.id === shift.id
          ? {
              ...a,
              breaks: (a.breaks ?? []).map((b) =>
                b.id === open.id ? { ...b, end: at, coordsEnd: f?.coords } : b,
              ),
            }
          : a,
      ),
    }));
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
      return saved!;
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
    },
    [mutate],
  );

  const assignShift = useCallback(
    (employeeIds: string[], shiftId: string, effectiveFrom: string) => {
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
      mutate((s) => ({
        ...s,
        comp: [
          ...(s.comp ?? []),
          {
            ...rec,
            id: rid("cmp"),
            setBy: s.session?.userId ?? "system",
            at: Date.now(),
          },
        ],
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
    },
    [mutate],
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
    },
    [mutate, pushNotification],
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
        email: draft.admin.email?.trim() || undefined,
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
        siteContactPhone: draft.admin.phone,
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

  const eraseLocalData = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
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
    logout,
    currentUser,
    setActiveProject,
    fix,
    fence,
    simScenario,
    setSimScenario,
    openShift,
    checkIn,
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
    setPayrollStatus,
    addPayrollAdjustment,
    submitWorkUpdate,
    saveEmployee,
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
