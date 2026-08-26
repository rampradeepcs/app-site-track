"use client";

/**
 * Workfence client store.
 *
 * A single React context that owns the whole workforce dataset:
 *  - hydrates from localStorage (falling back to the generated seed),
 *  - persists every mutation,
 *  - runs the live-tracking engine (simulated GPS walk or real
 *    `navigator.geolocation` fixes) while a shift is open,
 *  - models offline capture via an outbox that syncs on reconnect.
 *
 * There is intentionally no backend: this is a self-contained product demo
 * whose data layer mirrors the API the real service would expose.
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
import { isLiveBackend } from "./supabase/client";
import { onAuthChange, signOut as authSignOut } from "./supabase/auth";
import { fetchWorkforce } from "./supabase/repository";
import type {
  AppNotification,
  Attendance,
  AttendanceMark,
  LatLng,
  LocationPoint,
  OutboxItem,
  Project,
  Role,
  Settings,
  ShiftEvent,
  TrackingMode,
  User,
  WorkUpdate,
  WorkforceState,
} from "./types";

// Derived, not written by hand: the key said v3 while the shape was at v5,
// which is the same drift that silently discarded sessions once already.
const STORAGE_KEY = `workfence.v${SEED_VERSION}`;
// Must match the version stamped by buildSeedState() in seed.ts.


let idCounter = Math.floor(Math.random() * 1e6);
const rid = (p: string) => `${p}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/** Default contracted shift for a freshly provisioned company: 9-to-6. */
const DEFAULT_SHIFT = { start: 9 * 60, end: 18 * 60 };

/**
 * Employee-code prefix from a company name: "Nachi Tekneka" -> "NT".
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
  checkOut: (selfie: string | null) => { ok: boolean; reason?: string };
  liveTrail: LocationPoint[];

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
  resetDemo: () => void;
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
        if (parsed.version === SEED_VERSION) next = parsed;
      }
    } catch {
      /* corrupted storage → reseed */
    }
    if (!next) next = buildSeedState();
    // One-time client hydration: localStorage isn't available during SSR,
    // so the initial state has to land in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(next);

    // Live mode: replace the seeded people/projects/attendance with the
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
        id: rid("pt"),
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

  /* Outbox sync when connectivity returns. */
  useEffect(() => {
    if (!online) return;
    const s = stateRef.current;
    if (!s || s.outbox.length === 0) return;
    const count = s.outbox.length;
    const t = window.setTimeout(() => {
      mutate((prev) => ({
        ...prev,
        outbox: [],
        points: prev.points.map((p) => (p.queued ? { ...p, queued: undefined } : p)),
        updates: prev.updates.map((u) =>
          u.status === "queued" ? { ...u, status: "synced" } : u,
        ),
      }));
      const sess = stateRef.current?.session;
      pushNotification({
        audience: "employee",
        userId: sess?.userId,
        kind: "sync",
        title: "Back online — data synced",
        body: `${count} queued record${count === 1 ? "" : "s"} uploaded successfully.`,
        severity: "success",
      });
    }, 1600);
    return () => window.clearTimeout(t);
  }, [online, state?.outbox.length, mutate, pushNotification]);

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
      const late =
        mark.at >
        new Date(`${today}T00:00:00`).getTime() +
          (project.rules.shiftStart + project.rules.lateGraceMinutes) * 60000;

      const att: Attendance = {
        id: rid("att"),
        employeeId: user.id,
        projectId: project.id,
        date: today,
        checkIn: mark,
        distanceMeters: 0,
        status: late ? "late" : "present",
        events: [],
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
    (selfie: string | null): { ok: boolean; reason?: string } => {
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
      const worked = Math.round((at - shift.checkIn!.at) / 60000);
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
            ? { ...a, checkOut: mark, workedMinutes: worked, status }
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
      pushNotification({
        audience: "manager",
        kind: "check-out",
        title: `${user.name} checked out`,
        body: `${project.name} · ${Math.floor(worked / 60)}h ${worked % 60}m worked`,
        severity: early ? "warning" : "info",
      });
      return { ok: true };
    },
    [mutate, pushNotification],
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
        id: rid("wu"),
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

  const setUserRole = useCallback(
    (userId: string, role: Role) => {
      mutate((s) => {
        const target = s.users.find((u) => u.id === userId);
        // The seeded product owner cannot be demoted — someone must hold the keys.
        if (!target || target.id === "usr_owner") return s;
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
          id: rid("usr"),
          orgId: patch.orgId ?? currentOrgId(s),
          name: patch.name,
          employeeCode: patch.employeeCode ?? `NT-${String(Math.floor(Math.random() * 900) + 100)}`,
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
      return saved!;
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
    },
    [mutate],
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
    },
    [mutate],
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
          id: rid("proj"),
          orgId: patch.orgId ?? currentOrgId(s),
          kind: patch.kind ?? "site",
          // Defaults to recording the whole shift: the stricter policy is the
          // safer thing to arrive at by accident, and turning it off is a
          // deliberate choice the manager makes at creation.
          trackingMode: patch.trackingMode ?? "full-shift",
          code: patch.code ?? `NT-CW-${Math.floor(Math.random() * 900) + 100}`,
          name: patch.name,
          client: patch.client ?? "",
          address: patch.address ?? "",
          siteContact: patch.siteContact ?? "",
          siteContactPhone: patch.siteContactPhone ?? "",
          managerId: s.session?.userId ?? "usr_manager",
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
      return saved!;
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
      const orgId = rid("org");
      const adminId = rid("usr");
      const siteId = rid("proj");
      const officeId = draft.office ? rid("proj") : null;
      const premiseIds = [siteId, ...(officeId ? [officeId] : [])];

      const crew: User[] = draft.crew.map((c, i) => ({
        id: rid("usr"),
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

      mutate((s) => {
        // Idempotent: React may invoke an updater twice, and provisioning a
        // company twice would double the whole tenant.
        if (s.users.some((u) => u.id === adminId)) return s;
        return {
          ...s,
          users: [...s.users, admin, ...crew],
          projects: [...s.projects, site, ...(office ? [office] : [])],
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

  const resetDemo = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
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
    resetDemo,
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
