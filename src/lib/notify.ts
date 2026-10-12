"use client";

/**
 * Attendance events on the phone's own notification tray.
 *
 * The app has always had a notification feed — check-ins, checkouts, geofence
 * exits, overtime decisions, being put on a site — and it lived entirely
 * behind the bell. A worker checks in at the gate and locks their phone; the
 * confirmation that it went through is now two taps away inside an app they
 * have closed. That is the wrong place for it. This posts the same events to
 * the tray, where a glance answers the question.
 *
 * Nothing new is raised here. Every event already exists in the feed, so this
 * is a mirror rather than a second source: one event, one place it is
 * written, two places it shows. Adding a notification anywhere in the store
 * gets a native one for free, and there is no list of kinds here to fall out
 * of date with the list in types.ts.
 *
 * ── what this can and cannot do ──────────────────────────────────────────
 *
 * A local notification is posted by the device that already knows. That maps
 * exactly onto events the phone in your hand caused: your check-in, your
 * checkout, your geofence exit, tracking stopping. Those fire the instant
 * they happen, closed app or not.
 *
 * Across devices it has help now. A worker checking in writes a
 * manager-audience row to Postgres from *their* phone; the database sends it
 * live to the manager's open app (components/LiveNotifications.tsx), which
 * posts it here like any other, and pushes it to their closed one
 * (lib/device-notifications.ts and the `push` edge function). What still
 * arrives only by a hydrate — the whole feed re-read at sign-in — is history,
 * and posting it as news would be a lie; FRESH_MS and the origins below are
 * how that is refused.
 */

import type { AppNotification, Role } from "./types";

/* ------------------------------------------------------- who it is for ----
 *
 * Four screens had written this rule four ways. The bell counted unread with
 * the userId clause; the two alert lists it fed left it out, so the badge
 * said one and the list showed four, and one of those four was addressed to
 * a different manager by name.
 *
 * Getting it wrong on a list is untidy. Getting it wrong here wakes the wrong
 * person's phone, so the rule is written once and everything asks it.
 */
export function isForMe(
  n: AppNotification,
  role: Role | undefined,
  userId: string | undefined,
): boolean {
  if (!role) return false;
  // Addressed to one person, or broadcast to everyone holding that role.
  if (n.userId && n.userId !== userId) return false;
  if (n.audience === role) return true;
  // Administrators read the managers' feed, which is what the admin home
  // screen has always shown. Nothing addresses `admin` from the client; the
  // database does, via each member's own role, so both have to work.
  return n.audience === "manager" && (role === "admin" || role === "superadmin");
}

/* ------------------------------------------------------------- posting ---- */

/**
 * How long after an event it is still news.
 *
 * Signing in, switching company, or any other full hydrate replaces the feed
 * wholesale with up to 300 rows from Postgres, most of which this device has
 * never seen and none of which just happened. Without this, opening the app
 * on Monday would post Friday's afternoon to the tray.
 *
 * Two minutes is generous for an event the device raised itself — those
 * arrive in milliseconds — and far too short for anything that travelled
 * through the database and back.
 */
const FRESH_MS = 2 * 60_000;

/**
 * The same question for a row that arrived live from somebody else's device.
 * It may have waited in that phone's outbox through a dead-signal patch, so
 * it gets the window the server pushes in rather than the one for this
 * device's own events.
 */
export const LIVE_FRESH_MS = 15 * 60_000;

/* --------------------------------------------- where each one came from ----
 *
 * Raised on this device, received live, or read back in a hydrate. Only the
 * first two are news: a hydrate brings in rows that may have been shown
 * already — by a push, which is very likely how the app came to be opened —
 * and announcing them again repeats what the person just tapped. Rows with
 * no recorded origin were raised here.
 */
export type NotificationOrigin = "local" | "live" | "server";

const origins = new Map<string, Exclude<NotificationOrigin, "local">>();

export function noteOrigin(ids: Iterable<string>, origin: "live" | "server"): void {
  for (const id of ids) if (!origins.has(id)) origins.set(id, origin);
  // Kept to roughly the size of a feed or two; the oldest go first.
  if (origins.size > 1000) {
    let excess = origins.size - 600;
    for (const id of origins.keys()) {
      if (excess-- <= 0) break;
      origins.delete(id);
    }
  }
}

export function originOf(id: string): NotificationOrigin {
  return origins.get(id) ?? "local";
}

/**
 * Whether a notification's link is a screen in this app. Exactly one leading
 * slash: "//elsewhere" and "/\\elsewhere" are other sites to a URL parser
 * and to the router, and a tapped notification must never be a redirect.
 * Parsers also drop tabs and newlines before they look, so "/<tab>/elsewhere"
 * is the same thing — no whitespace, control character or backslash at all.
 * The database holds new rows to the same rule.
 */
export function isAppLink(link: unknown): link is string {
  return typeof link === "string" && /^\/(?![/\\])[^\x00-\x20\x7f\\]*$/.test(link);
}

/**
 * A burst is a sign something is wrong, not something to relay faithfully.
 * Real use posts one at a time. If a dozen ever pass the freshness check at
 * once, the most recent few are the useful ones and the tray is better for
 * not holding the rest.
 */
const BURST_CAP = 3;

/** Android notification channels. Importance is fixed at creation. */
const CHANNELS = {
  /** Routine and expected: checked in, checked out, tracking started. */
  attendance: {
    id: "wf-attendance",
    name: "Attendance",
    description: "Check-ins, checkouts and tracking.",
    importance: 3 as const,
  },
  /** Wrong, or about to be: outside the site, no checkout, sync failing. */
  alerts: {
    id: "wf-alerts",
    name: "Site alerts",
    description: "Geofence exits, missed checkouts and anything needing a look.",
    importance: 4 as const,
  },
};

function channelFor(n: AppNotification): string {
  return n.severity === "warning" || n.severity === "critical"
    ? CHANNELS.alerts.id
    : CHANNELS.attendance.id;
}

function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
}

/**
 * The plugin wants a 32-bit integer id and the feed has strings. FNV-1a,
 * masked positive: the same row always lands on the same id, so a repost
 * replaces rather than duplicates, and two different rows practically never
 * collide at the handful-per-day this posts.
 */
function numericId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h & 0x7fffffff;
}

type Plugin = typeof import("@capacitor/local-notifications").LocalNotifications;

/**
 * Loaded on demand rather than imported at the top. The static export runs
 * this file through a build with no Capacitor runtime under it, and the web
 * build should not carry a plugin it can never call.
 *
 * The box around it is not tidiness, it is load-bearing. registerPlugin hands
 * back a Proxy whose get trap answers *every* property with a callable, so
 * `LocalNotifications.then` is a function and the object is, as far as the
 * language is concerned, a thenable. Resolve a promise with it and the
 * runtime dutifully calls `.then(resolve, reject)` on it — which dispatches a
 * plugin method named "then" that no platform implements, and nothing ever
 * calls resolve. The await never returns, no error is raised, and every
 * notification quietly goes nowhere.
 *
 * Wrapping it in a plain object means a promise never resolves *to* the proxy,
 * so it is never mistaken for one. Anything else that reaches for this plugin
 * has to keep the box on.
 */
let plugin: Promise<{ api: Plugin } | null> | null = null;
function load(): Promise<{ api: Plugin } | null> {
  if (!isNative()) return Promise.resolve(null);
  plugin ??= import("@capacitor/local-notifications")
    .then((m) => ({ api: m.LocalNotifications }))
    .catch(() => null);
  return plugin;
}

/**
 * Checked every time; asked only in answer to the person's own action.
 *
 * A prompt that appears because a colleague checked in somewhere else is a
 * prompt that gets declined — and iOS remembers a decline for good. So the
 * system dialog comes up only from the Settings switch, or when the person's
 * own action (their check-in) raises the first notification of a session,
 * and at most once a session: Android 13 refuses quietly after the first
 * time anyway. A "no" is not remembered as the answer: granting it later in
 * the phone's settings does not restart the app, and a remembered no would
 * keep the tray empty — and the Settings switch stuck — until something did.
 * A "yes" is kept, because it cannot be withdrawn without a restart.
 */
let granted = false;
let autoAsked = false;
let inFlight: { p: Promise<boolean>; asking: boolean } | null = null;

async function permission(mayAsk: boolean): Promise<boolean> {
  if (granted) return true;
  const box = await load();
  if (!box) return false;
  try {
    const have = await box.api.checkPermissions();
    if (have.display === "granted") return (granted = true);
    if (have.display === "denied" || !mayAsk) return false;
    const asked = await box.api.requestPermissions();
    return (granted = asked.display === "granted");
  } catch {
    return false;
  }
}

/**
 * For posting. Only checks, unless `mayAsk` — the post comes from this
 * person's own action — and nothing has asked yet this session.
 */
export function notificationsPermitted(mayAsk = false): Promise<boolean> {
  if (granted) return Promise.resolve(true);
  const ask = mayAsk && !autoAsked;
  // Join a check already running — unless this one may ask and that one
  // may not, in which case ask after it rather than lose the session's one
  // chance to a check that never asked.
  if (inFlight && (inFlight.asking || !ask)) return inFlight.p;
  if (ask) autoAsked = true;
  const before = inFlight?.p ?? Promise.resolve(false);
  const entry = {
    asking: ask,
    p: before.then((ok) => ok || permission(ask)),
  };
  inFlight = entry;
  void entry.p.finally(() => {
    if (inFlight === entry) inFlight = null;
  });
  return entry.p;
}

/** For the Settings switch: somebody just asked, so asking is right. */
export function askNotificationPermission(): Promise<boolean> {
  autoAsked = true;
  return permission(true);
}

/**
 * Make the tray's channels now, before anything is pushed to them. A push
 * from Firebase names its channel, and one that does not exist yet lands in
 * Android's catch-all at default importance — no heads-up for an alert.
 */
export async function prepareChannels(): Promise<void> {
  const box = await load();
  if (box) await ensureChannels(box.api);
}

let channelsReady = false;
async function ensureChannels(api: Plugin): Promise<void> {
  if (channelsReady) return;
  channelsReady = true;
  // iOS has no channels and the call is not implemented there; a rejection
  // is the expected answer, not a failure worth reporting.
  for (const c of Object.values(CHANNELS)) {
    try {
      await api.createChannel({ ...c, visibility: 1 });
    } catch {
      /* iOS, or an Android old enough not to have channels */
    }
  }
}

/**
 * Which of these deserve the tray, newest first.
 *
 * Split out from the posting because it is the only part with a judgement in
 * it, and the only part that can be checked without a phone.
 */
export function selectPostable(
  items: readonly AppNotification[],
  now: number,
  freshMs: number = FRESH_MS,
): AppNotification[] {
  return items
    .filter((n) => now - n.at < freshMs)
    .sort((a, b) => b.at - a.at)
    .slice(0, BURST_CAP);
}

/**
 * Post these to the tray. Anything not addressed to the signed-in person, or
 * older than FRESH_MS, is dropped — see the note on each constant.
 *
 * Returns how many were posted, which is what the tests assert on. Never
 * throws: a tray that will not accept a notification must not take the
 * check-in down with it.
 */
export async function postNative(
  items: readonly AppNotification[],
  now: number,
  freshMs: number = FRESH_MS,
  mayAsk = false,
): Promise<number> {
  const fresh = selectPostable(items, now, freshMs);
  if (fresh.length === 0) return 0;

  const box = await load();
  if (!box) return 0;
  if (!(await notificationsPermitted(mayAsk))) return 0;
  await ensureChannels(box.api);

  try {
    await box.api.schedule({
      notifications: fresh.map((n) => ({
        id: numericId(n.id),
        title: n.title,
        body: n.body,
        channelId: channelFor(n),
        // Where tapping it goes. Read back in the tap listener; the plugin
        // hands `extra` straight through untouched.
        extra: { link: n.link ?? null },
        // Absent on iOS, where a notification stays until it is swiped.
        autoCancel: true,
        // No `schedule` key at all: this fires now. Giving it a time is what
        // pulls SCHEDULE_EXACT_ALARM into the manifest, which the manifest
        // deliberately removes.
      })),
    });
    return fresh.length;
  } catch {
    return 0;
  }
}

/**
 * Tapping a notification opens what it is about.
 *
 * The app was already running or it was not; either way the tap arrives here
 * with the link the notification carried. Returns an unsubscribe.
 */
export async function onNotificationTap(
  go: (link: string) => void,
): Promise<() => void> {
  const box = await load();
  if (!box) return () => {};
  try {
    const handle = await box.api.addListener(
      "localNotificationActionPerformed",
      (event) => {
        const link = (event.notification.extra as { link?: string | null } | undefined)
          ?.link;
        if (isAppLink(link)) go(link);
      },
    );
    return () => void handle.remove();
  } catch {
    return () => {};
  }
}

/** Exported for the tests; nothing else should need them. */
export const _internals = { numericId, channelFor, FRESH_MS, BURST_CAP, CHANNELS };
