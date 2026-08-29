/**
 * Derived analytics — dashboard KPIs, timelines, dwell detection and the
 * transparent performance score. Pure functions over the store state.
 */

import { distanceMeters, resolvePlace } from "./geo";
import { isoAddDays, todayISO } from "./format";
import type {
  Attendance,
  DwellSegment,
  LocationPoint,
  Project,
  User,
  WorkUpdate,
  WorkforceState,
} from "./types";

/* ------------------------------------------------------------- dashboard */

export interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  workforce: number;
  presentToday: number;
  checkedIn: number;
  checkedOut: number;
  currentlyWorking: number;
  lateToday: number;
  earlyOutToday: number;
  missingCheckout: number;
  absentToday: number;
  attendancePct: number;
  avgWorkedMinutes: number;
  updatesToday: number;
}

export function dashboardStats(s: WorkforceState, now = Date.now()): DashboardStats {
  const today = todayISO(now);
  const employees = s.users.filter((u) => u.role === "employee" && u.status === "active");
  const todays = s.attendance.filter((a) => a.date === today);
  const withIn = todays.filter((a) => a.checkIn);
  const out = withIn.filter((a) => a.checkOut);
  const working = withIn.filter((a) => !a.checkOut && !a.autoClosed);
  const closed = s.attendance.filter((a) => a.workedMinutes != null && a.date === today);
  const avg =
    closed.length > 0
      ? closed.reduce((t, a) => t + (a.workedMinutes ?? 0), 0) / closed.length
      : 0;
  return {
    totalProjects: s.projects.length,
    activeProjects: s.projects.filter((p) => p.status === "active").length,
    workforce: employees.length,
    presentToday: withIn.length,
    checkedIn: withIn.length,
    checkedOut: out.length,
    currentlyWorking: working.length,
    lateToday: todays.filter((a) => a.status === "late").length,
    earlyOutToday: todays.filter((a) => a.status === "early-checkout").length,
    missingCheckout: s.attendance.filter((a) => a.status === "missing-checkout").length,
    absentToday: todays.filter((a) => a.status === "absent").length,
    attendancePct: employees.length ? (withIn.length / employees.length) * 100 : 0,
    avgWorkedMinutes: avg,
    updatesToday: s.updates.filter((u) => u.date === today).length,
  };
}

/** Attendance % + hours over the trailing `days`, for trend charts. */
export function attendanceTrend(
  s: WorkforceState,
  days: number,
  projectId?: string,
  now = Date.now(),
): Array<{ date: string; presentPct: number; avgHours: number }> {
  const employees = s.users.filter((u) => u.role === "employee");
  const pool = projectId
    ? employees.filter((e) => e.projectIds.includes(projectId))
    : employees;
  const out: Array<{ date: string; presentPct: number; avgHours: number }> = [];
  const today = todayISO(now);
  for (let d = days - 1; d >= 0; d--) {
    const date = isoAddDays(today, -d);
    const recs = s.attendance.filter(
      (a) =>
        a.date === date &&
        a.checkIn &&
        (!projectId || a.projectId === projectId),
    );
    const worked = recs.filter((a) => a.workedMinutes != null);
    out.push({
      date,
      presentPct: pool.length ? (recs.length / pool.length) * 100 : 0,
      avgHours: worked.length
        ? worked.reduce((t, a) => t + (a.workedMinutes ?? 0), 0) / worked.length / 60
        : 0,
    });
  }
  return out;
}

/* --------------------------------------------------------- trail analysis */

export function trailFor(s: WorkforceState, attendanceId: string): LocationPoint[] {
  return s.points
    .filter((p) => p.attendanceId === attendanceId)
    .sort((a, b) => a.at - b.at);
}

/**
 * Collapse a trail into dwell segments: consecutive fixes within `radius`
 * metres of a rolling centroid for at least `minMinutes`.
 */
export function dwellSegments(
  trail: LocationPoint[],
  project: Project,
  radius = 35,
  minMinutes = 12,
): DwellSegment[] {
  const out: DwellSegment[] = [];
  let anchor: LocationPoint | null = null;
  let start = 0;
  let sumLat = 0;
  let sumLng = 0;
  let n = 0;

  const flush = (endAt: number) => {
    if (!anchor || n === 0) return;
    const minutes = (endAt - start) / 60000;
    if (minutes < minMinutes) return;
    const center = { lat: sumLat / n, lng: sumLng / n };
    out.push({
      start,
      end: endAt,
      center,
      place: resolvePlace(center, project.zones, project.location),
      minutes,
    });
  };

  for (const p of trail) {
    const here = { lat: p.lat, lng: p.lng };
    if (!anchor) {
      anchor = p; start = p.at; sumLat = p.lat; sumLng = p.lng; n = 1;
      continue;
    }
    const center = { lat: sumLat / n, lng: sumLng / n };
    if (distanceMeters(center, here) <= radius) {
      sumLat += p.lat; sumLng += p.lng; n++;
    } else {
      flush(p.at);
      anchor = p; start = p.at; sumLat = p.lat; sumLng = p.lng; n = 1;
    }
  }
  if (trail.length) flush(trail[trail.length - 1].at);
  return out;
}

export interface TimelineEntry {
  at: number;
  end?: number;
  label: string;
  detail?: string;
  kind: "check-in" | "check-out" | "dwell" | "move" | "event" | "update" | "break";
  coords?: { lat: number; lng: number };
}

/** Merge attendance marks, dwells, shift events and updates into one feed. */
export function buildTimeline(
  att: Attendance,
  trail: LocationPoint[],
  project: Project,
  updates: WorkUpdate[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  if (att.checkIn) {
    entries.push({
      at: att.checkIn.at,
      label: `Checked in — ${att.checkIn.place}`,
      kind: "check-in",
      coords: att.checkIn.coords,
    });
  }
  for (const d of dwellSegments(trail, project)) {
    entries.push({
      at: d.start,
      end: d.end,
      label: d.place,
      detail: `${Math.round(d.minutes)} min on location`,
      kind: "dwell",
      coords: d.center,
    });
  }
  for (const ev of att.events) {
    entries.push({ at: ev.at, label: ev.detail, kind: "event" });
  }
  for (const b of att.breaks ?? []) {
    entries.push({
      at: b.start,
      label: "Break started",
      kind: "break",
      coords: b.coordsStart,
    });
    if (b.end) {
      entries.push({
        at: b.end,
        label: "Break ended",
        detail: `${Math.round((b.end - b.start) / 60000)} min`,
        kind: "break",
        coords: b.coordsEnd,
      });
    }
  }
  for (const u of updates.filter((x) => x.attendanceId === att.id && x.kind === "shift")) {
    entries.push({
      at: u.at,
      label: `Update — ${u.category}`,
      detail: u.description,
      kind: "update",
      coords: u.coords,
    });
  }
  if (att.checkOut) {
    entries.push({
      at: att.checkOut.at,
      label: `Checked out — ${att.checkOut.place}`,
      kind: "check-out",
      coords: att.checkOut.coords,
    });
  }
  return entries.sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------ performance */

export interface PerformanceBreakdown {
  attendance: number;   // 0–100, weight 30
  punctuality: number;  // 0–100, weight 20
  hours: number;        // 0–100, weight 15
  updates: number;      // 0–100, weight 20
  supervisor: number;   // 0–100, weight 15
  overall: number;      // weighted 0–100
  attendancePct: number;
  avgWorkedMinutes: number;
  updateCount: number;
  lateCount: number;
  presentDays: number;
  scheduledDays: number;
}

export const PERFORMANCE_WEIGHTS = {
  attendance: 0.3,
  punctuality: 0.2,
  hours: 0.15,
  updates: 0.2,
  supervisor: 0.15,
} as const;

/**
 * Transparent score: each component is 0–100 with published weights.
 * GPS distance is deliberately NOT an input — movement is a presence
 * signal, not a productivity measure.
 */
export function performanceFor(
  s: WorkforceState,
  user: User,
  days = 14,
  now = Date.now(),
): PerformanceBreakdown {
  const today = todayISO(now);
  const from = isoAddDays(today, -(days - 1));
  const recs = s.attendance.filter(
    (a) => a.employeeId === user.id && a.date >= from && a.date <= today,
  );
  const scheduled = recs.length; // seed skips Sundays, so records = scheduled days
  const present = recs.filter((a) => a.checkIn);
  const late = recs.filter((a) => a.status === "late");
  const closed = recs.filter((a) => a.workedMinutes != null);
  const avgWorked = closed.length
    ? closed.reduce((t, a) => t + (a.workedMinutes ?? 0), 0) / closed.length
    : 0;
  const expected = user.shiftEnd - user.shiftStart;
  const ups = s.updates.filter(
    (u) => u.employeeId === user.id && u.date >= from && u.date <= today,
  );

  const attendance = scheduled ? (present.length / scheduled) * 100 : 0;
  const punctuality = present.length
    ? ((present.length - late.length) / present.length) * 100
    : 0;
  const hours = expected ? Math.min(100, (avgWorked / expected) * 100) : 0;
  const updates = Math.min(100, (ups.length / (present.length || 1)) * 65);
  const supervisor = ((user.supervisorRating ?? 3.5) / 5) * 100;

  const overall =
    attendance * PERFORMANCE_WEIGHTS.attendance +
    punctuality * PERFORMANCE_WEIGHTS.punctuality +
    hours * PERFORMANCE_WEIGHTS.hours +
    updates * PERFORMANCE_WEIGHTS.updates +
    supervisor * PERFORMANCE_WEIGHTS.supervisor;

  return {
    attendance, punctuality, hours, updates, supervisor,
    overall,
    attendancePct: attendance,
    avgWorkedMinutes: avgWorked,
    updateCount: ups.length,
    lateCount: late.length,
    presentDays: present.length,
    scheduledDays: scheduled,
  };
}

/** Employees ranked worst-first on the signals a manager should act on. */
export function needsAttention(
  s: WorkforceState,
  now = Date.now(),
): Array<{ user: User; reasons: string[]; score: number }> {
  const out: Array<{ user: User; reasons: string[]; score: number }> = [];
  for (const user of s.users.filter((u) => u.role === "employee" && u.status === "active")) {
    const perf = performanceFor(s, user, 14, now);
    const reasons: string[] = [];
    if (perf.attendancePct < 75) reasons.push(`Attendance ${Math.round(perf.attendancePct)}%`);
    if (perf.lateCount >= 3) reasons.push(`${perf.lateCount} late check-ins`);
    const missing = s.attendance.filter(
      (a) => a.employeeId === user.id && a.status === "missing-checkout",
    ).length;
    if (missing > 0) reasons.push(`${missing} missing checkout${missing > 1 ? "s" : ""}`);
    if (perf.updates < 30) reasons.push("Few work updates");
    if (reasons.length) out.push({ user, reasons, score: perf.overall });
  }
  return out.sort((a, b) => a.score - b.score);
}

/** Live board: every employee's status right now, for the workforce map. */
export interface LiveStatus {
  user: User;
  project: Project | null;
  attendance: Attendance | null;
  lastPoint: LocationPoint | null;
  place: string;
  state: "working" | "checked-out" | "absent" | "not-in";
  workedMs: number;
}

export function liveBoard(s: WorkforceState, projectId?: string, now = Date.now()): LiveStatus[] {
  const today = todayISO(now);
  return s.users
    .filter(
      (u) =>
        u.role === "employee" &&
        u.status === "active" &&
        (!projectId || u.projectIds.includes(projectId)),
    )
    .map((user): LiveStatus => {
      const att =
        s.attendance.find(
          (a) => a.employeeId === user.id && a.date === today && a.checkIn,
        ) ?? null;
      const project =
        s.projects.find((p) => p.id === (att?.projectId ?? user.projectIds[0])) ?? null;
      const trail = att ? trailFor(s, att.id) : [];
      const lastPoint = trail[trail.length - 1] ?? null;
      const working = !!att && !att.checkOut && !att.autoClosed;
      const place =
        lastPoint && project
          ? resolvePlace({ lat: lastPoint.lat, lng: lastPoint.lng }, project.zones, project.location)
          : "—";
      return {
        user,
        project,
        attendance: att,
        lastPoint,
        place,
        state: working
          ? "working"
          : att?.checkOut
            ? "checked-out"
            : att
              ? "checked-out"
              : s.attendance.some((a) => a.employeeId === user.id && a.date === today)
                ? "absent"
                : "not-in",
        workedMs: att
          ? (att.checkOut?.at ?? now) - (att.checkIn?.at ?? now)
          : 0,
      };
    });
}

/**
 * Today's register, split by how each day was recorded.
 *
 * Derived from the attendance rows themselves rather than counted
 * separately, which is the only way the arithmetic can be trusted: a group
 * capture does not create a parallel register, it creates ordinary
 * attendance rows that happen to say who marked them. So "individual +
 * group = total" holds by construction, and a worker photographed after
 * they had already checked in is still one person.
 */
export interface AttendanceSources {
  individual: number;
  group: number;
  manual: number;
  total: number;
}

export function attendanceSources(
  s: WorkforceState,
  date?: string,
  projectId?: string,
): AttendanceSources {
  const day = date ?? todayISO();
  const rows = s.attendance.filter(
    (a) =>
      a.date === day &&
      !!a.checkIn &&
      (!projectId || a.projectId === projectId),
  );
  let group = 0;
  let manual = 0;
  for (const a of rows) {
    if (a.markedBy?.method === "group-photo") group += 1;
    else if (a.markedBy?.method === "manual") manual += 1;
  }
  return {
    individual: rows.length - group - manual,
    group,
    manual,
    total: rows.length,
  };
}
