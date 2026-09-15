/**
 * What the phone tells the watch, and what the watch may ask back.
 *
 * One file, deliberately, because three codebases implement it: this one, a
 * Kotlin data class on Wear OS, and a Swift struct on watchOS. Two of those
 * cannot import from here, so the shape is written once in prose and keys
 * and copied by hand — which only stays honest if the shape is small enough
 * to hold in your head and the reason for every field is written down.
 *
 * The watch is a companion, not a second app. The phone holds the session,
 * the offline outbox and the camera, and it remains the only thing that
 * decides whether an action is allowed. The watch renders what it is told
 * and asks for what a worker can reach for without taking a phone out of a
 * pocket at a site gate.
 *
 * Check-in is the deliberate omission. It requires a selfie inside the
 * boundary, and no watch on either platform has a camera that can take one:
 * Apple Watch has none at all, and a Wear OS camera — where it exists — is
 * not a front camera. So the watch never offers it and says where to go
 * instead. Pretending otherwise would mean a button that always fails.
 */

/** Bumped when a field changes meaning. A watch on an older build is told to
 *  update rather than shown numbers it will misread. */
export const WATCH_PROTOCOL = 1;

/** Where the shift stands. Three states, because that is what a worker is:
 *  not started, working, or stood down for a break. */
export type WatchShiftState = "off" | "on" | "break";

export interface WatchNotice {
  id: string;
  title: string;
  /** critical rings; the rest are read when the wrist is raised. */
  severity: "critical" | "important" | "normal";
}

export interface WatchSnapshot {
  v: number;
  state: WatchShiftState;
  /**
   * Epoch ms the current state began: the check-in for "on", the break's
   * start for "break", null for "off".
   *
   * The watch counts up from this on its own rather than being fed a
   * ticking number. A watch out of Bluetooth range keeps showing the right
   * elapsed time, and the phone is not woken once a second to say so.
   */
  since: number | null;
  /** Worked ms today, breaks excluded, true as of `asOf`. */
  workedMs: number;
  /** Break ms today. */
  breakMs: number;
  /** When the numbers above were computed. */
  asOf: number;
  /** Inside the site boundary. null while no fix has been taken yet — which
   *  is not the same as being outside, and must not be drawn as if it were. */
  onSite: boolean | null;
  /** The site they are on, for a screen that has room for about four words. */
  site: string;
  /** The company, shown once on the about screen rather than on every face. */
  company: string;
  /**
   * What the phone will accept right now, decided by the phone.
   *
   * The watch greys what it cannot do rather than guessing the rules, so a
   * company that turns breaks off does not need a watch release.
   */
  can: {
    checkOut: boolean;
    break: boolean;
    travel: boolean;
  };
  /** The trip in progress, when there is one. */
  travel: { active: boolean; label: string } | null;
  /** Pinned site notices, newest first. Trimmed hard: a watch list nobody
   *  scrolls past the third row. */
  notices: WatchNotice[];
}

/**
 * What a watch may ask for.
 *
 * Every one is reversible or additive. Nothing here can lose a day's work:
 * the destructive edge of attendance is check-in, which is not offered.
 */
export type WatchCommand =
  | "break.start"
  | "break.end"
  | "checkout"
  | "travel.start"
  | "travel.end"
  /** Ask the phone to publish a fresh snapshot — the watch asks on wake. */
  | "refresh";

/** The phone's answer. `reason` is written for a 40mm screen: short, and
 *  about what to do next rather than what went wrong internally. */
export interface WatchReply {
  ok: boolean;
  reason?: string;
}

/** An empty shift, for a watch that has heard nothing yet. Keeps every
 *  renderer from having to special-case null. */
export function emptySnapshot(): WatchSnapshot {
  return {
    v: WATCH_PROTOCOL,
    state: "off",
    since: null,
    workedMs: 0,
    breakMs: 0,
    asOf: 0,
    onSite: null,
    site: "",
    company: "",
    can: { checkOut: false, break: false, travel: false },
    travel: null,
    notices: [],
  };
}

/** The key the snapshot is stored under on both platforms' data channels. */
export const WATCH_STATE_PATH = "/workfence/shift";
/** The key a command arrives on. */
export const WATCH_COMMAND_PATH = "/workfence/command";
