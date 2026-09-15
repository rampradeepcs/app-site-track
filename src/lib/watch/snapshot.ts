/**
 * The shift, as a watch needs to see it.
 *
 * A pure function of the store and a clock, kept out of the component for
 * two reasons: React is right that a value derived from `Date.now()` does
 * not belong in a memo, and the command handler needs to build one at a
 * moment of its own choosing without re-registering anything.
 *
 * Everything here is derived the way the phone's own screen derives it, by
 * the same function payroll will use at the end of the month, so the wrist
 * and the payslip cannot disagree.
 */

import { dayMetrics } from "@/lib/payroll";
import type {
  Attendance,
  Project,
  ProjectNote,
  ShiftDef,
  TravelSession,
} from "@/lib/types";
import {
  WATCH_PROTOCOL,
  type WatchNotice,
  type WatchSnapshot,
} from "./contract";

/** A watch list nobody scrolls. Three is what fits before the crown moves. */
const MAX_NOTICES = 3;

export interface SnapshotInput {
  openShift: Attendance | null;
  shiftDef: ShiftDef | null;
  project: Project | undefined;
  activeTravel: TravelSession | null;
  notes: ProjectNote[];
  /** null while no fix has been taken — which is not the same as outside. */
  inside: boolean | null;
}

export function noticesFrom(notes: ProjectNote[], project?: Project): WatchNotice[] {
  return notes
    .filter((n) => n.pinned && n.status === "open" && (!project || n.projectId === project.id))
    .slice(0, MAX_NOTICES)
    .map((n) => ({
      id: n.id,
      title: n.title,
      severity:
        n.priority === "critical"
          ? "critical"
          : n.priority === "important"
            ? "important"
            : "normal",
    }));
}

export function buildWatchSnapshot(input: SnapshotInput, now: number): WatchSnapshot {
  const { openShift, shiftDef, project, activeTravel, notes, inside } = input;
  const openBreak = openShift?.breaks?.find((b) => !b.end) ?? null;
  const metrics = openShift && shiftDef ? dayMetrics(openShift, shiftDef, now) : null;
  const onBreak = !!openBreak;
  const open = !!openShift?.checkIn && !openShift?.checkOut;

  return {
    v: WATCH_PROTOCOL,
    state: !openShift?.checkIn ? "off" : onBreak ? "break" : "on",
    since: onBreak ? (openBreak?.start ?? null) : (openShift?.checkIn?.at ?? null),
    workedMs: Math.max(0, Math.round((metrics?.netMinutes ?? 0) * 60000)),
    breakMs: Math.max(0, Math.round((metrics?.breaks.totalMinutes ?? 0) * 60000)),
    asOf: now,
    onSite: inside,
    site: project?.name ?? "",
    company: project?.client ?? "",
    can: {
      // What the phone would accept if asked right now. The watch greys the
      // rest rather than guessing the rules, so a company that turns breaks
      // off does not need a watch release.
      checkOut: open,
      break: open,
      travel: !!activeTravel,
    },
    travel: activeTravel ? { active: true, label: activeTravel.purpose || "Trip" } : null,
    notices: noticesFrom(notes, project),
  };
}

/**
 * What a watch would draw differently.
 *
 * The clock is deliberately absent: the watch counts elapsed time itself
 * from `since`, so a shift that is merely running produces no traffic at
 * all — the difference between a watch that lasts the shift and one that
 * does not.
 */
export function snapshotSignature(input: SnapshotInput): string {
  const { openShift, project, activeTravel, notes, inside } = input;
  const openBreak = openShift?.breaks?.find((b) => !b.end) ?? null;
  return [
    !openShift?.checkIn ? "off" : openBreak ? "break" : "on",
    openBreak ? openBreak.start : (openShift?.checkIn?.at ?? ""),
    inside === null ? "unknown" : String(inside),
    project?.name ?? "",
    !!openShift?.checkIn && !openShift?.checkOut,
    activeTravel?.id ?? "",
    noticesFrom(notes, project)
      .map((n) => n.id + n.severity)
      .join(","),
  ].join("|");
}
