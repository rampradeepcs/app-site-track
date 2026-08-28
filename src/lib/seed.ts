/**
 * The state Workfence starts from: nothing.
 *
 * No organisation, no people, no premises, no history. A fresh install has
 * never been used, and the app now says so rather than inventing a company to
 * stand in for one.
 *
 * That became possible when signup did. Before `/start` existed, the app had
 * to ship with a tenant or there was no way to see past the sign-in screen,
 * and the placeholder people that made it demoable were also the thing that
 * made it impossible to tell real data from filler. Now the first screen
 * offers to create a company, and everything after it is something a person
 * actually did.
 *
 * `supabase/bootstrap.sql` starts from the same nothing, seating only the
 * platform owner so the first sign-in resolves to somebody.
 */

import { DEFAULT_PAY_POLICY } from "./payroll";
import type { WorkforceState } from "./types";

/**
 * Shape version of the persisted store. A browser holding anything else
 * discards it and starts fresh.
 *
 * Exported from here because this file decides the shape. It used to be
 * declared separately in the store as well, and the two drifted the moment
 * one was bumped — which silently threw away every reload's session.
 *
 * v6 empties the seed. The bump matters: a browser still holding v5 has the
 * old invented company in it, and that data must not survive the change.
 */
export const SEED_VERSION = 6;

/**
 * Generated SVG selfie placeholder, for a check-in where the camera was
 * declined or unavailable. Not seed data — it is produced at the moment a
 * real shift opens, and stands in for a photo that person chose not to take.
 */
export function makeSelfie(name: string, hue: number, label: string): string {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="hsl(${hue} 42% 22%)"/><circle cx="120" cy="92" r="44" fill="hsl(${hue} 55% 62%)"/><rect x="48" y="150" width="144" height="70" rx="34" fill="hsl(${hue} 55% 62%)"/><text x="120" y="106" font-family="system-ui" font-size="34" font-weight="700" fill="hsl(${hue} 45% 16%)" text-anchor="middle">${initials}</text><text x="120" y="228" font-family="system-ui" font-size="17" fill="rgba(255,255,255,0.85)" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * An empty install.
 *
 * The device preferences below are not data — they are how this browser is
 * configured, and they have to start somewhere. Everything that belongs to a
 * company or a person starts empty.
 */
export function buildSeedState(): WorkforceState {
  return {
    version: SEED_VERSION,
    users: [],
    projects: [],
    attendance: [],
    points: [],
    updates: [],
    notifications: [],
    audit: [],
    outbox: [],
    shifts: [],
    shiftAssignments: [],
    comp: [],
    payPolicy: { ...DEFAULT_PAY_POLICY },
    payrollRuns: [],
    travelSessions: [],
    petrolRules: [],
    foodRules: [],
    allowanceDecisions: [],
    permissions: {
      location: "prompt",
      backgroundLocation: "prompt",
      camera: "prompt",
      notifications: "prompt",
      privacyAccepted: false,
    },
    settings: {
      // Real device GPS is the honest default now that there is no simulated
      // site to walk around. The simulator stays available in settings for
      // anyone trying the product away from a real boundary.
      locationSource: "device",
      samplingSeconds: 15,
      accuracyFloor: 35,
      minMoveMeters: 3,
      forceOffline: false,
      retentionDays: 90,
      units: "metric",
    },
    session: null,
    activeProjectId: null,
  };
}
