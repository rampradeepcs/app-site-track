"use client";

/**
 * Keeps the paired watch in step with the shift, and does what it asks.
 *
 * Mounted once at the root, because a watch is not part of any screen: a
 * worker raises their wrist while the phone is in a pocket showing whatever
 * they left open, or nothing at all.
 *
 * It publishes on change rather than on a timer. The snapshot carries the
 * instant the current state began and the watch counts up from it, so a
 * shift that is merely running needs no traffic at all — which is the
 * difference between a watch that lasts a shift and one that does not.
 *
 * Nothing is drawn here. The wrist is the surface.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useWorkforce } from "@/lib/store";
import { onWatchCommand, publishToWatch, watchAvailable } from "@/lib/watch/bridge";
import {
  buildWatchSnapshot,
  snapshotSignature,
  type SnapshotInput,
} from "@/lib/watch/snapshot";
import type { WatchCommand, WatchReply } from "@/lib/watch/contract";

export function WatchLink() {
  const wf = useWorkforce();
  const { state, currentUser, openShift, fence } = wf;

  /* The command handler runs long after the render that made it, so it reads
     the store through a ref: a break started from the wrist must act on the
     shift as it is now, not as it was when the listener was registered. */
  const wfRef = useRef(wf);
  useEffect(() => {
    wfRef.current = wf;
  });

  const shiftDef = useMemo(
    () => state.shifts?.find((s) => s.id === openShift?.shiftId) ?? state.shifts?.[0] ?? null,
    [state.shifts, openShift?.shiftId],
  );

  const activeTravel = useMemo(
    () =>
      state.travelSessions?.find(
        (t) => t.employeeId === currentUser?.id && t.status === "active",
      ) ?? null,
    [state.travelSessions, currentUser?.id],
  );

  const project = useMemo(
    () =>
      state.projects.find(
        (p) => p.id === (openShift?.projectId ?? currentUser?.projectIds?.[0]),
      ),
    [state.projects, openShift?.projectId, currentUser?.projectIds],
  );

  const input: SnapshotInput = useMemo(
    () => ({
      openShift: openShift ?? null,
      shiftDef,
      project,
      activeTravel,
      notes: state.projectNotes ?? [],
      inside: fence ? !!fence.inside : null,
    }),
    [openShift, shiftDef, project, activeTravel, state.projectNotes, fence],
  );

  /* Read at send time by both the publisher and the command handler, neither
     of which should re-register when the shift ticks along. */
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });

  /* Publish only when the watch would draw something different. */
  const signature = snapshotSignature(input);
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    if (lastSent.current === signature) return;
    lastSent.current = signature;
    void publishToWatch(buildWatchSnapshot(inputRef.current, Date.now()));
  }, [signature]);

  /** Do what the wrist asked, in the phone's own words when it refuses. */
  const run = useCallback(async (command: WatchCommand): Promise<WatchReply> => {
    const live = wfRef.current;
    switch (command) {
      case "break.start":
        return live.startBreak();
      case "break.end":
        return live.endBreak();
      case "checkout":
        /*
         * No selfie from a wrist. The phone accepts a null one — the record
         * simply carries no photograph for the close, which is already how
         * an auto-closed day looks — rather than making somebody dig a phone
         * out of a jacket at the end of a shift.
         */
        return live.checkOut(null);
      case "travel.end":
        return live.endTravel();
      case "travel.start":
        // Starting a trip asks for a purpose and a vehicle. That is a form,
        // and a form does not belong on a watch.
        return { ok: false, reason: "Start a trip on your phone." };
      case "refresh":
        void publishToWatch(buildWatchSnapshot(inputRef.current, Date.now()));
        return { ok: true };
      default:
        return { ok: false, reason: "Not supported." };
    }
  }, []);

  /* Registered once for the life of the app: the listener reads everything it
     needs through refs, so it never has to be torn down and rebuilt — and a
     command can never arrive in the gap where there was no listener. */
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      if (!(await watchAvailable())) return;
      const off = await onWatchCommand(run);
      if (cancelled) off();
      else stop = off;
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [run]);

  return null;
}
