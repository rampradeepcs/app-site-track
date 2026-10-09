/**
 * A Google Maps link, read for the point it names.
 *
 * Finding a site by panning a map is the slowest way to place one, and the
 * person creating it usually has the answer already: a link somebody sent on
 * WhatsApp, or the pin they dropped in Google Maps a minute ago. This turns
 * that into a point, without asking Google for anything when the link
 * already says where it is — which a full link nearly always does.
 *
 * Shared by the browser and the server route that expands short links, so it
 * uses nothing either side lacks.
 */

import type { LatLng } from "./types";

export type MapLink =
  /**
   * A point, read out of what was pasted. `approximate` when it is only
   * where the link's map was looking rather than a pinned place — close on a
   * link to one place, arbitrary on a list of search results.
   */
  | { kind: "point"; at: LatLng; name?: string; approximate?: boolean }
  /** A place the link names but does not locate. Found by name instead. */
  | { kind: "name"; name: string }
  /**
   * A short link — what the Share button in the Google Maps app produces.
   * The point is behind a redirect, and Google sends no CORS headers on it,
   * so a page cannot follow it; see expandShortLink.
   */
  | { kind: "short"; url: string }
  /** A map link that carries no location at all — a ?cid= business link. */
  | { kind: "unlocatable" };

/**
 * Query parameters that carry a point, most specific first. A route's
 * destination is read before any of them, in readRoute.
 */
const POINT_PARAMS = ["q", "query", "ll", "center", "sll"];

/**
 * The ones that are only where the map was looking. On Google that includes
 * ll — on a search it is the middle of the results — while on Apple Maps and
 * Waze ll is the place itself.
 */
const VIEW_PARAMS = new Set(["center", "sll"]);
const GOOGLE_VIEW_PARAMS = new Set(["ll", "center", "sll"]);

/** Parameters that carry a place's name when they are not a point. */
const NAME_PARAMS = ["q", "query"];

/** Far beyond any real link or share text; past it, the paste is not one. */
const MAX_INPUT = 16_384;

/**
 * Read whatever was pasted: a link, share text with links in it, or bare
 * coordinates. Null when it is none of those.
 */
export function readMapLink(input: string): MapLink | null {
  const text = input.trim();
  if (!text || text.length > MAX_INPUT) return null;

  // Bare coordinates — what Google Maps copies when you long-press a spot.
  const plain = readCoordinates(text);
  if (plain) return { kind: "point", at: plain };

  // Android's own share format: geo:lat,lng, or geo:0,0?q=<address>.
  if (/^geo:/i.test(text)) return readGeoUri(text);

  /*
   * Every link in it, not just the first: a business's share card puts its
   * website ahead of its map link, and the Google Maps app's Share sends
   * "Place name\nhttps://maps.app.goo.gl/…".
   */
  const urls: URL[] = [];
  for (const m of text.matchAll(/https?:\/\/\S+/gi)) {
    try {
      urls.push(new URL(trimTrailing(m[0])));
    } catch {
      // Looked like a link and was not one.
    }
  }

  const short = urls.find(isShortMapLink);
  if (short) {
    // Older shares are http://; both shorteners serve https, and nothing
    // here should make a cleartext request.
    short.protocol = "https:";
    return { kind: "short", url: short.href };
  }

  // A point from any host: Apple Maps and Waze carry ?ll= as well, and
  // coordinates are coordinates wherever they are written.
  const read = urls.map(readFullLink);
  const isPoint = (r: MapLink | null): r is Extract<MapLink, { kind: "point" }> =>
    r?.kind === "point";
  const point =
    read.find((r) => isPoint(r) && !r.approximate) ?? read.find(isPoint);
  if (point) return point;

  // A name, only from a map link: a website's ?q= is a search, not a place.
  const map = urls.findIndex(isMapsLink);
  if (map >= 0) return read[map] ?? { kind: "unlocatable" };
  return null;
}

/** Google's link shorteners — the only hosts expandShortLink ever fetches. */
export function isShortMapLink(url: URL): boolean {
  // Only a web address is one: data:, blob: and the like can carry any
  // hostname, and a protocol change cannot make them https.
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl") return true;
  // goo.gl was a general shortener; only its /maps/ links are map links.
  return (host === "goo.gl" || host === "www.goo.gl") && url.pathname.startsWith("/maps");
}

/** A link to a map, as opposed to a link that happens to have a ?q=. */
function isMapsLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (isGoogleMaps(url)) return true;
  return host === "maps.apple.com" || host === "waze.com" || host === "www.waze.com";
}

function isGoogleMaps(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const google = /^(?:www\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
  if (/^maps\./.test(host) && google.test(host.slice(5))) return true;
  return google.test(host) && url.pathname.startsWith("/maps");
}

/**
 * Follow a short link's redirects until they reach a full link.
 *
 * `hop` makes one request without following it and returns where it points
 * (or the final address, on a client that follows redirects regardless).
 * Only shortener addresses are ever handed to it, always over https: the
 * loop stops at the first full link and reads it rather than loading it, so
 * this cannot be steered into fetching anything else — which is what keeps
 * the server route that uses it from being a general-purpose proxy. That
 * full link may be http; it is parsed, never requested.
 */
export async function expandShortLink(
  start: string,
  hop: (url: string) => Promise<string | null>,
): Promise<string | null> {
  let current: URL;
  try {
    current = new URL(start);
  } catch {
    return null;
  }
  for (let i = 0; i < 4; i++) {
    if (!isShortMapLink(current)) return current.href;
    current.protocol = "https:";
    // The invariant hop() relies on, checked rather than assumed.
    if (current.protocol !== "https:") return null;
    const next = await hop(current.href);
    if (!next) return null;
    try {
      current = new URL(next, current);
    } catch {
      return null;
    }
  }
  return isShortMapLink(current) ? null : current.href;
}

/**
 * A full link, most precise reading first.
 *
 * The place's own pin beats any coordinate in the query, and both beat the
 * `@lat,lng` in the path — which is only where the map was looking when the
 * link was copied, and is said to be so.
 */
function readFullLink(url: URL): MapLink | null {
  const segs = url.pathname.split("/").map(decodeSegment);

  // Directions are read for where they end, never for where they start.
  if (segs[1] === "maps" && segs[2] === "dir") return readDirections(url, segs.slice(3));

  // The classic ?saddr=…&daddr=… route. Its ll is the middle of the route,
  // so it is never read — not even as an approximation.
  const dest = url.searchParams.get("destination") ?? url.searchParams.get("daddr");
  if (dest !== null || url.searchParams.has("saddr")) return dest ? readStop(dest) : null;

  const name = placeName(url, segs);
  const views = isGoogleMaps(url) ? GOOGLE_VIEW_PARAMS : VIEW_PARAMS;

  // data=…!3d<lat>!4d<lng>: the pin of the place the link is about.
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url.href);
  if (pin) {
    const at = toLatLng(pin[1], pin[2]);
    if (at) return { kind: "point", at, name };
  }

  for (const key of POINT_PARAMS) {
    const v = url.searchParams.get(key);
    if (!v) continue;
    const at = readCoordinates(pointText(v));
    if (at) {
      return {
        kind: "point",
        at,
        name: name ?? labelOf(v),
        approximate: views.has(key) || undefined,
      };
    }
  }

  // /maps/search/13.0827,+80.2707 — coordinates as a path segment, sometimes
  // in degrees, minutes and seconds.
  for (const seg of segs) {
    const at = readCoordinates(seg);
    if (at) return { kind: "point", at, name };
  }

  const view = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url.pathname);
  if (view) {
    const at = toLatLng(view[1], view[2]);
    if (at) return { kind: "point", at, name, approximate: true };
  }

  return name ? { kind: "name", name } : null;
}

/**
 * /maps/dir/<from>/<…>/<to>/@view/data=… — the last stop is the site.
 *
 * Given as coordinates it is in the path. Given as a name, its point is in
 * the data blob as !1d<lng>!2d<lat>, longitude first, one pair per stop that
 * has one; the last pair is the last stop. The view is the middle of the
 * route and is never used.
 */
function readDirections(url: URL, rest: string[]): MapLink | null {
  const stops: string[] = [];
  for (const s of rest) {
    if (s.startsWith("@") || s.startsWith("data=")) break;
    if (s) stops.push(s);
  }
  const dest = stops.at(-1);
  if (dest) {
    const at = readCoordinates(dest);
    if (at) return { kind: "point", at };
    const pairs = [...url.href.matchAll(/!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g)];
    const last = pairs.at(-1);
    const fromData = last ? toLatLng(last[2], last[1]) : null;
    if (fromData) return { kind: "point", at: fromData, name: dest };
    return { kind: "name", name: dest };
  }
  // /maps/dir/?api=1&destination=…
  const q = url.searchParams.get("destination") ?? url.searchParams.get("daddr");
  return q ? readStop(q) : null;
}

/**
 * A route's destination as a query value. "A to:B" is a route with two
 * stops and B is the last; a stop may be "Name@lat,lng", coordinates with a
 * (Label), or just a name.
 */
function readStop(dest: string): MapLink | null {
  const stop = dest.split(/\s+to:/i).at(-1)?.trim() ?? "";
  if (!stop) return null;
  const at = stop.lastIndexOf("@");
  if (at > 0) {
    const p = readCoordinates(stop.slice(at + 1));
    if (p) return { kind: "point", at: p, name: stop.slice(0, at).trim() || undefined };
  }
  const point = readCoordinates(pointText(stop));
  if (point) return { kind: "point", at: point, name: labelOf(stop) };
  return { kind: "name", name: stop };
}

/** /maps/place/<name>/…, /maps/search/<query>/…, or a ?q= that is words. */
function placeName(url: URL, segs: string[]): string | undefined {
  for (const key of ["place", "search"]) {
    const i = segs.indexOf(key);
    const seg = i >= 0 ? segs[i + 1] : undefined;
    if (seg && !seg.startsWith("@") && !seg.startsWith("data=") && !readCoordinates(seg)) {
      return seg;
    }
  }
  for (const key of NAME_PARAMS) {
    const v = url.searchParams.get(key)?.trim();
    if (v && !readCoordinates(pointText(v))) return v;
  }
  return undefined;
}

function readGeoUri(text: string): MapLink | null {
  const m = /^geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i.exec(text);
  const at = m ? toLatLng(m[1], m[2]) : null;
  if (at) return { kind: "point", at };
  // geo:0,0?q=… means "no point, search for this instead".
  const raw = /[?&]q=([^&]+)/.exec(text)?.[1];
  if (!raw) return null;
  const q = decodeSegment(raw);
  const inQuery = readCoordinates(pointText(q));
  return inQuery
    ? { kind: "point", at: inQuery, name: labelOf(q) }
    : { kind: "name", name: q };
}

/**
 * A query value made ready to read as coordinates: no `loc:` prefix, and no
 * `(Label)` after them — ?q=13.0823,80.2754(Site+Office) is a point with a
 * name, not a name.
 */
function pointText(v: string): string {
  const s = v.replace(/^loc:/i, "");
  const open = trailingLabel(s);
  return open < 0 ? s : s.slice(0, open).trimEnd();
}

/** The `(Label)` after a point, if there is one. */
function labelOf(v: string): string | undefined {
  const open = trailingLabel(v);
  if (open < 0) return undefined;
  const close = v.indexOf(")", open);
  return v.slice(open + 1, close < 0 ? undefined : close).trim() || undefined;
}

/**
 * Where a trailing "(…)" starts, or -1. Found by index rather than by a
 * regular expression: this runs on every query value of every pasted link,
 * and a pattern anchored at the end backtracks badly on a long one.
 */
function trailingLabel(s: string): number {
  const open = s.lastIndexOf("(");
  if (open < 0) return -1;
  const close = s.indexOf(")", open);
  // Something after the closing parenthesis: not a label at the end.
  return close >= 0 && s.slice(close + 1).trim() ? -1 : open;
}

/**
 * Sentence punctuation after a pasted link is not part of it — but a closing
 * parenthesis the link itself opened is: ?q=13.08,80.27(Site+Office).
 * One pass to count, one walk back: linear however much punctuation follows.
 */
function trimTrailing(link: string): string {
  let opens = 0;
  let closes = 0;
  for (const ch of link) {
    if (ch === "(") opens += 1;
    else if (ch === ")") closes += 1;
  }
  let end = link.length;
  while (end > 0) {
    const last = link[end - 1];
    if (!")]}>.,;!?'\"".includes(last)) break;
    if (last === ")") {
      if (opens >= closes) break;
      closes -= 1;
    }
    end -= 1;
  }
  return link.slice(0, end);
}

/**
 * Coordinates as people paste them:
 *
 *   13.082680, 80.270718            (Google Maps' long-press copy)
 *   13.0827° N, 80.2707° E
 *   13°04'57.7"N 80°16'14.6"E       (shown under a dropped pin)
 *
 * Decimals are required. A pair of whole numbers is far more often a phone
 * number or a quantity than a place, and Google never writes one.
 */
export function readCoordinates(text: string): LatLng | null {
  // Runs of spaces collapsed first, so every \s* below matches at most one
  // character — without that, a long run makes the patterns backtrack.
  const t = text.trim().replace(/\s+/g, " ");

  const dec =
    /^(-?\d{1,3}\.\d+)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d{1,3}\.\d+)\s*°?\s*([EW])?$/i.exec(t);
  if (dec) {
    const lat = Number(dec[1]) * (/s/i.test(dec[2] ?? "") ? -1 : 1);
    const lng = Number(dec[3]) * (/w/i.test(dec[4] ?? "") ? -1 : 1);
    return valid(lat, lng);
  }

  const dms =
    /^(\d{1,2})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]?\s*([NS])[\s,]+(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]?\s*([EW])$/i.exec(
      t,
    );
  if (dms) {
    const lat =
      (Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600) *
      (/s/i.test(dms[4]) ? -1 : 1);
    const lng =
      (Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600) *
      (/w/i.test(dms[8]) ? -1 : 1);
    return valid(lat, lng);
  }
  return null;
}

function toLatLng(lat: string, lng: string): LatLng | null {
  return valid(Number(lat), Number(lng));
}

/** In range, and not 0,0 — which is a placeholder, not a site. */
function valid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg.replace(/\+/g, " ")).trim();
  } catch {
    return seg.replace(/\+/g, " ").trim();
  }
}
