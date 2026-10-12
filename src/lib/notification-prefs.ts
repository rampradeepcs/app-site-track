"use client";

/**
 * What each person wants to hear about, and where.
 *
 * Two places a notification can go: the bell inside the app, and this
 * person's devices — the phone's tray, the browser's notifications, and push
 * when the app or the site is closed. Each category of event is switched on
 * or off for each of those separately, because they are different requests:
 * a manager may want every check-in in the feed and none of them buzzing a
 * phone at seven in the morning.
 *
 * Stored on the person, not the device — profiles.notification_prefs — so a
 * choice made on the phone holds on the laptop, and so the push server,
 * which has no app in front of it, reads the same answer. This device keeps
 * a copy so the feed can filter before the network has answered, and so a
 * build with no backend still has somewhere to keep it.
 *
 * The category of each kind is written here and again in the database
 * (private.notification_category); the two must agree, and the list of
 * kinds they cover is NotificationKind in types.ts.
 */

import { useSyncExternalStore } from "react";
import type { AppNotification, NotificationKind } from "./types";
import { isLiveBackend, supabase } from "./supabase/client";
import { demoActive } from "./demo/mode";

export type NotificationCategory =
  | "attendance"
  | "tracking"
  | "work"
  | "team"
  | "reminders"
  | "system";

export type NotificationChannel = "inApp" | "device";

export interface NotificationPrefs {
  categories: Record<NotificationCategory, Record<NotificationChannel, boolean>>;
}

/** In the order Settings lists them, with the words it uses. */
export const CATEGORIES: readonly {
  id: NotificationCategory;
  label: string;
  hint: string;
}[] = [
  { id: "attendance", label: "Attendance", hint: "Check-ins, checkouts, late arrivals, missed checkouts" },
  { id: "tracking", label: "Location and tracking", hint: "Leaving the site, tracking stopping, weak GPS" },
  { id: "work", label: "Work updates", hint: "Progress notes and photos from site" },
  { id: "team", label: "Team and company", hint: "Invitations, people joining or leaving, projects assigned" },
  { id: "reminders", label: "Reminders", hint: "Shift and note reminders" },
  { id: "system", label: "App and sync", hint: "Uploads finishing after being offline" },
];

const KIND_CATEGORY: Record<NotificationKind, NotificationCategory> = {
  "check-in": "attendance",
  "check-out": "attendance",
  "late-check-in": "attendance",
  "missing-checkout": "attendance",
  "geofence-exit": "tracking",
  "tracking-interrupted": "tracking",
  "low-accuracy": "tracking",
  "tracking-started": "tracking",
  "work-update": "work",
  reminder: "reminders",
  sync: "system",
  "member-invited": "team",
  "member-joined": "team",
  "member-removed": "team",
  "member-restored": "team",
  "invitation-declined": "team",
  "company-renamed": "team",
  "company-updated": "team",
  "project-assigned": "team",
};

/** A kind this build does not know yet is still shown — as app news. */
export function categoryOf(kind: string): NotificationCategory {
  return KIND_CATEGORY[kind as NotificationKind] ?? "system";
}

/** Everything in the feed; everything but sync chatter on devices. */
export function defaultPrefs(): NotificationPrefs {
  const on = { inApp: true, device: true };
  return {
    categories: {
      attendance: { ...on },
      tracking: { ...on },
      work: { ...on },
      team: { ...on },
      reminders: { ...on },
      system: { inApp: true, device: false },
    },
  };
}

/** Whatever was stored, made whole: unknown keys dropped, gaps defaulted. */
export function normalizePrefs(raw: unknown): NotificationPrefs {
  const out = defaultPrefs();
  const cats = (raw as { categories?: Record<string, Record<string, unknown>> } | null)
    ?.categories;
  if (!cats || typeof cats !== "object") return out;
  for (const { id } of CATEGORIES) {
    const c = cats[id];
    if (!c || typeof c !== "object") continue;
    if (typeof c.inApp === "boolean") out.categories[id].inApp = c.inApp;
    if (typeof c.device === "boolean") out.categories[id].device = c.device;
  }
  return out;
}

export function wants(
  prefs: NotificationPrefs,
  n: Pick<AppNotification, "kind">,
  channel: NotificationChannel,
): boolean {
  return prefs.categories[categoryOf(n.kind)][channel];
}

/* ------------------------------------------------------------- the store */

/*
 * One copy for the whole app, so the bell, the tray and Settings agree
 * without each asking the server. Keyed by whose they are: a shared tablet
 * that two supervisors sign in on must not hand one the other's choices.
 */
let owner: string | null = null;
let current: NotificationPrefs = defaultPrefs();
const listeners = new Set<() => void>();

function key(who: string): string {
  return `workfence.notification-prefs.${who}`;
}

function emit(): void {
  for (const l of listeners) l();
}

function readCache(who: string): NotificationPrefs {
  try {
    const raw = localStorage.getItem(key(who));
    return raw ? normalizePrefs(JSON.parse(raw)) : defaultPrefs();
  } catch {
    return defaultPrefs();
  }
}

function writeCache(who: string, prefs: NotificationPrefs): void {
  try {
    localStorage.setItem(key(who), JSON.stringify(prefs));
  } catch {
    /* storage unavailable: the in-memory copy holds for this session */
  }
}

const live = () => isLiveBackend && !demoActive();

/*
 * Every local edit bumps this. A read of the server's copy that was asked for
 * before an edit is older than what is on screen, and is dropped rather than
 * allowed to put the switch back.
 */
let generation = 0;
/** When the server's copy was last read successfully — the refresh throttle. */
let lastRead = 0;
let reading: { who: string; generation: number; p: Promise<void> } | null = null;
/**
 * The copy last known to be on the server, from a read or a save. A failed
 * save puts its switch back to this, not merely to the opposite of what was
 * tried: two failed changes to one switch would otherwise leave it wrong.
 */
let confirmed: NotificationPrefs | null = null;

/*
 * One read at a time, and a read only answers for the person and the edits
 * it was asked about: a read for somebody else, or from before an edit, is
 * followed by a new one rather than joined.
 */
function readServer(who: string): Promise<void> {
  if (reading && reading.who === who && reading.generation === generation) return reading.p;
  const before = reading?.p ?? Promise.resolve();
  const entry = { who, generation, p: before.then(() => readNow(who)) };
  reading = entry;
  void entry.p.finally(() => {
    if (reading === entry) reading = null;
  });
  return entry.p;
}

async function readNow(who: string): Promise<void> {
  const asked = generation;
  try {
    const sb = supabase();
    if (!sb) return;
    const { data, error } = await sb.rpc("my_notification_prefs");
    if (error || owner !== who) return;
    // Counted only when it worked: a read that failed offline must not
    // hold off the retry when the connection comes back.
    lastRead = Date.now();
    confirmed = normalizePrefs(data);
    if (generation !== asked) return;
    current = confirmed;
    writeCache(who, current);
    emit();
  } catch {
    /* the device copy stands until the next read */
  }
}

/**
 * Point the store at whoever is signed in. Called by the provider below on
 * every session change; reads the device copy at once and then, with a
 * backend, the person's own copy from the server.
 */
export function loadPrefsFor(who: string | null): void {
  if (who === owner) return;
  owner = who;
  confirmed = null;
  lastRead = 0;
  current = who ? readCache(who) : defaultPrefs();
  emit();
  if (who && live()) void readServer(who);
}

/**
 * Read the server's copy again — when the app comes back into view, or back
 * online. A choice made on the phone has to reach the laptop that has been
 * open all week, not only the next one to sign in.
 */
export function refreshPrefs(): void {
  if (!owner || !live() || Date.now() - lastRead < 15_000) return;
  void readServer(owner);
}

function withSwitch(
  prefs: NotificationPrefs,
  category: NotificationCategory,
  channel: NotificationChannel,
  value: boolean,
): NotificationPrefs {
  return {
    categories: {
      ...prefs.categories,
      [category]: { ...prefs.categories[category], [channel]: value },
    },
  };
}

/* Saves go one at a time, in the order they were made. */
let saving: Promise<unknown> = Promise.resolve();
let unsaved = 0;

/**
 * Change one switch. Applied here at once, then saved — that switch alone,
 * so a device that has not heard the latest from the server cannot write its
 * stale copy of the others back. A save that fails puts the switch back (if
 * nothing has changed it since) and says so to the caller.
 */
export async function setPref(
  category: NotificationCategory,
  channel: NotificationChannel,
  value: boolean,
): Promise<void> {
  const who = owner;
  if (!who) return;
  generation++;
  current = withSwitch(current, category, channel, value);
  writeCache(who, current);
  emit();
  if (!live()) return;
  const sb = supabase();
  if (!sb) return;

  unsaved++;
  const run = saving.then(() =>
    sb.rpc("set_my_notification_pref", {
      p_category: category,
      p_channel: channel,
      p_value: value,
    }),
  );
  saving = run.catch(() => undefined);
  try {
    const { data, error } = await run;
    if (error) throw error;
    if (owner !== who) return;
    confirmed = normalizePrefs(data);
    // With nothing else on its way, take the stored copy: it carries any
    // change made meanwhile on another device.
    if (unsaved === 1) {
      current = confirmed;
      writeCache(who, current);
      emit();
    }
  } catch (e) {
    if (owner === who) {
      if (current.categories[category][channel] === value) {
        const saved = confirmed?.categories[category][channel] ?? !value;
        current = withSwitch(current, category, channel, saved);
        writeCache(who, current);
        emit();
      }
      // The last save to fail asks the server what it actually holds.
      if (unsaved === 1) {
        lastRead = 0;
        void readServer(who);
      }
    }
    throw e;
  } finally {
    unsaved--;
  }
}

export function currentPrefs(): NotificationPrefs {
  return current;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const serverSnapshot = defaultPrefs();

/** The signed-in person's preferences, re-rendering when they change. */
export function useNotificationPrefs(): NotificationPrefs {
  return useSyncExternalStore(subscribe, currentPrefs, () => serverSnapshot);
}
