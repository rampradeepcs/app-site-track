"use client";

/**
 * Mirrors the notification feed to the phone's tray.
 *
 * Mounted once, beside the other quiet workers in the root layout, because
 * the feed does not belong to a screen: a check-in raised on the employee
 * home screen has to reach the tray whether or not that screen is still
 * mounted a second later.
 *
 * The whole job is deciding what counts as *new*, and the trap is that
 * "new to this list" and "new to this device" are different questions.
 * Signing in replaces the list with 300 rows from Postgres, every one of
 * which is new to the list and none of which just happened. So the first
 * pass after a sign-in is treated as history — read, not announced — and
 * lib/notify refuses anything older than a couple of minutes on top of that.
 * Belt and braces, because the failure is loud: a pocket buzzing forty times
 * in a row is how an app gets its notifications turned off for good.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useWorkforce } from "@/lib/store";
import type { AppNotification } from "@/lib/types";
import {
  LIVE_FRESH_MS,
  isForMe,
  onNotificationTap,
  originOf,
  postNative,
  selectPostable,
} from "@/lib/notify";
import { currentPrefs, loadPrefsFor, refreshPrefs, wants } from "@/lib/notification-prefs";
import {
  deviceMayShow,
  isNativeApp,
  onPushReceived,
  onPushTap,
  pushWillShow,
  refreshDeviceRegistration,
  retryDeviceRegistration,
  showInBrowser,
} from "@/lib/device-notifications";

/*
 * The browser as well as the tray, now: the same pass posts to whichever
 * this device is — the phone's tray in the app, a browser notification on
 * the web — and only what the person asked to hear on their devices.
 */
/** Kinds raised in answer to the person's own tap on check-in or checkout. */
const TAP_KINDS: ReadonlySet<AppNotification["kind"]> = new Set([
  "check-in",
  "check-out",
  "late-check-in",
  "tracking-started",
]);

export function NativeNotifications() {
  const { state, hydrated, currentUser } = useWorkforce();
  const router = useRouter();

  const session = state?.session;
  const role = session?.role;
  const userId = session?.userId;

  // Whose preferences apply, and this device registered to them for push.
  useEffect(() => {
    loadPrefsFor(userId ?? null);
    if (userId) void refreshDeviceRegistration();
  }, [userId]);

  // Ids already accounted for. Null means "nothing read yet", which is what
  // makes the next pass a silent one.
  const seen = useRef<Set<string> | null>(null);

  // A different person, or the same person in a different company, gets a
  // different feed. Forget what was read so their first pass is silent too —
  // otherwise switching company announces the new company's recent history.
  useEffect(() => {
    seen.current = null;
  }, [userId, currentUser?.orgId]);

  useEffect(() => {
    if (!hydrated || !state || !role) return;
    const mine = state.notifications.filter((n) => isForMe(n, role, userId));

    if (seen.current === null) {
      seen.current = new Set(mine.map((n) => n.id));
      return;
    }
    const fresh = mine.filter((n) => !seen.current!.has(n.id));
    // Rebuilt rather than added to: the feed only grows at the head and drops
    // at the tail, so an id that has fallen off cannot come back, and the set
    // stays the size of the feed instead of the size of the session.
    seen.current = new Set(mine.map((n) => n.id));
    if (fresh.length === 0) return;

    // Only the kinds this person wants on their devices, only while this
    // device's own switch is on, and only news: raised here, or arrived live
    // from somewhere else. What a hydrate read back is history — and when the
    // app was opened by tapping a push, it is the very thing just tapped.
    const prefs = currentPrefs();
    const wanted = fresh.filter((n) => wants(prefs, n, "device"));
    if (wanted.length === 0 || !deviceMayShow()) return;
    const raisedHere = wanted.filter((n) => originOf(n.id) === "local");
    const arrived = wanted.filter((n) => originOf(n.id) === "live");
    const now = Date.now();
    if (isNativeApp()) {
      // This phone's own events always: the server never pushes them back to
      // it. Everyone else's only while no push is going to show them — a
      // phone cannot merge the two copies the way a browser does by tag.
      // Only the person's own tap — checking in or out — may bring up the
      // system's permission prompt. Reminders and GPS alerts are raised here
      // too, but by a timer or a sensor, and somebody else's never are.
      const byTap = raisedHere.filter((n) => TAP_KINDS.has(n.kind));
      const other = raisedHere.filter((n) => !TAP_KINDS.has(n.kind));
      void postNative(byTap, now, undefined, true);
      void postNative(other, now);
      if (!pushWillShow()) void postNative(arrived, now, LIVE_FRESH_MS);
    } else {
      void showInBrowser([
        ...selectPostable(raisedHere, now),
        ...selectPostable(arrived, now, LIVE_FRESH_MS),
      ]);
    }
  }, [hydrated, state, role, userId]);

  // A push that lands with the app open is not shown by the phone. If the
  // app already has it, live, it was posted above; if not — another of this
  // person's companies, or the live connection was down — post it here.
  const known = useRef<Set<string>>(new Set());
  useEffect(() => {
    known.current = new Set(state?.notifications.map((n) => n.id) ?? []);
  }, [state?.notifications]);
  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    void onPushReceived((n) => {
      // Already here and already announced, or deliberately not: skip. One
      // that only a hydrate brought in was never announced, and its push
      // landing now says it is news.
      if ((known.current.has(n.id) && originOf(n.id) !== "server") || !deviceMayShow()) return;
      known.current.add(n.id);
      void postNative([n], Date.now(), LIVE_FRESH_MS);
    }).then((unsub) => {
      if (cancelled) unsub();
      else off = unsub;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  // Choices made on another device reach this one when it comes back into
  // view or back online, not only at the next sign-in.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== "visible") return;
      refreshPrefs();
      // A registration that failed at launch — no signal at the gate.
      retryDeviceRegistration();
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    window.addEventListener("online", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
      window.removeEventListener("online", again);
    };
  }, []);

  // Tapping one opens what it is about. Registered once; the listener
  // outlives any screen, which is the point — the tap usually arrives when
  // the app was not running at all.
  useEffect(() => {
    const offs: (() => void)[] = [];
    let cancelled = false;
    const keep = (unsub: () => void) => {
      if (cancelled) unsub();
      else offs.push(unsub);
    };
    void onNotificationTap((link) => router.push(link)).then(keep);
    // And one that arrived by push while the app was closed.
    void onPushTap((link) => router.push(link)).then(keep);
    return () => {
      cancelled = true;
      for (const off of offs) off();
    };
  }, [router]);

  return null;
}
