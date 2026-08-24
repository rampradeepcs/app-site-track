/**
 * Deterministic demo dataset for SiteTrack.
 *
 * Everything is generated from a seeded PRNG so the app boots with a rich,
 * repeatable 14-day history (attendance, GPS trails, work updates,
 * notifications) without any backend. Real check-ins/route points recorded in
 * the browser are layered on top by the store.
 */

import {
  distanceMeters,
  offsetMeters,
  resolvePlace,
} from "./geo";
import { isoAddDays, todayISO } from "./format";
import type {
  AppNotification,
  Attendance,
  AttendanceStatus,
  LatLng,
  LocationPoint,
  Project,
  ShiftEvent,
  User,
  WorkCategory,
  WorkUpdate,
  WorkforceState,
} from "./types";

/* ----------------------------------------------------------- seeded RNG */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uid = 1000;
const nextId = (prefix: string) => `${prefix}_${(uid++).toString(36)}`;

/** Generated SVG selfie placeholder — keeps records self-contained. */
export function makeSelfie(name: string, hue: number, label: string): string {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="hsl(${hue} 42% 22%)"/><circle cx="120" cy="92" r="44" fill="hsl(${hue} 55% 62%)"/><rect x="48" y="150" width="144" height="70" rx="34" fill="hsl(${hue} 55% 62%)"/><text x="120" y="106" font-family="system-ui" font-size="34" font-weight="700" fill="hsl(${hue} 45% 16%)" text-anchor="middle">${initials}</text><text x="120" y="228" font-family="system-ui" font-size="17" fill="rgba(255,255,255,0.85)" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* ------------------------------------------------------------- projects */

// Peelamedu, Coimbatore — matches the Nachi Tekneka home base.
const SITE_A: LatLng = { lat: 11.0273, lng: 77.0037 };
// Saravanampatti tech corridor.
const SITE_B: LatLng = { lat: 11.0794, lng: 76.9997 };

function polygonAround(center: LatLng, radii: number[], rot = 0): LatLng[] {
  return radii.map((r, i) =>
    offsetMeters(center, r, rot + (360 / radii.length) * i),
  );
}

function buildProjects(managerId: string): Project[] {
  const a: Project = {
    id: "proj_abc",
    code: "NT-CW-101",
    name: "ABC Construction Site",
    client: "ABC Infra Developers",
    address: "Avinashi Road, Peelamedu, Coimbatore 641004",
    siteContact: "S. Manikandan",
    siteContactPhone: "+91 96003 09378",
    managerId,
    startDate: "2026-02-02",
    endDate: "2027-06-30",
    status: "active",
    description:
      "G+14 residential tower — structural works phase. Two tower cranes, batching on site.",
    location: SITE_A,
    geofence: {
      kind: "polygon",
      polygon: polygonAround(SITE_A, [170, 150, 185, 160, 175, 145, 190, 155], 12),
      center: SITE_A,
      radius: 170,
      bufferMeters: 40,
    },
    zones: [
      { id: "z_gate", name: "Main Gate", center: offsetMeters(SITE_A, 150, 200), radius: 32, kind: "access" },
      { id: "z_a", name: "Block A", center: offsetMeters(SITE_A, 92, 320), radius: 45, kind: "work" },
      { id: "z_b", name: "Block B", center: offsetMeters(SITE_A, 78, 55), radius: 45, kind: "work" },
      { id: "z_c", name: "Block C", center: offsetMeters(SITE_A, 105, 120), radius: 42, kind: "work" },
      { id: "z_yard", name: "Material Yard", center: offsetMeters(SITE_A, 118, 262), radius: 40, kind: "material" },
      { id: "z_batch", name: "Batching Plant", center: offsetMeters(SITE_A, 128, 165), radius: 34, kind: "material" },
      { id: "z_lunch", name: "Lunch Area", center: offsetMeters(SITE_A, 60, 250), radius: 26, kind: "welfare" },
      { id: "z_office", name: "Site Office", center: offsetMeters(SITE_A, 118, 218), radius: 26, kind: "welfare" },
    ],
    employeeIds: [],
    rules: {
      shiftStart: 8 * 60 + 30,
      shiftEnd: 17 * 60 + 30,
      lateGraceMinutes: 15,
      minShiftMinutes: 7 * 60,
      exitAlertMinutes: 10,
      autoCheckoutHours: 14,
    },
    createdAt: Date.parse("2026-02-01T09:00:00+05:30"),
  };

  const b: Project = {
    id: "proj_skyline",
    code: "NT-CW-104",
    name: "Skyline Tech Park — Phase 2",
    client: "Skyline Estates",
    address: "Saravanampatti, Coimbatore 641035",
    siteContact: "R. Priya",
    siteContactPhone: "+91 98430 11224",
    managerId,
    startDate: "2026-04-15",
    endDate: "2027-12-20",
    status: "active",
    description:
      "Twin office blocks with podium parking — excavation complete, raft foundation in progress.",
    location: SITE_B,
    geofence: {
      kind: "circle",
      polygon: [],
      center: SITE_B,
      radius: 210,
      bufferMeters: 50,
    },
    zones: [
      { id: "zb_gate", name: "Gate 1", center: offsetMeters(SITE_B, 185, 175), radius: 34, kind: "access" },
      { id: "zb_raft", name: "Raft Zone", center: offsetMeters(SITE_B, 70, 20), radius: 55, kind: "work" },
      { id: "zb_pod", name: "Podium", center: offsetMeters(SITE_B, 95, 290), radius: 48, kind: "work" },
      { id: "zb_steel", name: "Steel Yard", center: offsetMeters(SITE_B, 140, 95), radius: 42, kind: "material" },
      { id: "zb_rest", name: "Rest Shed", center: offsetMeters(SITE_B, 120, 220), radius: 26, kind: "welfare" },
    ],
    employeeIds: [],
    rules: {
      shiftStart: 9 * 60,
      shiftEnd: 18 * 60,
      lateGraceMinutes: 10,
      minShiftMinutes: 7 * 60,
      exitAlertMinutes: 10,
      autoCheckoutHours: 14,
    },
    createdAt: Date.parse("2026-04-10T09:00:00+05:30"),
  };
  return [a, b];
}

/* ---------------------------------------------------------------- users */

const EMPLOYEE_SPECS: Array<{
  name: string; code: string; designation: string; department: string; hue: number; phone: string;
}> = [
  { name: "Arun Kumar", code: "NT-0214", designation: "Site Supervisor", department: "Civil", hue: 16, phone: "+91 98942 10214" },
  { name: "Kumar Selvan", code: "NT-0221", designation: "Steel Fixer", department: "Civil", hue: 205, phone: "+91 98942 10221" },
  { name: "Suresh Babu", code: "NT-0228", designation: "Electrician", department: "MEP", hue: 45, phone: "+91 98942 10228" },
  { name: "Ravi Shankar", code: "NT-0235", designation: "Mason — Grade A", department: "Civil", hue: 130, phone: "+91 98942 10235" },
  { name: "Meena Devi", code: "NT-0242", designation: "Safety Officer", department: "EHS", hue: 285, phone: "+91 98942 10242" },
  { name: "Vijay Anand", code: "NT-0249", designation: "Plumber", department: "MEP", hue: 340, phone: "+91 98942 10249" },
  { name: "Karthik Raja", code: "NT-0256", designation: "Crane Operator", department: "Plant", hue: 190, phone: "+91 98942 10256" },
  { name: "Lakshmi Priya", code: "NT-0263", designation: "QA/QC Engineer", department: "Quality", hue: 260, phone: "+91 98942 10263" },
];

function buildUsers(): User[] {
  const manager: User = {
    id: "usr_manager",
    name: "Rajesh Narayanan",
    employeeCode: "NT-0101",
    role: "manager",
    designation: "Project Manager",
    department: "Projects",
    phone: "+91 96003 09378",
    email: "rajesh@nachitekneka.com",
    avatarHue: 8,
    status: "active",
    projectIds: ["proj_abc", "proj_skyline"],
    shiftStart: 8 * 60,
    shiftEnd: 18 * 60,
    joinedAt: Date.parse("2024-06-01T09:00:00+05:30"),
  };
  const employees = EMPLOYEE_SPECS.map((s, i): User => ({
    id: `usr_${s.code.toLowerCase().replace("-", "")}`,
    name: s.name,
    employeeCode: s.code,
    role: "employee",
    designation: s.designation,
    department: s.department,
    phone: s.phone,
    avatarHue: s.hue,
    status: "active",
    projectIds: i < 5 ? ["proj_abc"] : ["proj_skyline"],
    shiftStart: i < 5 ? 8 * 60 + 30 : 9 * 60,
    shiftEnd: i < 5 ? 17 * 60 + 30 : 18 * 60,
    joinedAt: Date.parse("2025-11-10T09:00:00+05:30") + i * 86400000,
    supervisorRating: 3.4 + ((i * 37) % 16) / 10,
  }));
  return [manager, ...employees];
}

/* ----------------------------------------------------- movement synthesis */

const CATEGORY_BY_DEPT: Record<string, WorkCategory[]> = {
  Civil: ["Civil Work", "Material Handling", "Supervision"],
  MEP: ["Electrical", "Plumbing", "Quality Inspection"],
  EHS: ["Safety", "Site Inspection", "Documentation"],
  Plant: ["Material Handling", "Other", "Safety"],
  Quality: ["Quality Inspection", "Site Inspection", "Documentation"],
};

const UPDATE_LINES = [
  "Concrete reinforcement inspection completed for the day's pour.",
  "Shuttering aligned and checked against drawings.",
  "Cable tray runs completed on the working level.",
  "Slab pour supervised; vibrator coverage verified.",
  "Toolbox talk conducted — full PPE compliance on deck.",
  "Material reconciliation done at the yard; steel stock updated.",
  "Pressure test on riser line held for 30 minutes, no drop.",
  "Crane lifts sequenced with the steel gang; no idle time.",
  "Cube samples cast and tagged for 7-day testing.",
  "Snag list items from yesterday's walk closed out.",
];

interface DayPlan {
  status: AttendanceStatus;
  inOffset: number;   // minutes vs shift start (negative = early)
  outOffset: number;  // minutes vs shift end
  missingOut?: boolean;
}

function planDay(rng: () => number, isToday: boolean): DayPlan | null {
  const r = rng();
  if (!isToday && r > 0.94) return null; // absent
  const late = r > 0.8;
  const inOffset = late ? 18 + rng() * 45 : -12 + rng() * 20;
  const r2 = rng();
  const early = r2 > 0.88;
  const outOffset = early ? -(60 + rng() * 90) : -10 + rng() * 35;
  const missingOut = !isToday && rng() > 0.97;
  let status: AttendanceStatus = "present";
  if (late) status = "late";
  else if (early) status = "early-checkout";
  if (missingOut) status = "missing-checkout";
  return { status, inOffset, outOffset, missingOut };
}

/** Walk a worker gate → zones → gate, emitting fixes every ~2.5 min. */
function synthTrail(
  rng: () => number,
  project: Project,
  attendanceId: string,
  employeeId: string,
  start: number,
  end: number,
  openShift = false,
): { points: LocationPoint[]; distance: number } {
  const gate = project.zones.find((z) => z.kind === "access")?.center ?? project.location;
  const workZones = project.zones.filter((z) => z.kind !== "access");
  const stops: Array<{ at: LatLng; until: number }> = [];
  // Build an itinerary of dwell stops across the shift.
  const legs = 4 + Math.floor(rng() * 4);
  let t = start;
  const shiftLen = end - start;
  for (let i = 0; i < legs; i++) {
    const zone = workZones[Math.floor(rng() * workZones.length)];
    const jitter = offsetMeters(zone.center, rng() * zone.radius * 0.7, rng() * 360);
    const dwellEnd = start + (shiftLen * (i + 1)) / (legs + 0.5);
    stops.push({ at: jitter, until: dwellEnd });
    t = dwellEnd;
  }
  void t;

  const points: LocationPoint[] = [];
  let cursor: LatLng = gate;
  let clock = start;
  let distance = 0;
  const stepMs = 150000; // 2.5 min cadence

  const emit = (p: LatLng, speed: number) => {
    points.push({
      id: nextId("pt"),
      attendanceId,
      employeeId,
      projectId: project.id,
      lat: p.lat,
      lng: p.lng,
      accuracy: 4 + rng() * 14,
      speed,
      heading: rng() * 360,
      at: clock,
    });
  };
  emit(gate, 0);

  for (const stop of stops) {
    // Travel to the stop in ~1.1 m/s strides.
    const legDist = distanceMeters(cursor, stop.at);
    const travelMs = Math.max(stepMs, (legDist / 1.1) * 1000);
    const steps = Math.max(1, Math.round(travelMs / stepMs));
    for (let s = 1; s <= steps && clock < end; s++) {
      clock += stepMs;
      const f = s / steps;
      const wobble = offsetMeters(
        {
          lat: cursor.lat + (stop.at.lat - cursor.lat) * f,
          lng: cursor.lng + (stop.at.lng - cursor.lng) * f,
        },
        rng() * 6,
        rng() * 360,
      );
      const prev = points[points.length - 1];
      distance += distanceMeters({ lat: prev.lat, lng: prev.lng }, wobble);
      emit(wobble, 0.7 + rng() * 0.9);
    }
    cursor = stop.at;
    // Dwell: sparse, near-stationary fixes.
    while (clock + stepMs < Math.min(stop.until, end)) {
      clock += stepMs * (1 + Math.floor(rng() * 2));
      const drift = offsetMeters(cursor, rng() * 5, rng() * 360);
      const prev = points[points.length - 1];
      distance += distanceMeters({ lat: prev.lat, lng: prev.lng }, drift);
      emit(drift, rng() * 0.3);
    }
  }
  // Walk back to the gate for checkout (skip while the shift is open —
  // the worker is still out in the zones).
  const backSteps = openShift
    ? 0
    : Math.max(2, Math.round(distanceMeters(cursor, gate) / 90));
  for (let s = 1; s <= backSteps; s++) {
    clock = Math.min(end, clock + stepMs);
    const f = s / backSteps;
    const p = {
      lat: cursor.lat + (gate.lat - cursor.lat) * f,
      lng: cursor.lng + (gate.lng - cursor.lng) * f,
    };
    const prev = points[points.length - 1];
    distance += distanceMeters({ lat: prev.lat, lng: prev.lng }, p);
    emit(p, 1 + rng() * 0.5);
  }
  return { points, distance };
}

/* ------------------------------------------------------------- assembler */

export function buildSeedState(now = Date.now()): WorkforceState {
  const rng = mulberry32(0x5eed1e);
  const users = buildUsers();
  const manager = users[0];
  const projects = buildProjects(manager.id);
  const employees = users.filter((u) => u.role === "employee");
  for (const p of projects) {
    p.employeeIds = employees.filter((e) => e.projectIds.includes(p.id)).map((e) => e.id);
  }

  const attendance: Attendance[] = [];
  const points: LocationPoint[] = [];
  const updates: WorkUpdate[] = [];
  const notifications: AppNotification[] = [];

  const today = todayISO(now);
  const DAYS = 14;

  for (let d = DAYS; d >= 0; d--) {
    const date = isoAddDays(today, -d);
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const isToday = d === 0;
    if (weekday === 0) continue; // Sunday — site holiday

    for (const emp of employees) {
      // Keep the demo employee's day open so the full check-in flow can be
      // walked live (Arun Kumar has no record yet today).
      if (isToday && emp.id === "usr_nt0214") continue;
      const project = projects.find((p) => emp.projectIds.includes(p.id))!;
      const plan = planDay(rng, isToday);
      if (!plan) {
        attendance.push({
          id: nextId("att"), employeeId: emp.id, projectId: project.id, date,
          distanceMeters: 0, status: "absent", events: [],
        });
        continue;
      }
      const inAt = dayStart + (project.rules.shiftStart + plan.inOffset) * 60000;
      let outAt = dayStart + (project.rules.shiftEnd + plan.outOffset) * 60000;

      // Today: some employees are still on shift, some not yet in.
      const stillWorking = isToday && now < outAt;
      const notYetIn = isToday && now < inAt;
      if (notYetIn) continue; // no record yet today
      if (stillWorking) outAt = now;

      const att: Attendance = {
        id: nextId("att"),
        employeeId: emp.id,
        projectId: project.id,
        date,
        distanceMeters: 0,
        status: plan.status,
        events: [],
      };

      const gate = project.zones.find((z) => z.kind === "access");
      const gateName = gate?.name ?? "Site entrance";
      att.checkIn = {
        at: inAt,
        coords: gate?.center ?? project.location,
        accuracy: 5 + rng() * 10,
        selfie: makeSelfie(emp.name, emp.avatarHue, "Check-in"),
        place: gateName,
        insideGeofence: true,
      };

      const trail = synthTrail(rng, project, att.id, emp.id, inAt, outAt, stillWorking);
      points.push(...trail.points);
      att.distanceMeters = Math.round(trail.distance);

      // A few shifts include a recorded geofence exit + return.
      if (rng() > 0.9 && !isToday) {
        const exitAt = inAt + (outAt - inAt) * (0.3 + rng() * 0.3);
        const events: ShiftEvent[] = [
          { id: nextId("ev"), at: exitAt, kind: "geofence-exit", detail: "Left site boundary near " + gateName },
          { id: nextId("ev"), at: exitAt + 22 * 60000, kind: "geofence-return", detail: "Re-entered site boundary" },
        ];
        att.events = events;
      }

      if (!stillWorking) {
        if (plan.missingOut) {
          att.status = "missing-checkout";
          att.events.push({
            id: nextId("ev"), at: dayStart + project.rules.autoCheckoutHours * 3600000 + project.rules.shiftStart * 60000,
            kind: "auto-checkout", detail: "Session auto-closed — no checkout recorded",
          });
          att.autoClosed = true;
          att.workedMinutes = undefined;
        } else {
          const last = trail.points[trail.points.length - 1];
          att.checkOut = {
            at: outAt,
            coords: { lat: last.lat, lng: last.lng },
            accuracy: 5 + rng() * 10,
            selfie: makeSelfie(emp.name, emp.avatarHue, "Checkout"),
            place: resolvePlace({ lat: last.lat, lng: last.lng }, project.zones, project.location),
            insideGeofence: true,
          };
          att.workedMinutes = Math.round((outAt - inAt) / 60000);
        }
      }
      attendance.push(att);

      // Work updates: one or two shift updates + a daily summary when done.
      const cats = CATEGORY_BY_DEPT[emp.department] ?? ["Other"];
      const nUpdates = 1 + Math.floor(rng() * 2);
      for (let u = 0; u < nUpdates; u++) {
        const at = inAt + (outAt - inAt) * (0.25 + 0.5 * rng());
        const near = trail.points.reduce((best, p) =>
          Math.abs(p.at - at) < Math.abs(best.at - at) ? p : best,
        );
        const coords = { lat: near.lat, lng: near.lng };
        updates.push({
          id: nextId("wu"), employeeId: emp.id, projectId: project.id, attendanceId: att.id,
          date, at, category: cats[Math.floor(rng() * cats.length)], kind: "shift",
          description: UPDATE_LINES[Math.floor(rng() * UPDATE_LINES.length)],
          photos: [], coords,
          place: resolvePlace(coords, project.zones, project.location),
          status: "synced",
        });
      }
      if (!stillWorking && !plan.missingOut && rng() > 0.15) {
        updates.push({
          id: nextId("wu"), employeeId: emp.id, projectId: project.id, attendanceId: att.id,
          date, at: outAt + 4 * 60000, category: cats[0], kind: "daily",
          description: UPDATE_LINES[Math.floor(rng() * UPDATE_LINES.length)],
          completed: "Planned scope for the day closed out.",
          inProgress: "Carry-over finishing works on the active level.",
          blockers: rng() > 0.7 ? "Waiting on rebar delivery for next pour." : "",
          materials: rng() > 0.6 ? "Binding wire, cover blocks (50mm)." : "",
          safety: rng() > 0.5 ? "Edge protection checked on working deck." : "",
          tomorrow: "Continue as per weekly plan.",
          photos: [], status: "synced",
        });
      }
    }
  }

  /* Recent notifications for the manager feed. */
  const todaysAtt = attendance.filter((a) => a.date === today && a.checkIn);
  for (const a of todaysAtt.slice(0, 8)) {
    const emp = users.find((u) => u.id === a.employeeId)!;
    const proj = projects.find((p) => p.id === a.projectId)!;
    notifications.push({
      id: nextId("ntf"), audience: "manager", kind: a.status === "late" ? "late-check-in" : "check-in",
      title: a.status === "late" ? `Late check-in — ${emp.name}` : `${emp.name} checked in`,
      body: `${proj.name} · ${new Date(a.checkIn!.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
      at: a.checkIn!.at, read: rng() > 0.5,
      severity: a.status === "late" ? "warning" : "info",
    });
    if (a.checkOut) {
      notifications.push({
        id: nextId("ntf"), audience: "manager", kind: "check-out",
        title: `${emp.name} checked out`,
        body: `${proj.name} · ${Math.round((a.workedMinutes ?? 0) / 60)}h worked`,
        at: a.checkOut.at, read: rng() > 0.4, severity: "info",
      });
    }
  }
  const missing = attendance.filter((a) => a.status === "missing-checkout").slice(-2);
  for (const a of missing) {
    const emp = users.find((u) => u.id === a.employeeId)!;
    notifications.push({
      id: nextId("ntf"), audience: "manager", kind: "missing-checkout",
      title: `Missing checkout — ${emp.name}`,
      body: `No checkout recorded on ${a.date}. Session auto-closed.`,
      at: (a.checkIn?.at ?? now) + 10 * 3600000, read: false, severity: "critical",
    });
  }
  notifications.sort((a, b) => b.at - a.at);

  return {
    version: 3,
    users,
    projects,
    attendance,
    points,
    updates,
    notifications,
    audit: [
      { id: nextId("aud"), at: now - 86400000 * 3, actorId: manager.id, action: "geofence.update", target: "proj_abc", detail: "Boundary redrawn after yard extension" },
      { id: nextId("aud"), at: now - 86400000 * 6, actorId: manager.id, action: "employee.assign", target: "proj_skyline", detail: "3 employees assigned" },
    ],
    outbox: [],
    permissions: {
      location: "prompt",
      backgroundLocation: "prompt",
      camera: "prompt",
      notifications: "prompt",
      privacyAccepted: false,
    },
    settings: {
      locationSource: "simulated",
      samplingSeconds: 15,
      accuracyFloor: 35,
      minMoveMeters: 3,
      forceOffline: false,
      retentionDays: 90,
      mapStyle: "plan",
      units: "metric",
    },
    session: null,
    activeProjectId: null,
  };
}
