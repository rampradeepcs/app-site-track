"use client";

/**
 * A pin, turned back into an address.
 *
 * The other direction already exists, inside LocationSearch: type a place,
 * get a point. This is the return trip, and it is what lets the boundary be
 * the only thing anybody sets. An address typed by hand and a pin dropped on
 * a map are two answers to one question, and on a site they disagree — the
 * gate is on a road the postal address has never heard of.
 *
 * Nominatim again, the same key-free OpenStreetMap service whose tiles the
 * map already draws. Which means it can be slow, rate-limited, or simply
 * wrong about a half-built road, so every caller has to survive getting
 * nothing back. The address is a label for people; the geofence is the fact.
 */

import type { LatLng } from "./types";

export interface PlaceAddress {
  /** The whole thing, for a field somebody reads. */
  label: string;
  /** Road or neighbourhood — what you would say to a driver. */
  street: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

interface NominatimAddress {
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  village?: string;
  town?: string;
  city?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

/**
 * Ask what is at this point. Resolves to null rather than throwing: a
 * lookup that fails is a missing label, not a broken screen.
 *
 * `zoom=18` asks for building-level detail. Lower and a site on the edge of
 * a city comes back as the city, which is not an address anybody can drive
 * to.
 */
export async function reverseGeocode(
  at: LatLng,
  signal?: AbortSignal,
): Promise<PlaceAddress | null> {
  try {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1" +
        `&lat=${encodeURIComponent(String(at.lat))}&lon=${encodeURIComponent(String(at.lng))}`,
      { headers: { Accept: "application/json" }, signal },
    );
    if (!res.ok) return null;
    const row: { display_name?: string; address?: NominatimAddress } = await res.json();
    const a = row.address ?? {};
    const label = row.display_name?.trim();
    if (!label) return null;
    return {
      label,
      /* Road first, then the smaller named things, because "Anna Nagar" is
         more use to somebody finding a gate than the district is. */
      street: a.road ?? a.neighbourhood ?? a.suburb ?? "",
      city: a.city ?? a.town ?? a.village ?? a.county ?? "",
      state: a.state ?? "",
      postcode: a.postcode ?? "",
      country: a.country ?? "",
    };
  } catch {
    // Includes the abort, which is a newer request having replaced this one.
    return null;
  }
}
