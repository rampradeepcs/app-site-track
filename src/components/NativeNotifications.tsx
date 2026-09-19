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
import { isForMe, postNative, onNotificationTap } from "@/lib/notify";

export function NativeNotifications() {
  const { state, hydrated, currentUser } = useWorkforce();
  const router = useRouter();

  const session = state?.session;
  const role = session?.role;
  const userId = session?.userId;

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

    void postNative(fresh, Date.now());
  }, [hydrated, state, role, userId]);

  // Tapping one opens what it is about. Registered once; the listener
  // outlives any screen, which is the point — the tap usually arrives when
  // the app was not running at all.
  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void onNotificationTap((link) => router.push(link)).then((unsub) => {
      if (cancelled) unsub();
      else off = unsub;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [router]);

  return null;
}
