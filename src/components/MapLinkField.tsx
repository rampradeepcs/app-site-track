"use client";

/**
 * Place a site from a Google Maps link.
 *
 * Panning a map to find a site is slow, and on a phone it is guesswork. The
 * person creating the project nearly always has a better answer to hand: a
 * link somebody sent them, or a pin they can drop in Google Maps in seconds.
 * Paste it here and the pin and the map both go there.
 *
 * What it takes, most to least common:
 *
 *   https://maps.app.goo.gl/…        the Google Maps app's Share → Copy link
 *   https://www.google.com/maps/…    a link from the browser's address bar
 *   13.082680, 80.270718             long-press a spot → its coordinates
 *
 * A full link and bare coordinates are read on the spot, without asking
 * anybody. A short link has to be followed, and Google sends no CORS headers
 * on the redirect, so a page cannot do that itself: the app follows it over
 * native HTTP, and the web asks /api/map-link. A static host has neither —
 * there the hint never suggests a short link, and pasting one says how to
 * get a link that does not need following.
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { expandShortLink, readMapLink, type MapLink } from "@/lib/maplink";
import { searchPlaces } from "@/lib/geocode";
import type { LatLng } from "@/lib/types";
import { ICheckCircle, IMapPin } from "./WfIcons";

export interface MapLinkHit {
  at: LatLng;
  /** The place's name when the link carries one. */
  name?: string;
  /**
   * Where the point came from. Only "pin" is the place itself; "view" is
   * where the link's map was looking and "name" was found by searching, so
   * both are worth a look on the map before trusting.
   */
  source: "pin" | "view" | "name";
}

type Status =
  | { state: "idle" }
  | { state: "working" }
  | { state: "done"; hit: MapLinkHit }
  | { state: "error"; message: string };

/** Whether this build has /api routes. See next.config.ts. */
const HAS_SERVER = process.env.NEXT_PUBLIC_HAS_SERVER === "1";

const NOT_A_LINK =
  "That isn't a Google Maps link or a pair of coordinates.";
const NO_POINT =
  "That link doesn't say where the place is. Copy the link from the place itself, or long-press the spot in Google Maps and paste its coordinates.";
const SHORT_UNSUPPORTED =
  "Short links can't be opened from this page. Open the link, then paste the full address from your browser's address bar — or long-press the spot in Google Maps and paste the coordinates it copies.";
const COULD_NOT_OPEN =
  "Couldn't open that short link. Check the connection, or paste the coordinates instead.";
const TIMED_OUT =
  "That link is taking too long to open. Check the connection, or paste the coordinates instead.";

/** Long enough for a slow network to follow a few redirects; short enough
 *  that "Opening the link…" never becomes the permanent state. */
const DEADLINE_MS = 20_000;
/** Per request in the app, matching the server route's per-hop limit. */
const HOP_TIMEOUT_MS = 6_000;

const noSubscribe = () => () => {};

/**
 * How to get a link this build can read, for the field's hint.
 *
 * Share → Copy link always gives a short link, which only a build with a
 * server, or the app, can follow — so a static host leads with the two that
 * need nothing. Decided after hydration: the app's pages are prerendered,
 * where nothing is native.
 */
function useMapLinkHowTo(): string {
  const followsShortLinks = useSyncExternalStore(
    noSubscribe,
    () => HAS_SERVER || Capacitor.isNativePlatform(),
    () => HAS_SERVER,
  );
  return followsShortLinks
    ? "In Google Maps: Share → Copy link, or long-press the spot to copy its coordinates."
    : "In Google Maps: long-press the spot to copy its coordinates, or copy the link from the browser's address bar.";
}

export function MapLinkField({
  onPick,
  onBusyChange,
  movedLabel = "Pin moved to",
  effect,
}: {
  onPick: (hit: MapLinkHit) => void;
  /**
   * Whether a paste is still being read. A screen's finishing button should
   * wait for it: Continue or Create pressed meanwhile would save the pin
   * where it was, and leaving abandons the lookup.
   */
  onBusyChange?: (busy: boolean) => void;
  /** What a pick did, for the confirmation — "Map moved to" where it moves
   *  the view rather than the premise. */
  movedLabel?: string;
  /** What a paste will do, where that is not simply "place the pin". */
  effect?: string;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const hintId = useId();
  const howTo = useMapLinkHowTo();
  /* One live lookup at a time: a slow answer must never move the pin after
     a newer paste, an edit, or leaving the screen has replaced it. */
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<AbortController | null>(null);
  /*
   * The newest handler, not the one from the render the paste happened in.
   * A short link takes a second or two, and the screen around the field
   * moves on meanwhile — a name typed, a shape switched — so the handler it
   * captured then would act on a screen that no longer exists.
   */
  const onPickRef = useRef(onPick);
  const onBusyRef = useRef(onBusyChange);
  useEffect(() => {
    onPickRef.current = onPick;
    onBusyRef.current = onBusyChange;
  });

  /* Said once per change, so a parent can hang a button's state on it. */
  const busy = useRef(false);
  const setBusy = (b: boolean) => {
    if (busy.current === b) return;
    busy.current = b;
    onBusyRef.current?.(b);
  };

  const cancel = () => {
    seq.current += 1;
    window.clearTimeout(timer.current);
    inflight.current?.abort();
    inflight.current = null;
  };

  /*
   * Leaving the screen abandons the lookup — the screens that use this hold
   * their finishing button while it is busy, so this is Back, or the
   * geofence editor's shape switch, where the paste meant something else.
   * Busy is cleared on the way out, or a button would stay held for a field
   * that no longer exists.
   */
  useEffect(() => {
    const s = seq;
    const t = timer;
    const f = inflight;
    const b = busy;
    const report = onBusyRef;
    return () => {
      s.current += 1;
      window.clearTimeout(t.current);
      f.current?.abort();
      if (b.current) {
        b.current = false;
        report.current?.(false);
      }
    };
  }, []);

  const apply = async (value: string) => {
    cancel();
    const id = seq.current;
    if (!value.trim()) {
      setStatus({ state: "idle" });
      setBusy(false);
      return;
    }
    const link = readMapLink(value);
    if (!link || link.kind === "unlocatable") {
      setStatus({ state: "error", message: link ? NO_POINT : NOT_A_LINK });
      setBusy(false);
      return;
    }
    const ctl = new AbortController();
    inflight.current = ctl;
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, DEADLINE_MS);
    setStatus({ state: "working" });
    setBusy(true);
    try {
      const hit = await Promise.race([locate(link, ctl.signal), rejectOnAbort(ctl.signal)]);
      // Replaced by a newer paste or edit, which now owns the busy state.
      if (seq.current !== id) return;
      setStatus({ state: "done", hit });
      onPickRef.current(hit);
      setBusy(false);
    } catch (e) {
      if (seq.current !== id) return;
      setStatus({
        state: "error",
        message: timedOut ? TIMED_OUT : e instanceof Error ? e.message : NO_POINT,
      });
      setBusy(false);
    } finally {
      window.clearTimeout(deadline);
      if (inflight.current === ctl) inflight.current = null;
    }
  };

  return (
    <div className="flex flex-col">
      <div className="relative">
        <IMapPin
          size={15}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-[var(--wf-faint)]"
        />
        <input
          className="wf-input wf-input-search"
          /* Text rather than url: a url input strips the line break from
             share text, and coordinates are not a URL at all. */
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a Google Maps link or coordinates"
          aria-label="Google Maps link or coordinates"
          /* The hint, which does not change while it is being read. Not the
             status: that is a live region already, and describing a focused
             field by its own live region gets every message read twice. */
          aria-describedby={hintId}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            // Any edit abandons what was being looked up — a link cleared or
            // replaced must not still move the pin when it arrives.
            cancel();
            setStatus({ state: "idle" });
            if (!v.trim()) {
              setBusy(false);
              return;
            }
            // Busy from the first keystroke, not from the lookup: Continue
            // pressed inside the pause would otherwise beat the paste.
            setBusy(true);
            // A paste arrives whole; typing arrives a character at a time,
            // and half a coordinate is a real place somewhere else.
            timer.current = window.setTimeout(() => void apply(v), 400);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void apply(text);
            }
          }}
        />
      </div>
      {/* Always rendered, so a screen reader announces what changes in it
          rather than missing the first message. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        <StatusLine status={status} movedLabel={movedLabel} />
      </div>
      {/* Here rather than as the Field's hint, so it can be the input's
          description: the Field's sits in a label the input's own name
          overrides, and was never read out. */}
      <span id={hintId} className="mt-1 block text-xs text-[var(--wf-faint)]">
        {effect ? `${effect} ` : ""}
        {howTo}
      </span>
    </div>
  );
}

function StatusLine({ status, movedLabel }: { status: Status; movedLabel: string }) {
  if (status.state === "working") {
    return <p className="mt-1.5 text-[0.78rem] text-[var(--wf-muted)]">Opening the link…</p>;
  }
  if (status.state === "error") {
    return (
      <p className="mt-1.5 text-[0.78rem] leading-relaxed text-[var(--wf-amber)]">{status.message}</p>
    );
  }
  if (status.state !== "done") return null;
  const { hit } = status;
  const where = (
    <>
      {hit.name ? `${hit.name} · ` : ""}
      <span className="tabular-nums">
        {hit.at.lat.toFixed(5)}, {hit.at.lng.toFixed(5)}
      </span>
    </>
  );
  if (hit.source === "pin") {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-[0.78rem] text-[var(--wf-green)]">
        <ICheckCircle size={14} className="mt-0.5 shrink-0" />
        <span>
          {movedLabel} {where}
        </span>
      </p>
    );
  }
  return (
    <p className="mt-1.5 text-[0.78rem] leading-relaxed text-[var(--wf-amber)]">
      {hit.source === "name" ? (
        <>
          The link only names “{hit.name}”, so it was found by name — check on
          the map that it is the site.
        </>
      ) : (
        <>
          {movedLabel} {where}. The link gives where its map was looking rather
          than a pinned place, so check on the map that it is the site.
        </>
      )}
    </p>
  );
}

/** Turn whatever was pasted into a point, following it where it must. */
async function locate(link: MapLink, signal: AbortSignal): Promise<MapLinkHit> {
  switch (link.kind) {
    case "point":
      return { at: link.at, name: link.name, source: link.approximate ? "view" : "pin" };
    case "unlocatable":
      throw new Error(NO_POINT);
    case "short": {
      const read = readMapLink(await expand(link.url, signal));
      if (!read || read.kind === "short") throw new Error(NO_POINT);
      return locate(read, signal);
    }
    case "name": {
      let hits;
      try {
        hits = await searchPlaces(link.name, signal, 1);
      } catch {
        throw new Error(
          `The link only names “${link.name}”, and the place search can't be reached right now. Try again, or paste the spot's coordinates.`,
        );
      }
      if (!hits.length) {
        throw new Error(
          `The link only names “${link.name}”, and no place by that name was found. Paste the spot's coordinates instead.`,
        );
      }
      return { at: hits[0].at, name: link.name, source: "name" };
    }
  }
}

/** A short link's full address, or an error that says what to do instead. */
async function expand(url: string, signal: AbortSignal): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const full = await expandShortLink(url, async (at) => {
      if (signal.aborted) return null;
      try {
        // Both timeouts: Android applies them separately, and without them
        // HttpURLConnection waits for ever on a stalled connection.
        const res = await CapacitorHttp.get({
          url: at,
          disableRedirects: true,
          connectTimeout: HOP_TIMEOUT_MS,
          readTimeout: HOP_TIMEOUT_MS,
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = Object.entries(res.headers).find(
            ([k]) => k.toLowerCase() === "location",
          )?.[1];
          return loc ?? null;
        }
        // A platform that followed the redirect anyway still says where it
        // ended up.
        return res.url && res.url !== at ? res.url : null;
      } catch {
        return null;
      }
    });
    if (!full) throw new Error(COULD_NOT_OPEN);
    return full;
  }

  if (!HAS_SERVER) throw new Error(SHORT_UNSUPPORTED);

  let res: Response;
  try {
    res = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/map-link?url=${encodeURIComponent(url)}`,
      { signal },
    );
  } catch {
    throw new Error(COULD_NOT_OPEN);
  }
  // Anything but our JSON is a host without the route, whatever the build
  // flag said.
  if (!res.headers.get("content-type")?.includes("application/json")) {
    throw new Error(SHORT_UNSUPPORTED);
  }
  const body: { url?: string; error?: string } = await res.json();
  if (!res.ok || !body.url) throw new Error(body.error ?? NO_POINT);
  return body.url;
}

/** Settles only by rejecting, when the lookup is abandoned or times out. */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const stop = () => reject(new Error("aborted"));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}
