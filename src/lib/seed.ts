/**
 * The state Workfence starts from.
 *
 * This is a first run, not a demonstration: one organisation, the two
 * premises a crew actually needs, and one signed-in identity per role. There
 * is no invented history — no attendance nobody worked, no GPS trails nobody
 * walked, no invoices nobody was sent. Everything past this point is recorded
 * by using the product.
 *
 * The same shape is created in Postgres by `supabase/bootstrap.sql`, so the
 * app looks identical whether it is running on this local store or on a real
 * backend. If you change one, change the other.
 */

import { offsetMeters } from "./geo";
import type { LatLng, Project, User, WorkforceState } from "./types";

/** The single tenant every seeded record belongs to. */
export const DEMO_ORG_ID = "org_demo";

/**
 * Shape version of the persisted store. A browser holding anything else
 * discards it and starts fresh.
 *
 * Exported from here because this file decides the shape. It used to be
 * declared separately in the store as well, and the two drifted the moment
 * one was bumped — which silently threw away every reload's session.
 */
export const SEED_VERSION = 5;

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

/* ------------------------------------------------------------- premises */

// Peelamedu, Coimbatore — the Nachi Tekneka home base.
const SITE: LatLng = { lat: 11.0273, lng: 77.0037 };
const OFFICE: LatLng = { lat: 11.0219, lng: 76.9938 };

export const SITE_PROJECT_ID = "proj_site";
export const OFFICE_PROJECT_ID = "proj_office";

function buildProjects(managerId: string): Project[] {
  const site: Project = {
    id: SITE_PROJECT_ID,
    orgId: DEMO_ORG_ID,
    kind: "site",
    trackingMode: "full-shift",
    code: "NT-CW-101",
    name: "Riverside Tower",
    client: "Nachi Tekneka",
    address: "Avinashi Road, Peelamedu, Coimbatore 641004",
    siteContact: "Site Office",
    siteContactPhone: "+91 90000 00001",
    managerId,
    startDate: "",
    endDate: "",
    status: "active",
    description:
      "First site. Rename it, redraw the boundary and assign your crew from Projects.",
    location: SITE,
    // A circle, not a hand-drawn polygon: this is a starting boundary, and
    // the manager redraws it against the real site in the geofence editor.
    // It is also what `supabase/bootstrap.sql` creates, so the two agree.
    geofence: {
      kind: "circle",
      polygon: [],
      center: SITE,
      radius: 170,
      bufferMeters: 40,
    },
    zones: [
      { id: "z_gate", name: "Main Gate", center: offsetMeters(SITE, 150, 200), radius: 32, kind: "access" },
      { id: "z_work", name: "Work Area", center: offsetMeters(SITE, 92, 320), radius: 45, kind: "work" },
      { id: "z_yard", name: "Material Yard", center: offsetMeters(SITE, 118, 262), radius: 40, kind: "material" },
      { id: "z_welfare", name: "Rest Area", center: offsetMeters(SITE, 60, 250), radius: 26, kind: "welfare" },
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
    createdAt: Date.now(),
  };

  // Not a job — a place a shift can legitimately end. Without it, a project
  // switched to `outside-only` tracking would have nowhere but the site to
  // check out, which is the case that policy exists to handle.
  const office: Project = {
    id: OFFICE_PROJECT_ID,
    orgId: DEMO_ORG_ID,
    kind: "office",
    trackingMode: "full-shift",
    code: "NT-HO-001",
    name: "Head Office",
    client: "Internal",
    address: "Peelamedu, Coimbatore 641004",
    siteContact: "Front Desk",
    siteContactPhone: "+91 90000 00002",
    managerId,
    startDate: "",
    endDate: "",
    status: "active",
    description:
      "Office premise. Crews working away from a site can start and end the day here.",
    location: OFFICE,
    geofence: {
      kind: "circle",
      polygon: [],
      center: OFFICE,
      radius: 70,
      bufferMeters: 25,
    },
    zones: [
      { id: "zo_recep", name: "Reception", center: OFFICE, radius: 22, kind: "access" },
      { id: "zo_desk", name: "Project Desk", center: offsetMeters(OFFICE, 34, 70), radius: 20, kind: "work" },
    ],
    employeeIds: [],
    rules: {
      shiftStart: 9 * 60,
      shiftEnd: 18 * 60,
      lateGraceMinutes: 15,
      minShiftMinutes: 7 * 60,
      exitAlertMinutes: 15,
      autoCheckoutHours: 14,
    },
    createdAt: Date.now(),
  };

  return [site, office];
}

/* ---------------------------------------------------------------- users */

/**
 * One identity per role, named for the role rather than for a person.
 *
 * The sign-in screen lists these, so a name like "Demo Manager" tells you
 * what you are about to see; a plausible-sounding person does not, and reads
 * as real data when it is not.
 *
 * Phone and email matter: `supabase/bootstrap.sql` creates the same four
 * rows, and a live sign-in is matched to them by phone digits first, then
 * email. Change one side and that matching quietly stops working.
 */
const BOTH_PREMISES = [SITE_PROJECT_ID, OFFICE_PROJECT_ID];

function buildUsers(): User[] {
  const now = Date.now();
  return [
    {
      id: "usr_owner",
      // The platform owner sits above every tenant, so belongs to none.
      orgId: "",
      name: "Demo Owner",
      employeeCode: "NT-0001",
      role: "superadmin",
      designation: "Product Owner",
      department: "Platform",
      phone: "+91 90000 00001",
      email: "owner@workfence.demo",
      avatarHue: 265,
      status: "active",
      projectIds: BOTH_PREMISES,
      shiftStart: 9 * 60,
      shiftEnd: 18 * 60,
      joinedAt: now,
    },
    {
      id: "usr_admin",
      orgId: DEMO_ORG_ID,
      name: "Demo Admin",
      employeeCode: "NT-0002",
      role: "admin",
      designation: "Client Administrator",
      department: "Management",
      phone: "+91 90000 00002",
      email: "admin@workfence.demo",
      avatarHue: 200,
      status: "active",
      projectIds: BOTH_PREMISES,
      shiftStart: 9 * 60,
      shiftEnd: 18 * 60,
      joinedAt: now,
    },
    {
      id: "usr_manager",
      orgId: DEMO_ORG_ID,
      name: "Demo Manager",
      employeeCode: "NT-0003",
      role: "manager",
      designation: "Project Manager",
      department: "Operations",
      phone: "+91 90000 00003",
      email: "manager@workfence.demo",
      avatarHue: 35,
      status: "active",
      projectIds: BOTH_PREMISES,
      shiftStart: 8 * 60 + 30,
      shiftEnd: 18 * 60,
      joinedAt: now,
    },
    {
      id: "usr_employee",
      orgId: DEMO_ORG_ID,
      name: "Demo Employee",
      employeeCode: "NT-0004",
      role: "employee",
      designation: "Site Supervisor",
      department: "Civil",
      phone: "+91 90000 00004",
      email: "employee@workfence.demo",
      avatarHue: 16,
      status: "active",
      projectIds: BOTH_PREMISES,
      shiftStart: 8 * 60 + 30,
      shiftEnd: 17 * 60 + 30,
      joinedAt: now,
    },
  ];
}

/* ------------------------------------------------------------- assembler */

export function buildSeedState(now = Date.now()): WorkforceState {
  const users = buildUsers();
  const manager = users.find((u) => u.role === "manager")!;
  const projects = buildProjects(manager.id);
  for (const p of projects) {
    p.employeeIds = users
      .filter((u) => u.role === "employee" && u.projectIds.includes(p.id))
      .map((u) => u.id);
  }
  void now;

  return {
    version: SEED_VERSION,
    users,
    projects,
    // Deliberately empty. These fill as the product is used.
    attendance: [],
    points: [],
    updates: [],
    notifications: [],
    audit: [],
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
      mapStyle: "dark",
      units: "metric",
    },
    session: null,
    activeProjectId: null,
  };
}
