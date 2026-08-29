"use client";

/**
 * Announces note reminders when they fall due.
 *
 * A minute is the right cadence: a reminder set for 2 PM that arrives at
 * 2:00:40 is on time, and checking every second would burn a site phone's
 * battery to gain nothing a person could notice.
 *
 * It runs wherever the app is open rather than on a server, which is an
 * honest limit worth stating: this is a foreground reminder, so it fires
 * when someone next has Workfence open, not while the phone is in a pocket.
 * A push notification would need a backend scheduler, and pretending
 * otherwise would be worse than the limit.
 */

import { useEffect } from "react";
import { useWorkforce } from "@/lib/store";

const EVERY_MS = 60_000;

export function NoteReminders() {
  const { hydrated, fireDueReminders } = useWorkforce();

  useEffect(() => {
    if (!hydrated) return;
    // Once on mount, so a reminder that came due while the app was closed
    // is announced on the next open rather than at the next minute mark.
    fireDueReminders();
    const t = window.setInterval(() => fireDueReminders(), EVERY_MS);
    return () => window.clearInterval(t);
  }, [hydrated, fireDueReminders]);

  return null;
}
