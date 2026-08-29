/**
 * Project notes — the reading half.
 *
 * A note is the thing a site already keeps on a whiteboard by the gate:
 * the pour is at seven, don't paint Level 3 yet, the client walks the job
 * on Friday. The value is entirely in the right people seeing it at the
 * right moment, so ordering and visibility are the whole design.
 *
 * Every list a screen renders goes through {@link readableNotes}. Filtering
 * for permission in one place is what stops a commercial note reaching a
 * crew because one screen forgot to ask.
 */

import { canSeeNote } from "./access";
import type { NotePriority, ProjectNote, WorkforceState } from "./types";

/** Highest first. Critical notes outrank everything, including recency. */
const PRIORITY_RANK: Record<NotePriority, number> = {
  critical: 3,
  important: 2,
  normal: 1,
  low: 0,
};

export function priorityRank(p: NotePriority): number {
  return PRIORITY_RANK[p] ?? 1;
}

export interface NoteQuery {
  projectId?: string;
  /** Free text across title, body, category and author name. */
  search?: string;
  category?: string | null;
  priority?: NotePriority | null;
  authorId?: string | null;
  status?: ProjectNote["status"] | null;
  /** Include notes already marked done or archived. Off by default. */
  includeClosed?: boolean;
}

/**
 * Notes this person may read, ordered the way they should be acted on:
 * pinned first, then by priority, then newest.
 */
export function readableNotes(
  s: WorkforceState,
  userId: string | null | undefined,
  q: NoteQuery = {},
): ProjectNote[] {
  const search = q.search?.trim().toLowerCase();

  return s.projectNotes
    .filter((n) => {
      if (q.projectId && n.projectId !== q.projectId) return false;
      if (!q.includeClosed && !q.status && n.status === "archived") return false;
      if (q.status && n.status !== q.status) return false;
      if (q.category && n.category !== q.category) return false;
      if (q.priority && n.priority !== q.priority) return false;
      if (q.authorId && n.authorId !== q.authorId) return false;
      if (search) {
        const author = s.users.find((u) => u.id === n.authorId)?.name ?? "";
        const hay = `${n.title} ${n.body} ${n.category} ${author}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      // Permission last: it is the most expensive check and the least
      // likely to be the reason a row was excluded.
      return canSeeNote(s, n, userId);
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        priorityRank(b.priority) - priorityRank(a.priority) ||
        b.createdAt - a.createdAt,
    );
}

/**
 * The short list a project screen shows as hints.
 *
 * Pinned and critical only, capped. A hint strip that shows everything is a
 * list, and a list at the top of a dashboard is scrolled past.
 */
export function projectHints(
  s: WorkforceState,
  userId: string | null | undefined,
  projectId: string,
  limit = 3,
): ProjectNote[] {
  return readableNotes(s, userId, { projectId })
    .filter((n) => n.status === "open" && (n.pinned || n.priority === "critical"))
    .slice(0, limit);
}

/** Categories in use on a project, so custom ones appear in filters. */
export function usedCategories(s: WorkforceState, projectId?: string): string[] {
  const set = new Set<string>();
  for (const n of s.projectNotes) {
    if (!projectId || n.projectId === projectId) set.add(n.category);
  }
  return [...set].sort();
}

export function noteAttachments(s: WorkforceState, noteId: string) {
  return s.noteAttachments
    .filter((a) => a.noteId === noteId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Counts for a project dashboard: how much is waiting to be dealt with. */
export function noteSummary(
  s: WorkforceState,
  userId: string | null | undefined,
  projectId: string,
): { open: number; important: number; critical: number; pinned: number } {
  const open = readableNotes(s, userId, { projectId }).filter(
    (n) => n.status === "open",
  );
  return {
    open: open.length,
    important: open.filter((n) => n.priority === "important").length,
    critical: open.filter((n) => n.priority === "critical").length,
    pinned: open.filter((n) => n.pinned).length,
  };
}

/**
 * Reminders that have come due and not yet been announced.
 *
 * Returned rather than fired here: this module reads, and something with a
 * clock decides what to do about it.
 */
export function dueReminders(
  s: WorkforceState,
  now = Date.now(),
): ProjectNote[] {
  return s.projectNotes.filter(
    (n) =>
      n.status === "open" &&
      !n.reminderSent &&
      typeof n.remindAt === "number" &&
      n.remindAt <= now,
  );
}

/** Group notes by day for the timeline, newest day first. */
export function noteTimeline(
  notes: ProjectNote[],
): Array<{ date: string; notes: ProjectNote[] }> {
  const by = new Map<string, ProjectNote[]>();
  for (const n of [...notes].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = new Date(n.createdAt).toISOString().slice(0, 10);
    const list = by.get(key);
    if (list) list.push(n);
    else by.set(key, [n]);
  }
  return [...by.entries()].map(([date, list]) => ({ date, notes: list }));
}
