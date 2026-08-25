/**
 * Where a worker is allowed to close a shift.
 *
 * Under `outside-only` tracking the trail only exists while the worker is
 * away from the boundary, so the shift has to end somewhere known — otherwise
 * it could be closed mid-trip and the record would simply stop, with no way
 * to tell a finished day from an abandoned one.
 *
 * "Somewhere known" means any premise the worker is assigned to, not only the
 * one they checked in at. A crew that leaves a site to deliver material and
 * signs off at the office has done nothing wrong, and the product should not
 * make them drive back to prove it.
 */

import { checkGeofence, distanceMeters } from "./geo";
import type { LatLng, Project, User } from "./types";

export interface PremiseFix {
  premise: Project;
  /** Metres from the fix to the premise centre. */
  distance: number;
}

/** Every premise this worker may start or end a shift at. */
export function assignedPremises(projects: Project[], user: User): Project[] {
  return projects.filter((p) => user.projectIds.includes(p.id));
}

/** The premise the fix is standing inside, if any. */
export function premiseAt(coords: LatLng, premises: Project[]): Project | null {
  return premises.find((p) => checkGeofence(coords, p.geofence).inside) ?? null;
}

/** Closest premise to the fix, for telling someone where to go. */
export function nearestPremise(
  coords: LatLng,
  premises: Project[],
): PremiseFix | null {
  let best: PremiseFix | null = null;
  for (const premise of premises) {
    const distance = distanceMeters(coords, premise.location);
    if (!best || distance < best.distance) best = { premise, distance };
  }
  return best;
}

/** "the office" / "the site" — reads naturally mid-sentence. */
export function premiseNoun(p: Project): string {
  return p.kind === "office" ? "office" : "site";
}
