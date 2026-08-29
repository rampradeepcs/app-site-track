"use client";

/**
 * The demo dataset — one fictional construction company, fully populated.
 *
 * Everything here is generated from a fixed seed, so the demo is identical
 * on every device and after every reset: the same people, the same routes,
 * the same payroll totals. A presentation that changes under you is worse
 * than no demo at all.
 *
 * The data is *interlocking*, not a set of pretty screens (spec §32): the
 * payroll figures come from the attendance, which comes from the shifts,
 * which the geofences and trails belong to. Change a shift and the numbers
 * downstream move, exactly as they would for a real client — which is the
 * whole point of demonstrating with it.
 *
 * Every record is fictional. Names, numbers, GSTIN and invoices are invented.
 */

import { DEFAULT_OVERTIME, DEFAULT_PAY_POLICY, creditedOvertime } from "../payroll";
import { SEED_VERSION, makeSelfie } from "../seed";
import { DEMO_IDS } from "./mode";
import type {
  Attendance,
  AttendanceMark,
  BreakEntry,
  CompRecord,
  FoodRule,
  Geofence,
  LatLng,
  LocationPoint,
  PetrolRule,
  Project,
  ShiftAssignment,
  ShiftDef,
  SiteZone,
  TravelSession,
  User,
  WorkUpdate,
  WorkforceState,
  LabourTeam,
  LabourTeamMember,
  GroupAttendanceRecord,
  GroupAttendanceMember,
  ProjectNote,
  ProjectNoteAttachment,
  NotePriority,
  NoteVisibility,
} from "../types";
import type { Invoice, Organization, PlatformState, Subscription } from "../saas-types";
import { seedPlatform } from "../saas-seed";
import { buildPortfolio } from "./portfolio";

/* ------------------------------------------------------- deterministic rng */

/** Mulberry32 — small, fast, and identical everywhere for a given seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Checkout dictations for the demo, written the way Android's recogniser
 * actually returns speech — no punctuation, no capitals, clauses running
 * into one another. Anything tidier would flatter the summariser.
 */
const VOICE_TRANSCRIPTS: readonly string[] = [
  "today we completed the riser pipe fixing for block b level two all the wet areas are done and pressure tested then we started the sleeve setting on level three about sixty percent is finished we are waiting for the gate valves from stores they have not been delivered since monday tomorrow we will complete level three sleeves and start block c riser we need twelve pipes and three valves",
  "slab pouring finished on block a level four the cubes are cast and sent for testing curing has started we had a shortage of cement in the afternoon only forty bags left so the second pour is on hold tomorrow morning we need one truck of cement to continue",
  "there was a near miss at the material hoist a worker was standing under the load we stopped work re-sited the barricade and did a toolbox talk with twenty two people no injury everyone is fine electrical conduit work on level three is going on as planned",
  "rebar inspection completed for level two the consultant signed off all the corrections from last week are closed we are continuing with the shuttering on the same level about half is done the crane was down for two hours in the morning for servicing",
  "block work on the east side is finished plastering started today around thirty percent complete water supply to the upper floors was cut for three hours so we lost some time tomorrow we plan to finish the plastering on level one and start level two",
];

const pick = <T>(r: () => number, xs: readonly T[]): T =>
  xs[Math.floor(r() * xs.length)];
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const intBetween = (r: () => number, lo: number, hi: number) =>
  Math.floor(between(r, lo, hi + 1));

/* ------------------------------------------------------------- geography */

/** Metres → degrees, near the latitudes these sites sit at. */
function offset(from: LatLng, north: number, east: number): LatLng {
  return {
    lat: from.lat + north / 111_320,
    lng: from.lng + east / (111_320 * Math.cos((from.lat * Math.PI) / 180)),
  };
}

function circleFence(center: LatLng, radius: number): Geofence {
  return { kind: "circle", polygon: [], center, radius, bufferMeters: 40 };
}

/** A rough rectangle, so a site reads as a plot rather than a dot. */
function polygonFence(center: LatLng, halfW: number, halfH: number): Geofence {
  const polygon = [
    offset(center, halfH, -halfW),
    offset(center, halfH, halfW),
    offset(center, -halfH, halfW * 0.8),
    offset(center, -halfH * 1.1, -halfW * 0.9),
  ];
  return { kind: "polygon", polygon, center, radius: Math.max(halfW, halfH), bufferMeters: 40 };
}

function zonesFor(center: LatLng): SiteZone[] {
  const z = (
    id: string,
    name: string,
    north: number,
    east: number,
    radius: number,
    kind: SiteZone["kind"],
  ): SiteZone => ({ id, name, center: offset(center, north, east), radius, kind });
  return [
    z("main-gate", "Main Gate", -95, -10, 26, "access"),
    z("site-office", "Site Office", -55, 70, 24, "welfare"),
    z("block-a", "Block A", 45, -70, 40, "work"),
    z("block-b", "Block B", 60, 55, 40, "work"),
    z("material-yard", "Material Yard", -20, -110, 34, "material"),
    z("parking", "Parking", -110, 80, 28, "access"),
    z("rest-area", "Worker Rest Area", -40, 10, 22, "welfare"),
  ];
}

/* ---------------------------------------------------------------- people */

const FIRST = [
  "Arun", "Suresh", "Karthik", "Vignesh", "Priya", "Divya", "Rajesh", "Manoj",
  "Saravanan", "Bala", "Ramesh", "Deepa", "Anand", "Kavya", "Prakash", "Naveen",
  "Gopal", "Lakshmi", "Vimal", "Sathish", "Hari", "Meena", "Rahul", "Ashok",
  "Ganesh", "Sundar", "Kumar", "Jaya", "Vasanth", "Selva", "Mohan", "Nithya",
  "Raju", "Senthil", "Dinesh", "Muthu", "Ravi", "Shanthi", "Kiran", "Yuvan",
] as const;

const LAST = [
  "Kumar", "Raj", "Selvam", "Babu", "Narayan", "Raman", "Murugan", "Krishnan",
  "Pillai", "Nair", "Iyer", "Subramani", "Venkat", "Doss", "Sekar", "Prabhu",
] as const;

const TRADES: Array<{ designation: string; department: string; monthly: number }> = [
  { designation: "Site Engineer", department: "Engineering", monthly: 42_000 },
  { designation: "Civil Engineer", department: "Engineering", monthly: 45_000 },
  { designation: "Electrician", department: "Electrical", monthly: 26_000 },
  { designation: "Plumber", department: "Plumbing", monthly: 24_000 },
  { designation: "Mason", department: "Civil", monthly: 22_000 },
  { designation: "Carpenter", department: "Civil", monthly: 23_000 },
  { designation: "Welder", department: "Fabrication", monthly: 27_000 },
  { designation: "Equipment Operator", department: "Plant", monthly: 30_000 },
  { designation: "Safety Officer", department: "EHS", monthly: 35_000 },
  { designation: "Supervisor", department: "Site", monthly: 32_000 },
  { designation: "General Worker", department: "Site", monthly: 18_000 },
  { designation: "Driver", department: "Logistics", monthly: 21_000 },
  { designation: "Store Keeper", department: "Stores", monthly: 25_000 },
  { designation: "QA/QC Inspector", department: "Quality", monthly: 38_000 },
];

/* ------------------------------------------------------------------ time */

const DAY = 86_400_000;
const dateISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Epoch ms for a minutes-from-midnight time on an ISO date. */
const at = (iso: string, minute: number) =>
  new Date(`${iso}T00:00:00`).getTime() + minute * 60_000;

/* ================================================================ builder */

export interface DemoData {
  workforce: WorkforceState;
  platform: PlatformState;
}

export function buildDemoData(now = Date.now()): DemoData {
  const r = rng(20260828);
  const orgId = DEMO_IDS.org;

  /* ----------------------------------------------------------- projects */

  const CENTRES = {
    metro: { lat: 13.0604, lng: 80.2496 },      // Chennai
    tower: { lat: 11.0168, lng: 76.9558 },      // Coimbatore
    residential: { lat: 12.9716, lng: 77.5946 },// Bengaluru
    highway: { lat: 13.0012, lng: 80.2065 },    // Chennai
  };

  const projectRules = {
    shiftStart: 8 * 60 + 30,
    shiftEnd: 17 * 60 + 30,
    lateGraceMinutes: 15,
    minShiftMinutes: 7 * 60,
    exitAlertMinutes: 10,
    autoCheckoutHours: 14,
  };

  const mkProject = (
    id: string,
    code: string,
    name: string,
    city: string,
    address: string,
    center: LatLng,
    fence: Geofence,
    status: Project["status"],
    travelTracking: boolean,
  ): Project => ({
    id,
    orgId,
    kind: "site",
    trackingMode: "full-shift",
    travelTracking,
    code,
    name,
    client: "ABC Infrastructure & Construction Pvt. Ltd.",
    address,
    siteContact: "Suresh Babu",
    siteContactPhone: "9840012345",
    managerId: DEMO_IDS.projectManager,
    startDate: dateISO(new Date(now - 220 * DAY)),
    endDate: "",
    status,
    description: `${city} — demonstration site with a drawn boundary, named zones and live crew.`,
    location: center,
    geofence: fence,
    zones: zonesFor(center),
    employeeIds: [],
    rules: projectRules,
    createdAt: now - 220 * DAY,
  });

  const projects: Project[] = [
    mkProject(
      "demo-prj-metro", "ABC-S01",
      "Chennai Metro Expansion — Package A", "Chennai",
      "Anna Nagar Depot Road, Chennai 600040",
      CENTRES.metro, polygonFence(CENTRES.metro, 210, 170), "active", true,
    ),
    mkProject(
      "demo-prj-tower", "ABC-S02",
      "Coimbatore Commercial Tower", "Coimbatore",
      "Avinashi Road, Peelamedu, Coimbatore 641004",
      CENTRES.tower, circleFence(CENTRES.tower, 180), "active", true,
    ),
    mkProject(
      "demo-prj-residential", "ABC-S03",
      "Bengaluru Residential Development", "Bengaluru",
      "Outer Ring Road, Bellandur, Bengaluru 560103",
      CENTRES.residential, circleFence(CENTRES.residential, 200), "active", false,
    ),
    mkProject(
      "demo-prj-highway", "ABC-S04",
      "Chennai Highway Infrastructure", "Chennai",
      "GST Road, Chromepet, Chennai 600044",
      CENTRES.highway, circleFence(CENTRES.highway, 160), "completed", false,
    ),
  ];
  const [metro, tower, residential, highway] = projects;

  /* ------------------------------------------------------------- shifts */

  const mkShift = (
    id: string,
    name: string,
    code: string,
    startMinute: number,
    endMinute: number,
    kind: ShiftDef["kind"],
  ): ShiftDef => ({
    id,
    orgId,
    name,
    code,
    kind,
    startMinute,
    endMinute,
    requiredMinutes: 8 * 60,
    graceMinutes: 15,
    breakRules: [
      {
        id: `${id}-lunch`,
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
    overtime: { ...DEFAULT_OVERTIME, approval: "manager", hourlyRate: 150 },
    workingDays: [1, 2, 3, 4, 5, 6],
    projectIds: projects.map((p) => p.id),
    status: "active",
    createdAt: now - 200 * DAY,
  });

  const shifts: ShiftDef[] = [
    mkShift("demo-shift-general", "General Shift", "SH-01", 8 * 60 + 30, 17 * 60 + 30, "fixed"),
    mkShift("demo-shift-early", "Early Shift", "SH-02", 6 * 60 + 30, 15 * 60 + 30, "fixed"),
    mkShift("demo-shift-evening", "Evening Shift", "SH-03", 14 * 60, 23 * 60, "fixed"),
    mkShift("demo-shift-night", "Night Shift", "SH-04", 22 * 60, 6 * 60, "overnight"),
  ];

  /* -------------------------------------------------------------- people */

  const users: User[] = [];
  const comp: CompRecord[] = [];
  const shiftAssignments: ShiftAssignment[] = [];
  let codeSeq = 1;

  const addUser = (
    u: Omit<User, "employeeCode" | "orgId" | "joinedAt" | "avatarHue"> & {
      avatarHue?: number;
      joinedAt?: number;
    },
    monthly: number,
    shiftId: string,
  ): User => {
    const user: User = {
      ...u,
      orgId,
      employeeCode: `ABC-${String(codeSeq++).padStart(4, "0")}`,
      avatarHue: u.avatarHue ?? intBetween(r, 0, 359),
      joinedAt: u.joinedAt ?? now - intBetween(r, 120, 900) * DAY,
    };
    users.push(user);
    if (monthly > 0) {
      comp.push({
        id: `demo-comp-${user.id}`,
        employeeId: user.id,
        type: "monthly",
        amount: monthly,
        effectiveFrom: dateISO(new Date(now - 60 * DAY)),
        workingDaysPerMonth: 26,
        standardDayMinutes: 480,
        note: "Current package",
        setBy: DEMO_IDS.hr,
        at: now - 60 * DAY,
      });
    }
    shiftAssignments.push({
      id: `demo-sa-${user.id}`,
      employeeId: user.id,
      shiftId,
      effectiveFrom: dateISO(new Date(now - 90 * DAY)),
      assignedBy: DEMO_IDS.projectManager,
      at: now - 90 * DAY,
    });
    return user;
  };

  const allProjects = [metro.id, tower.id, residential.id];

  // The platform owner belongs to no tenant — that is what makes them the
  // platform's owner rather than a client's admin.
  users.push({
    id: DEMO_IDS.owner,
    orgId: "",
    name: "Arun Demo",
    employeeCode: "WF-0001",
    role: "superadmin",
    designation: "Product Owner",
    department: "Workfence",
    phone: "9944311118",
    email: "owner@workfence.demo",
    avatarHue: 275,
    status: "active",
    projectIds: [],
    shiftStart: 9 * 60,
    shiftEnd: 18 * 60,
    joinedAt: now - 900 * DAY,
  });

  addUser(
    {
      id: DEMO_IDS.clientOwner,
      name: "Rajesh Kumar",
      role: "admin",
      designation: "Managing Director",
      department: "Management",
      phone: "9840000001",
      email: "rajesh@abcinfra.demo",
      status: "active",
      projectIds: allProjects,
      shiftStart: 9 * 60,
      shiftEnd: 18 * 60,
      avatarHue: 210,
    },
    120_000,
    "demo-shift-general",
  );

  addUser(
    {
      id: DEMO_IDS.hr,
      name: "Divya Raman",
      role: "admin",
      designation: "HR & Compliance Lead",
      department: "Human Resources",
      phone: "9840000002",
      email: "divya@abcinfra.demo",
      status: "active",
      projectIds: allProjects,
      shiftStart: 9 * 60,
      shiftEnd: 18 * 60,
      avatarHue: 330,
    },
    68_000,
    "demo-shift-general",
  );

  addUser(
    {
      id: DEMO_IDS.payroll,
      name: "Priya Narayan",
      role: "admin",
      designation: "Payroll Manager",
      department: "Finance",
      phone: "9840000003",
      email: "priya@abcinfra.demo",
      status: "active",
      projectIds: allProjects,
      shiftStart: 9 * 60,
      shiftEnd: 18 * 60,
      avatarHue: 20,
    },
    62_000,
    "demo-shift-general",
  );

  addUser(
    {
      id: DEMO_IDS.projectManager,
      name: "Suresh Babu",
      role: "manager",
      designation: "Project Manager",
      department: "Projects",
      phone: "9840000004",
      email: "suresh@abcinfra.demo",
      status: "active",
      projectIds: allProjects,
      shiftStart: 8 * 60 + 30,
      shiftEnd: 17 * 60 + 30,
      avatarHue: 150,
    },
    75_000,
    "demo-shift-general",
  );

  addUser(
    {
      id: DEMO_IDS.supervisor,
      name: "Karthik Selvam",
      role: "manager",
      designation: "Site Supervisor",
      department: "Site",
      phone: "9840000005",
      email: "karthik@abcinfra.demo",
      status: "active",
      projectIds: [metro.id],
      shiftStart: 8 * 60 + 30,
      shiftEnd: 17 * 60 + 30,
      avatarHue: 95,
    },
    38_000,
    "demo-shift-general",
  );

  // The two employees the walkthrough follows.
  addUser(
    {
      id: DEMO_IDS.employee,
      name: "Arun Kumar",
      role: "employee",
      designation: "Mason",
      department: "Civil",
      phone: "9840000006",
      email: "arun@abcinfra.demo",
      status: "active",
      projectIds: [metro.id],
      shiftStart: 8 * 60 + 30,
      shiftEnd: 17 * 60 + 30,
      avatarHue: 38,
      supervisorRating: 88,
    },
    30_000,
    "demo-shift-general",
  );

  addUser(
    {
      id: DEMO_IDS.traveller,
      name: "Vignesh Raj",
      role: "employee",
      designation: "Store Keeper",
      department: "Stores",
      phone: "9840000007",
      email: "vignesh@abcinfra.demo",
      status: "active",
      projectIds: [metro.id],
      shiftStart: 8 * 60 + 30,
      shiftEnd: 17 * 60 + 30,
      avatarHue: 265,
      supervisorRating: 82,
      vehicle: {
        type: "two-wheeler",
        ownership: "personal",
        registration: "TN 09 BX 4417",
        fuelType: "Petrol",
      },
    },
    25_000,
    "demo-shift-general",
  );

  // …and the crew that makes the dashboards look like a real company.
  const CREW_SIZE = 38;
  for (let i = 0; i < CREW_SIZE; i++) {
    const trade = TRADES[i % TRADES.length];
    const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    const project =
      i % 5 === 0 ? residential.id : i % 3 === 0 ? tower.id : metro.id;
    const shiftId =
      i % 11 === 0
        ? "demo-shift-night"
        : i % 7 === 0
          ? "demo-shift-evening"
          : i % 4 === 0
            ? "demo-shift-early"
            : "demo-shift-general";
    const drives = trade.designation === "Driver" || trade.designation === "Store Keeper";
    addUser(
      {
        id: `demo-emp-${i}`,
        name,
        role: "employee",
        designation: trade.designation,
        department: trade.department,
        phone: `98400${String(10000 + i).slice(-5)}`,
        status: i % 17 === 0 ? "on-leave" : "active",
        projectIds: [project],
        shiftStart: 8 * 60 + 30,
        shiftEnd: 17 * 60 + 30,
        supervisorRating: intBetween(r, 62, 97),
        vehicle: drives
          ? {
              type: i % 2 === 0 ? "two-wheeler" : "four-wheeler",
              ownership: "personal",
              registration: `TN ${intBetween(r, 10, 99)} ${pick(r, ["AB", "BX", "CJ", "DK"])} ${intBetween(r, 1000, 9999)}`,
              fuelType: "Petrol",
            }
          : undefined,
      },
      trade.monthly + intBetween(r, -2, 3) * 1000,
      shiftId,
    );
  }

  // Roster the projects from the people assigned to them.
  for (const p of projects) {
    p.employeeIds = users.filter((u) => u.projectIds.includes(p.id)).map((u) => u.id);
  }

  /* --------------------------------------------------- allowance policy */

  const petrolRules: PetrolRule[] = [
    {
      id: "demo-petrol-2w",
      orgId,
      name: "Two Wheeler",
      vehicleType: "two-wheeler",
      ratePerKm: 5,
      maxDailyKm: 100,
      maxDailyAmount: null,
      approval: "manager",
      projectIds: [],
      employeeIds: [],
      effectiveFrom: dateISO(new Date(now - 120 * DAY)),
      status: "active",
      createdAt: now - 120 * DAY,
    },
    {
      id: "demo-petrol-4w",
      orgId,
      name: "Four Wheeler",
      vehicleType: "four-wheeler",
      ratePerKm: 10,
      maxDailyKm: 150,
      maxDailyAmount: null,
      approval: "manager",
      projectIds: [],
      employeeIds: [],
      effectiveFrom: dateISO(new Date(now - 120 * DAY)),
      status: "active",
      createdAt: now - 120 * DAY,
    },
  ];

  const foodRules: FoodRule[] = [
    {
      id: "demo-food-breakfast",
      orgId,
      name: "Breakfast Allowance",
      meal: "Breakfast",
      startMinute: 6 * 60 + 30,
      endMinute: 7 * 60,
      trigger: "check-in",
      amount: 100,
      projectIds: [],
      employeeIds: [],
      shiftIds: [],
      approval: "auto",
      effectiveFrom: dateISO(new Date(now - 120 * DAY)),
      status: "active",
      createdAt: now - 120 * DAY,
    },
    {
      id: "demo-food-lunch",
      orgId,
      name: "Lunch Allowance",
      meal: "Lunch",
      startMinute: 12 * 60 + 30,
      endMinute: 13 * 60 + 30,
      trigger: "check-in",
      amount: 150,
      projectIds: [],
      employeeIds: [],
      shiftIds: [],
      approval: "auto",
      effectiveFrom: dateISO(new Date(now - 120 * DAY)),
      status: "active",
      createdAt: now - 120 * DAY,
    },
  ];

  /* ---------------------------------------------------------- attendance */

  const attendance: Attendance[] = [];
  const points: LocationPoint[] = [];
  const updates: WorkUpdate[] = [];
  const travelSessions: TravelSession[] = [];

  const WORKERS = users.filter((u) => u.role === "employee" || u.role === "manager");
  const DAYS = 30;

  const mark = (
    who: User,
    project: Project,
    ts: number,
    zone: SiteZone,
    label: string,
    inside = true,
  ): AttendanceMark => ({
    at: ts,
    coords: offset(zone.center, between(r, -12, 12), between(r, -12, 12)),
    accuracy: between(r, 4, 14),
    selfie: makeSelfie(who.name, who.avatarHue, label),
    place: zone.name,
    insideGeofence: inside,
    syncedAt: ts,
  });

  for (let d = DAYS; d >= 0; d--) {
    const day = new Date(now - d * DAY);
    const iso = dateISO(day);
    const dow = day.getDay();
    const isSunday = dow === 0;

    for (const who of WORKERS) {
      const project = projects.find((p) => who.projectIds.includes(p.id)) ?? metro;
      if (project.status === "completed") continue;

      const assignment = shiftAssignments.find((a) => a.employeeId === who.id);
      const shift =
        shifts.find((s) => s.id === assignment?.shiftId) ?? shifts[0];

      // Sundays are mostly off; a little weekend work keeps the data honest.
      const weekendWork = isSunday && r() < 0.12;
      if (isSunday && !weekendWork) continue;
      if (who.status === "on-leave" && d < 6) continue;

      const roll = r();
      if (roll < 0.05) continue;                       // absent
      const late = roll > 0.82;
      const earlyOut = roll > 0.74 && roll <= 0.78;
      const missingCheckout = roll > 0.965;

      const gate = project.zones.find((z) => z.id === "main-gate")!;
      const office = project.zones.find((z) => z.id === "site-office")!;

      // The people the demo follows get the exact times from the script.
      const scripted = who.id === DEMO_IDS.employee;
      const inMinute = scripted
        ? 8 * 60 + 42
        : shift.startMinute + (late ? intBetween(r, 18, 55) : intBetween(r, -22, 12));
      const outMinute = scripted
        ? 18 * 60 + 17
        : shift.endMinute + (earlyOut ? -intBetween(r, 35, 90) : intBetween(r, -10, 62));

      const inAt = at(iso, inMinute);
      const outAt = at(iso, outMinute < inMinute ? outMinute + 24 * 60 : outMinute);

      const checkIn = mark(who, project, inAt, gate, "Check-in");
      const attendanceId = `demo-att-${who.id}-${iso}`;

      // Today is only as far along as the clock says. Stamping a checkout
      // or a finished lunch that has not happened yet would both falsify
      // the record and empty the live map, which is the one screen the
      // demo opens on.
      const isToday = d === 0;
      // A shift that starts later today has simply not begun.
      if (isToday && inAt > now) continue;

      // Breaks: usually lunch, sometimes two, occasionally none or long.
      const breaks: BreakEntry[] = [];
      const breakRoll = r();
      if (breakRoll > 0.12) {
        const lunchStart = at(iso, 13 * 60 + intBetween(r, -8, 12));
        const lunchMinutes = scripted ? 45 : intBetween(r, 30, breakRoll > 0.93 ? 75 : 50);
        breaks.push({
          id: `${attendanceId}-lunch`,
          start: lunchStart,
          end: lunchStart + lunchMinutes * 60_000,
          coordsStart: office.center,
          coordsEnd: office.center,
          ruleId: `${shift.id}-lunch`,
        });
      }
      if (breakRoll > 0.72) {
        const teaStart = at(iso, 11 * 60 + intBetween(r, -15, 20));
        breaks.push({
          id: `${attendanceId}-tea`,
          start: teaStart,
          end: teaStart + intBetween(r, 10, 18) * 60_000,
          coordsStart: office.center,
          coordsEnd: office.center,
        });
      }

      // A break that has not started yet did not happen; one the clock is
      // currently inside is still running, so it has no end.
      if (isToday) {
        for (let i = breaks.length - 1; i >= 0; i--) {
          if (breaks[i].start > now) breaks.splice(i, 1);
          else if ((breaks[i].end ?? 0) > now) breaks[i].end = undefined;
        }
      }

      const closed = !missingCheckout && (!isToday || outAt <= now);
      const checkOut = closed ? mark(who, project, outAt, gate, "Checkout") : undefined;

      const breakMinutes = breaks.reduce(
        (t, b) => t + ((b.end ?? (isToday ? now : outAt)) - b.start) / 60_000,
        0,
      );
      const workedMinutes = closed
        ? Math.round((outAt - inAt) / 60_000 - breakMinutes)
        : undefined;

      const shiftEndAt = at(
        iso,
        shift.endMinute < shift.startMinute ? shift.endMinute + 24 * 60 : shift.endMinute,
      );
      // Credited through the same rule the engine uses, so a row that shows
      // "30m OT" is a row the payroll engine also values at 30 minutes.
      // Raw minutes below the minimum simply are not overtime.
      const otMinutes = creditedOvertime(
        closed
          ? Math.max(
              0,
              Math.round((outAt - shiftEndAt) / 60_000) - shift.overtime.graceMinutes,
            )
          : 0,
        shift.overtime,
      );

      const otRoll = r();
      const overtime =
        otMinutes > 0
          ? {
              minutes: otMinutes,
              status: (d <= 2
                ? "pending"
                : otRoll > 0.9
                  ? "rejected"
                  : "approved") as Attendance["overtime"] extends undefined
                ? never
                : NonNullable<Attendance["overtime"]>["status"],
              approvedMinutes: otRoll > 0.9 ? 0 : otMinutes,
              decidedBy: d <= 2 ? undefined : DEMO_IDS.projectManager,
              decidedAt: d <= 2 ? undefined : outAt + 3600_000,
            }
          : undefined;

      const status: Attendance["status"] = missingCheckout
        ? "missing-checkout"
        : late
          ? "late"
          : earlyOut
            ? "early-checkout"
            : "present";

      // A trail through the named zones, so route playback has something to
      // play and dwell segments land on real places.
      const trailZones = [
        gate,
        project.zones.find((z) => z.id === "block-a")!,
        project.zones.find((z) => z.id === "material-yard")!,
        project.zones.find((z) => z.id === "block-b")!,
        project.zones.find((z) => z.id === "rest-area")!,
        project.zones.find((z) => z.id === "block-b")!,
        gate,
      ];
      // Only the recent days keep their full trail: a month of per-minute
      // fixes for fifty people is not what makes a demo convincing, and it
      // would push the store past what a browser will hold.
      if (d <= 3 && closed) {
        const span = outAt - inAt;
        const steps = 42;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const zoneIdx = Math.min(
            trailZones.length - 1,
            Math.floor(t * (trailZones.length - 1)),
          );
          const zone = trailZones[zoneIdx];
          points.push({
            id: `${attendanceId}-pt-${i}`,
            attendanceId,
            employeeId: who.id,
            projectId: project.id,
            lat: offset(zone.center, between(r, -18, 18), between(r, -18, 18)).lat,
            lng: offset(zone.center, between(r, -18, 18), between(r, -18, 18)).lng,
            accuracy: between(r, 4, 16),
            speed: between(r, 0, 1.4),
            heading: between(r, 0, 359),
            at: inAt + span * t,
          });
        }
      }

      attendance.push({
        id: attendanceId,
        employeeId: who.id,
        projectId: project.id,
        date: iso,
        checkIn,
        checkOut,
        workedMinutes,
        distanceMeters: closed ? intBetween(r, 900, 4200) : intBetween(r, 200, 1500),
        status,
        events: [],
        breaks,
        shiftId: shift.id,
        overtime,
        voiceNote:
          scripted && d <= 2 && closed
            ? {
                // A tiny silent clip: the point is the affordance and the
                // metadata, not audio nobody will play in a meeting.
                dataUrl:
                  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=",
                seconds: 42,
                at: outAt,
                coords: gate.center,
                place: gate.name,
                transcript: pick(r, VOICE_TRANSCRIPTS),
                transcriptLang: "en-IN",
              }
            : undefined,
      });

      /* work updates — a few a day across the crew */
      if (r() < 0.25 || scripted) {
        const kinds = [
          ["Civil Work", "Rebar inspection completed for Level 2."],
          ["Civil Work", "Concrete pour finished on Block A slab."],
          ["Electrical", "Conduit installation completed on Level 3."],
          ["Material Handling", "Cement and steel received, stacked at yard."],
          ["Safety", "Toolbox talk held with 22 workers before shift."],
          ["Quality Inspection", "Slump test passed, cubes cast for testing."],
          ["Plumbing", "Riser pipes fixed for Block B wet areas."],
          ["Supervision", "Day's progress reviewed with site engineer."],
        ] as const;
        const [category, description] = pick(r, kinds);
        updates.push({
          id: `demo-upd-${who.id}-${iso}`,
          employeeId: who.id,
          projectId: project.id,
          attendanceId,
          date: iso,
          at: at(iso, 14 * 60 + intBetween(r, 0, 120)),
          category: category as WorkUpdate["category"],
          kind: "shift",
          description,
          photos: [],
          coords: office.center,
          place: "Block B — Level 2",
          status: "synced",
        });
      }
    }

    /* travel — the store keeper runs material most working days */
    if (!isSunday && d <= 12) {
      const purposes = [
        "Material Pickup",
        "Supplier Visit",
        "Client Visit",
        "Government Office",
        "Other Project Site",
      ] as const;
      const purpose = pick(r, purposes);
      const startAt = at(iso, 6 * 60 + 42);
      const endAt = at(iso, 9 * 60 + intBetween(r, 5, 50));
      const km = between(r, 14, 46);
      const sessionId = `demo-travel-${iso}`;
      const gate = metro.zones.find((z) => z.id === "main-gate")!;
      travelSessions.push({
        id: sessionId,
        employeeId: DEMO_IDS.traveller,
        projectId: metro.id,
        attendanceId: `demo-att-${DEMO_IDS.traveller}-${iso}`,
        date: iso,
        start: {
          kind: "base",
          name: "Employee Base — Ambattur",
          address: "Ambattur, Chennai",
          coords: offset(CENTRES.metro, -6400, -5200),
          at: startAt,
        },
        end: {
          kind: "project",
          name: metro.name,
          address: metro.address,
          coords: gate.center,
          at: endAt,
          projectId: metro.id,
        },
        purpose,
        note:
          purpose === "Material Pickup"
            ? "Collect electrical materials from supplier."
            : undefined,
        vehicleType: "two-wheeler",
        distanceMeters: Math.round(km * 1000),
        flags:
          d === 4
            ? [
                {
                  at: startAt + 1_800_000,
                  kind: "gps-gap",
                  detail: "7 min without a fix — 2.1 km across the gap not counted",
                },
              ]
            : [],
        status: d <= 1 ? "pending" : "approved",
        decidedBy: d <= 1 ? undefined : DEMO_IDS.projectManager,
        decidedAt: d <= 1 ? undefined : endAt + 7_200_000,
      });

      // A polyline for the run, so "View route" has a route.
      const from = offset(CENTRES.metro, -6400, -5200);
      const steps = 26;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        points.push({
          id: `${sessionId}-pt-${i}`,
          attendanceId: `demo-att-${DEMO_IDS.traveller}-${iso}`,
          employeeId: DEMO_IDS.traveller,
          projectId: metro.id,
          lat: from.lat + (gate.center.lat - from.lat) * t + between(r, -0.0006, 0.0006),
          lng: from.lng + (gate.center.lng - from.lng) * t + between(r, -0.0006, 0.0006),
          accuracy: between(r, 5, 18),
          speed: between(r, 4, 14),
          heading: between(r, 0, 359),
          at: startAt + (endAt - startAt) * t,
          travelSessionId: sessionId,
        });
      }
    }
  }

  /* ------------------------------------------------- runs in progress now */

  /*
   * A few people are on the road at this moment. Without them the live map
   * is a still photograph: every route finished, nobody moving. These are
   * ordinary open sessions — no end anchor, no distance settled yet —
   * exactly what an unfinished run looks like in production.
   */
  {
    const runners = WORKERS.filter(
      (u) => u.role === "employee" && u.id !== DEMO_IDS.traveller,
    ).slice(0, 3);
    const iso = dateISO(new Date(now));
    const gate = metro.zones.find((z) => z.id === "main-gate")!;

    runners.forEach((who, i) => {
      const project = projects.find((p) => who.projectIds.includes(p.id)) ?? metro;
      if (project.status === "completed") return;
      const startAt = now - intBetween(r, 28, 95) * 60_000;
      const sessionId = `demo-travel-live-${i}`;
      const from = offset(CENTRES.metro, -5200 - i * 900, -4100 + i * 1300);

      travelSessions.push({
        id: sessionId,
        employeeId: who.id,
        projectId: project.id,
        attendanceId: `demo-att-${who.id}-${iso}`,
        date: iso,
        start: {
          kind: "project",
          name: project.name,
          address: project.address,
          coords: gate.center,
          at: startAt,
          projectId: project.id,
        },
        purpose: pick(r, ["Material Pickup", "Supplier Visit", "Other Project Site"] as const),
        vehicleType: i === 2 ? "four-wheeler" : "two-wheeler",
        distanceMeters: 0,
        flags: [],
        status: "active",
      });

      // Only the stretch already driven exists — the rest has not happened.
      const steps = 14;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        points.push({
          id: `${sessionId}-pt-${k}`,
          attendanceId: `demo-att-${who.id}-${iso}`,
          employeeId: who.id,
          projectId: project.id,
          lat: gate.center.lat + (from.lat - gate.center.lat) * t,
          lng: gate.center.lng + (from.lng - gate.center.lng) * t,
          accuracy: between(r, 5, 18),
          speed: between(r, 6, 16),
          heading: between(r, 0, 359),
          at: startAt + (now - startAt) * t,
          travelSessionId: sessionId,
        });
      }
    });
  }

  /* ---------------------------------------------------------- platform */

  const base = seedPlatform(now);

  const billing = {
    legalName: "ABC Infrastructure & Construction Pvt. Ltd.",
    contactName: "Rajesh Kumar",
    email: "accounts@abcinfra.demo",
    phone: "9840000001",
    addressLine: "4th Floor, Prince Towers, Anna Salai",
    city: "Chennai",
    state: "Tamil Nadu",
    postcode: "600002",
    country: "India",
    taxIdLabel: "GSTIN",
    taxId: "33ABCDE1234F1Z5",
    taxPercent: 18,
    currency: "INR" as const,
    paymentMethod: "NEFT · HDFC ••4417",
  };

  const org: Organization = {
    id: orgId,
    name: "ABC Infrastructure & Construction Pvt. Ltd.",
    code: "ABC-DEMO",
    industry: "Construction & Infrastructure",
    website: "abcinfra.demo",
    contactName: "Rajesh Kumar",
    contactEmail: "rajesh@abcinfra.demo",
    contactPhone: "9840000001",
    country: "India",
    timezone: "Asia/Kolkata",
    status: "active",
    billing,
    branding: { appName: "Workfence", accent: "#000000", logoText: "ABC" },
    createdAt: now - 400 * DAY,
  };

  const subscription: Subscription = {
    id: "demo-sub-abc",
    orgId,
    planId: "plan_enterprise",
    status: "active",
    cycle: "annual",
    startedAt: now - 400 * DAY,
    renewsAt: new Date(2027, 8, 30).getTime(),
    // Seats are sized to the account, not parked at a number nobody
    // approaches: 45 people against 70 reads as a customer using what they
    // bought, which is what drives the adoption half of the health score.
    // Comfortably under the 80% mark that flags a client as near its limit.
    limitOverrides: { employees: 70, projects: 25, storageGb: 500 },
    featureOverrides: {},
    creditBalance: 0,
    onLimitReached: "warn",
    notes: "Enterprise agreement — demonstration tenant.",
  };

  /*
   * The flagship account settles on time. Its billing history is a clean
   * run of paid invoices plus one raised two days ago and not yet due —
   * ordinary receivables, not a debt, so it leaves the health score alone
   * and still gives the billing screen something live to show.
   *
   * The messier states — overdue, failed, refunded, payment holds — belong
   * to the wider client book, where a presenter can open them deliberately
   * from "Accounts at risk" rather than tripping over them on the tenant
   * the demo is built around.
   */
  const invoices: Invoice[] = [
    ["INV-2026-00868", 295_000, "pending", 2],
    ["INV-2026-00821", 295_000, "paid", 32],
    ["INV-2026-00744", 295_000, "paid", 62],
    ["INV-2026-00669", 295_000, "paid", 92],
    ["INV-2026-00591", 295_000, "paid", 122],
    ["INV-2026-00512", 295_000, "paid", 152],
  ].map(([number, amount, status, daysAgo]) => {
    const issued = now - (daysAgo as number) * DAY;
    return {
      id: `demo-inv-${number}`,
      number: number as string,
      orgId,
      subscriptionId: subscription.id,
      amount: amount as number,
      taxAmount: Math.round((amount as number) * 0.18),
      currency: "INR" as const,
      issuedAt: issued,
      dueAt: issued + 15 * DAY,
      paidAt: status === "paid" ? issued + 4 * DAY : undefined,
      status: status as Invoice["status"],
      periodLabel: new Date(issued).toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
      }),
      paymentMethod: billing.paymentMethod,
      failureReason:
        status === "failed" ? "Bank declined the mandate — retry scheduled." : undefined,
    };
  });

  // ABC is the tenant the demo walks through in detail; the portfolio is the
  // rest of the book, so the platform dashboard reads like a real business
  // rather than a single account (spec §23).
  const book = buildPortfolio(now);

  const platform: PlatformState = {
    ...base,
    organizations: [org, ...book.organizations],
    subscriptions: [subscription, ...book.subscriptions],
    invoices: [...invoices, ...book.invoices],
    usage: [
      ...book.usage,
      {
        orgId,
        month: new Date(now).toISOString().slice(0, 7),
        employees: users.filter((u) => u.orgId === orgId).length,
        activeEmployees: users.filter(
          (u) => u.orgId === orgId && u.status === "active",
        ).length,
        managers: users.filter((u) => u.orgId === orgId && u.role === "manager").length,
        projects: projects.filter((p) => p.status === "active").length,
        storageGb: 182,
        checkIns: attendance.length,
        trackingSessions: attendance.filter((a) => a.checkOut).length,
        locationPoints: 1_842_000,
        workUpdates: updates.length,
        apiCalls: 41_200,
        reportRuns: 184,
        activeManagerDays: 26,
        gpsErrors: 42,
      },
    ],
    platformAudit: [
      {
        id: "demo-pa-1",
        at: now - 400 * DAY,
        actorId: DEMO_IDS.owner,
        actorName: "Arun Demo",
        orgId,
        action: "client.create",
        target: org.name,
        newValue: "Enterprise (annual)",
        detail: "Onboarded with admin Rajesh Kumar",
      },
    ],
  };

  /* ------------------------------------------------------------- state */

  /* -------------------------------------------------- labour teams */

  /*
   * Gangs, not individuals. Each team is built from the crew already on
   * the project and the trade they actually do, so the team screens and
   * the workforce screens describe the same people rather than two
   * parallel fictions.
   */
  const labourTeams: LabourTeam[] = [];
  const teamMembers: LabourTeamMember[] = [];

  const TEAM_PLAN: Array<{ type: string; designations: string[] }> = [
    { type: "Plumbing", designations: ["Plumber"] },
    { type: "Electrical", designations: ["Electrician"] },
    { type: "Mason", designations: ["Mason"] },
    { type: "Carpentry", designations: ["Carpenter"] },
    { type: "Fabrication", designations: ["Welder"] },
    { type: "General Labour", designations: ["General Worker", "Driver"] },
  ];

  let teamSeq = 1;
  for (const project of projects) {
    const onProject = users.filter(
      (u) => u.role === "employee" && u.projectIds.includes(project.id),
    );
    const engineer =
      onProject.find((u) => u.designation === "Site Engineer") ??
      users.find((u) => u.id === DEMO_IDS.supervisor);

    for (const planned of TEAM_PLAN) {
      const crew = onProject.filter((u) =>
        planned.designations.includes(u.designation),
      );
      if (crew.length === 0) continue;

      const id = `demo-team-${teamSeq}`;
      const zone = project.zones[teamSeq % Math.max(project.zones.length, 1)];
      labourTeams.push({
        id,
        orgId,
        projectId: project.id,
        name: `${planned.type} Team`,
        type: planned.type,
        code: `T-${String(teamSeq).padStart(3, "0")}`,
        leaderId: crew[0]?.id,
        siteEngineerId: engineer?.id,
        supervisorId: DEMO_IDS.supervisor,
        description: `${planned.type} works for ${project.name}.`,
        status: "active",
        startDate: new Date(now - 90 * DAY).toISOString().slice(0, 10),
        workZoneId: zone?.id,
        shiftId: crew[0] ? shiftAssignments.find((a) => a.employeeId === crew[0].id)?.shiftId : undefined,
        createdAt: now - 90 * DAY,
        updatedAt: now - 3 * DAY,
      });

      crew.forEach((member, i) => {
        teamMembers.push({
          id: `demo-tm-${teamSeq}-${i}`,
          orgId,
          teamId: id,
          employeeId: member.id,
          joinedAt: now - (80 - i) * DAY,
          status: "active",
        });
      });
      teamSeq += 1;
    }

    /*
     * Gangs of one are not gangs. The specialists above are the core of
     * each team; the general hands on the project are then spread across
     * them, which is what actually happens on a site and what makes the
     * team screens worth looking at.
     */
    const claimed = new Set(teamMembers.map((m) => m.employeeId));
    const spare = onProject.filter((u) => !claimed.has(u.id));
    const projectTeams = labourTeams.filter((t) => t.projectId === project.id);
    spare.forEach((u, i) => {
      const target = projectTeams[i % Math.max(projectTeams.length, 1)];
      if (!target) return;
      teamMembers.push({
        id: `demo-tm-spare-${project.id}-${i}`,
        orgId,
        teamId: target.id,
        employeeId: u.id,
        joinedAt: now - (60 - (i % 40)) * DAY,
        status: "active",
      });
    });
  }

  /* One completed spell, so the history the model exists for is visible. */
  const firstTeam = labourTeams[0];
  const secondTeam = labourTeams.find((t) => t.id !== firstTeam?.id);
  if (firstTeam && secondTeam) {
    const moved = teamMembers.find((m) => m.teamId === secondTeam.id);
    if (moved) {
      teamMembers.push({
        id: "demo-tm-history-1",
        orgId,
        teamId: firstTeam.id,
        employeeId: moved.employeeId,
        joinedAt: now - 150 * DAY,
        leftAt: now - 82 * DAY,
        status: "transferred",
        transferredToTeamId: secondTeam.id,
      });
    }
  }

  /* --------------------------------------------- group attendance */

  const groupAttendance: GroupAttendanceRecord[] = [];
  const groupAttendanceMembers: GroupAttendanceMember[] = [];

  /*
   * This morning's capture for the first two gangs. One worker in each is
   * left "not detected" on purpose: a review screen where everything always
   * matches teaches a supervisor to stop reading it.
   */
  labourTeams.slice(0, 2).forEach((team, t) => {
    const roster = teamMembers.filter(
      (m) => m.teamId === team.id && !m.leftAt,
    );
    if (roster.length === 0) return;
    const project = projects.find((p) => p.id === team.projectId)!;
    const today = new Date(now);
    today.setHours(8, 4 + t * 11, 0, 0);
    const capturedAt = today.getTime();
    const gaId = `GA-${new Date(capturedAt).getFullYear()}-${String(128 + t).padStart(6, "0")}`;
    const missing = roster.length > 2 ? roster[roster.length - 1].employeeId : null;
    const matched = roster.filter((m) => m.employeeId !== missing).length;

    groupAttendance.push({
      id: gaId,
      orgId,
      projectId: team.projectId,
      teamId: team.id,
      shiftId: team.shiftId,
      siteEngineerId: team.siteEngineerId ?? DEMO_IDS.supervisor,
      photos: [makeSelfie(`${team.name}`, 190 + t * 40, "Group photo")],
      capturedAt,
      coords: project.geofence.center ?? project.location,
      geofenceStatus: "inside",
      faceCount: matched,
      matchedCount: matched,
      status: "confirmed",
      confirmedBy: team.siteEngineerId ?? DEMO_IDS.supervisor,
      confirmedAt: capturedAt + 90 * 1000,
    });

    roster.forEach((m, i) => {
      const detected = m.employeeId !== missing;
      groupAttendanceMembers.push({
        id: `demo-gam-${t}-${i}`,
        orgId,
        groupAttendanceId: gaId,
        employeeId: m.employeeId,
        detectionStatus: detected ? "detected" : "not-detected",
        matchStatus: detected ? "matched" : "unmatched",
        attendanceStatus: detected ? "present" : "absent",
        reviewStatus: "confirmed",
        distance: detected ? 0.32 + (i % 5) * 0.03 : undefined,
        attendanceId: attendance.find(
          (a) => a.employeeId === m.employeeId && a.date === dateISO(new Date(now)),
        )?.id,
      });
    });
  });

  /* ---------------------------------------------- project notes */

  const noteAttachments: ProjectNoteAttachment[] = [];
  const mkNote = (
    n: number,
    projectId: string,
    title: string,
    body: string,
    category: string,
    priority: NotePriority,
    visibility: NoteVisibility,
    extra: Partial<ProjectNote> = {},
  ): ProjectNote => ({
    id: `demo-note-${n}`,
    orgId,
    projectId,
    authorId: DEMO_IDS.projectManager,
    title,
    body,
    category,
    priority,
    visibility,
    status: "open",
    pinned: false,
    createdAt: now - n * 6 * 60 * 60 * 1000,
    updatedAt: now - n * 6 * 60 * 60 * 1000,
    ...extra,
  });

  const projectNotes: ProjectNote[] = [
    mkNote(1, metro.id, "Concrete pour at 07:00 tomorrow",
      "Block B raft pour starts 7:00 AM. Pump on site from 6:30. Nobody in the pour zone without a banksman.",
      "Schedule", "critical", "project-team", { pinned: true }),
    mkNote(2, metro.id, "Block B painting on hold",
      "Do not start painting Level 3 until electrical first fix is signed off by the consultant.",
      "Quality", "important", "project-team", { pinned: true }),
    mkNote(3, metro.id, "Client inspection Friday 3 PM",
      "Client walkthrough of Levels 1-3. Site to be cleared and barricades straightened by 2 PM.",
      "Client", "important", "managers-engineers",
      { dueDate: new Date(now + 2 * DAY).toISOString().slice(0, 10), remindAt: now + 2 * DAY - 60 * 60 * 1000 }),
    mkNote(4, metro.id, "Material delivery tomorrow morning",
      "12 tonnes of rebar expected 09:00 at the material yard gate. Keep the access road clear.",
      "Material", "normal", "project-team"),
    mkNote(5, tower.id, "Safety inspection 10 AM",
      "EHS walkdown of scaffolding on the east elevation. All harnesses to be inspected beforehand.",
      "Safety", "important", "project-team", { authorId: DEMO_IDS.supervisor }),
    mkNote(6, tower.id, "Retention release pending",
      "Second retention tranche is unpaid past 30 days. Do not discuss commercially with the subcontractor on site.",
      "Payment", "important", "management", { authorId: DEMO_IDS.clientOwner }),
    mkNote(7, residential.id, "Waterproofing started on Block C",
      "Block C terrace waterproofing began today. Curing for 72 hours — keep foot traffic off.",
      "General", "normal", "project-team", { status: "done" }),
  ];

  const workforce: WorkforceState = {
    version: SEED_VERSION,
    users,
    projects,
    attendance,
    points,
    updates,
    notifications: [],
    audit: [
      {
        id: "demo-aud-1",
        at: now - 60 * DAY,
        actorId: DEMO_IDS.hr,
        action: "company.provision",
        target: org.name,
        detail: `${projects.length} premises, ${users.length - 1} people`,
      },
    ],
    outbox: [],
    shifts,
    shiftAssignments,
    comp,
    payPolicy: {
      ...DEFAULT_PAY_POLICY,
      lateDeduction: "per-minute",
      latePerMinuteRate: 2,
      managerSeesSalary: false,
    },
    payrollRuns: [
      {
        id: "demo-payroll-prev",
        orgId,
        month: new Date(now - 32 * DAY).toISOString().slice(0, 7),
        status: "locked",
        adjustments: [],
        approvedBy: DEMO_IDS.payroll,
        approvedAt: now - 26 * DAY,
        lockedAt: now - 25 * DAY,
      },
    ],
    travelSessions,
    petrolRules,
    foodRules,
    allowanceDecisions: [],
    labourTeams,
    teamMembers,
    groupAttendance,
    groupAttendanceMembers,
    projectNotes,
    noteAttachments,
    permissions: {
      location: "granted",
      backgroundLocation: "granted",
      camera: "granted",
      notifications: "granted",
      privacyAccepted: true,
    },
    settings: {
      // The demo walks a site without leaving the room.
      locationSource: "simulated",
      samplingSeconds: 15,
      accuracyFloor: 35,
      minMoveMeters: 3,
      forceOffline: false,
      retentionDays: 90,
      units: "metric",
    },
    session: null,
    activeProjectId: metro.id,
  };

  return { workforce, platform };
}
