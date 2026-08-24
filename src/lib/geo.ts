/**
 * Geospatial helpers — haversine distances, point-in-polygon geofencing and a
 * Web-Mercator projection used by the schematic site map renderer.
 */

import type { Geofence, LatLng, SiteZone } from "./types";

export const EARTH_RADIUS_M = 6371008.8;

const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Sum of leg distances along a trail, in metres. */
export function pathDistanceMeters(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1], points[i]);
  }
  return total;
}

/** Ray-casting point-in-polygon (lat/lng treated as planar — fine at site scale). */
export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.lng > p.lng !== b.lng > p.lng &&
      p.lat < ((b.lat - a.lat) * (p.lng - a.lng)) / (b.lng - a.lng) + a.lat;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon edge (metres). 0 when on the boundary. */
export function distanceToPolygonEdge(p: LatLng, polygon: LatLng[]): number {
  let min = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    min = Math.min(min, distanceToSegment(p, polygon[j], polygon[i]));
  }
  return min;
}

function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  // Work in a local equirectangular frame centred on `a`.
  const kx = Math.cos(toRad(a.lat)) * EARTH_RADIUS_M * (Math.PI / 180);
  const ky = EARTH_RADIUS_M * (Math.PI / 180);
  const px = (p.lng - a.lng) * kx;
  const py = (p.lat - a.lat) * ky;
  const bx = (b.lng - a.lng) * kx;
  const by = (b.lat - a.lat) * ky;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

export interface FenceCheck {
  inside: boolean;
  /** Metres to the fence boundary: negative when inside. */
  distance: number;
  /** Within the buffer band just outside the fence. */
  nearBoundary: boolean;
}

export function checkGeofence(p: LatLng, fence: Geofence): FenceCheck {
  if (fence.kind === "circle") {
    const d = distanceMeters(p, fence.center) - fence.radius;
    return { inside: d <= 0, distance: d, nearBoundary: d > 0 && d <= fence.bufferMeters };
  }
  const inside = pointInPolygon(p, fence.polygon);
  const edge = distanceToPolygonEdge(p, fence.polygon);
  const distance = inside ? -edge : edge;
  return { inside, distance, nearBoundary: !inside && edge <= fence.bufferMeters };
}

/** Nearest named zone (within its radius ×1.6), else a compass hint. */
export function resolvePlace(p: LatLng, zones: SiteZone[], site: LatLng): string {
  let best: { zone: SiteZone; d: number } | null = null;
  for (const zone of zones) {
    const d = distanceMeters(p, zone.center);
    if (d <= zone.radius * 1.6 && (!best || d < best.d)) best = { zone, d };
  }
  if (best) return best.zone.name;
  const d = distanceMeters(p, site);
  if (d < 30) return "Site Center";
  const bearing = bearingDegrees(site, p);
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${dirs[Math.round(bearing / 45) % 8]} sector`;
}

export function bearingDegrees(from: LatLng, to: LatLng): number {
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/** Move `meters` from a point along `bearing` degrees. */
export function offsetMeters(p: LatLng, meters: number, bearing: number): LatLng {
  const dLat = (meters * Math.cos(toRad(bearing))) / EARTH_RADIUS_M;
  const dLng =
    (meters * Math.sin(toRad(bearing))) /
    (EARTH_RADIUS_M * Math.cos(toRad(p.lat)));
  return {
    lat: p.lat + dLat * (180 / Math.PI),
    lng: p.lng + dLng * (180 / Math.PI),
  };
}

/* ------------------------------------------------------- map projection */

/** Web-Mercator normalised to [0,1]² — multiply by world pixel size. */
export function mercator(p: LatLng): { x: number; y: number } {
  const x = (p.lng + 180) / 360;
  const sin = Math.sin(toRad(p.lat));
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return { x, y };
}

export function unmercator(x: number, y: number): LatLng {
  const lng = x * 360 - 180;
  const n = Math.PI * (1 - 2 * y);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/** Ground metres represented by one pixel at a given zoom + latitude. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (
    (Math.cos(toRad(lat)) * 2 * Math.PI * EARTH_RADIUS_M) /
    (256 * Math.pow(2, zoom))
  );
}

/** Bounding box of a set of points, padded by `padMeters`. */
export function boundsOf(points: LatLng[], padMeters = 40): { min: LatLng; max: LatLng } {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const padLat = (padMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const midLat = (minLat + maxLat) / 2;
  const padLng = padLat / Math.max(0.2, Math.cos(toRad(midLat)));
  return {
    min: { lat: minLat - padLat, lng: minLng - padLng },
    max: { lat: maxLat + padLat, lng: maxLng + padLng },
  };
}

/** All geometry of a project worth framing on first render. */
export function fencePoints(fence: Geofence): LatLng[] {
  if (fence.kind === "polygon" && fence.polygon.length) return fence.polygon;
  // Approximate the circle with its bounding square.
  return [0, 90, 180, 270].map((b) => offsetMeters(fence.center, fence.radius, b));
}
