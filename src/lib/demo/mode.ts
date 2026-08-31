"use client";

/**
 * Demo mode — a complete, fictional Workfence, reachable by one number.
 *
 * The isolation here is not a hidden screen: demo data lives in its own
 * storage namespace, so a demo session and a real one cannot see each
 * other's records even in principle. Entering demo mode swaps which keys
 * the stores read and write; leaving swaps them back, and the real data was
 * never touched (spec §29, §34).
 *
 * Every demo record also carries `isDemo`, so the same guarantee survives a
 * future where this data is written to Postgres rather than a browser.
 */

import { SEED_VERSION } from "../seed";
import type { Role } from "../types";

/** The one address that may enter demo mode (spec §1, §33). */
export const DEMO_EMAIL = "rampradeepux@gmail.com";

const FLAG_KEY = "workfence.demo.active";
const PERSONA_KEY = "workfence.demo.persona";

/** Storage namespaces. Demo and production never share a key. */
export const WORKFORCE_KEY = `workfence.v${SEED_VERSION}`;
export const PLATFORM_KEY = `workfence.platform.v${SEED_VERSION}`;
export const DEMO_WORKFORCE_KEY = `workfence.demo.v${SEED_VERSION}`;
export const DEMO_PLATFORM_KEY = `workfence.demo.platform.v${SEED_VERSION}`;

/**
 * Whether this browser is currently in demo mode.
 *
 * Read synchronously from localStorage rather than React state because the
 * stores need it while choosing a storage key, before any component mounts.
 */
export function demoActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function workforceKey(): string {
  return demoActive() ? DEMO_WORKFORCE_KEY : WORKFORCE_KEY;
}

export function platformKey(): string {
  return demoActive() ? DEMO_PLATFORM_KEY : PLATFORM_KEY;
}

export function setDemoActive(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG_KEY, "1");
    else {
      localStorage.removeItem(FLAG_KEY);
      localStorage.removeItem(PERSONA_KEY);
    }
  } catch {
    /* private mode — demo mode simply will not persist across a reload */
  }
}

/** Wipe the demo namespace so the next entry reseeds from scratch (spec §28). */
export function clearDemoData(): void {
  try {
    localStorage.removeItem(DEMO_WORKFORCE_KEY);
    localStorage.removeItem(DEMO_PLATFORM_KEY);
  } catch {
    /* nothing to clear */
  }
}

/* -------------------------------------------------------------- personas */

/**
 * A persona is a seat at the demo company, not a separate login. Switching
 * one changes who the app thinks is signed in — the dashboard, permissions
 * and data follow from the role and the org, exactly as they would for a
 * real person (spec §2, §3).
 */
export interface Persona {
  id: string;
  emoji: string;
  title: string;
  name: string;
  subtitle: string;
  cta: string;
  role: Role;
  /** Stable id of the seeded user this persona signs in as. */
  userId: string;
}

/** Ids the seed mints, so personas and records agree. */
export const DEMO_IDS = {
  org: "demo-org-abc",
  owner: "demo-user-owner",
  clientOwner: "demo-user-client-owner",
  hr: "demo-user-hr",
  projectManager: "demo-user-pm",
  supervisor: "demo-user-supervisor",
  employee: "demo-user-employee",
  traveller: "demo-user-traveller",
  payroll: "demo-user-payroll",
} as const;

export const PERSONAS: Persona[] = [
  {
    id: "owner",
    emoji: "👑",
    title: "Product Owner",
    name: "Arun Demo",
    subtitle: "Super Admin · Workfence",
    cta: "Explore platform",
    role: "superadmin",
    userId: DEMO_IDS.owner,
  },
  {
    id: "client-owner",
    emoji: "🏢",
    title: "Client Owner",
    name: "Rajesh Kumar",
    subtitle: "ABC Infrastructure",
    cta: "Explore client",
    role: "admin",
    userId: DEMO_IDS.clientOwner,
  },
  {
    id: "hr",
    emoji: "🗂",
    title: "Client Admin / HR",
    name: "Divya Raman",
    subtitle: "People & compliance",
    cta: "Manage people",
    role: "admin",
    userId: DEMO_IDS.hr,
  },
  {
    id: "pm",
    emoji: "👨‍💼",
    title: "Project Manager",
    name: "Suresh Babu",
    subtitle: "Chennai Metro — Package A",
    cta: "Manage projects",
    role: "manager",
    userId: DEMO_IDS.projectManager,
  },
  {
    id: "supervisor",
    emoji: "🦺",
    title: "Site Supervisor",
    name: "Karthik Selvam",
    subtitle: "Chennai Metro — Package A",
    cta: "Manage workforce",
    role: "manager",
    userId: DEMO_IDS.supervisor,
  },
  {
    id: "payroll",
    emoji: "💰",
    title: "Payroll Manager",
    name: "Priya Narayan",
    subtitle: "ABC Infrastructure",
    cta: "View payroll",
    role: "admin",
    userId: DEMO_IDS.payroll,
  },
  {
    id: "employee",
    emoji: "👷",
    title: "Employee",
    name: "Arun Kumar",
    subtitle: "Mason · Chennai Metro",
    cta: "Start shift",
    role: "employee",
    userId: DEMO_IDS.employee,
  },
  {
    id: "traveller",
    emoji: "🛵",
    title: "Employee — Travel",
    name: "Vignesh Raj",
    subtitle: "Store Keeper · runs material",
    cta: "Show travel & allowance",
    role: "employee",
    userId: DEMO_IDS.traveller,
  },
];

export function personaById(id: string | null): Persona | null {
  return PERSONAS.find((p) => p.id === id) ?? null;
}

export function currentPersonaId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(PERSONA_KEY);
  } catch {
    return null;
  }
}

export function setCurrentPersona(id: string): void {
  try {
    localStorage.setItem(PERSONA_KEY, id);
  } catch {
    /* the persona still applies for this page view */
  }
}
