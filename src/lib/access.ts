/**
 * Who may do what.
 *
 * Workfence has four stored roles — superadmin, admin, manager, employee —
 * but a construction org talks about more seats than that, and the one that
 * matters most here has no role of its own: the site engineer. They are an
 * employee by account, yet they run a gang's attendance and write notes the
 * crew reads.
 *
 * Rather than add a fifth role and re-provision every existing user, a site
 * engineer is *derived*: you are one for a project if a team on that project
 * names you as its engineer, or if that is your designation and you are on
 * the project. The authority follows the assignment, which is also how it
 * ends — take them off the team and the capability goes with it.
 *
 * Everything here is a read over state, so a screen and a mutation cannot
 * disagree about who was allowed.
 */

import type { LabourTeam, ProjectNote, User, WorkforceState } from "./types";

const SITE_ENGINEER_TITLES = ["site engineer", "civil engineer"];

export function userById(s: WorkforceState, id?: string | null): User | null {
  if (!id) return null;
  return s.users.find((u) => u.id === id) ?? null;
}

export function currentUser(s: WorkforceState): User | null {
  return userById(s, s.session?.userId);
}

/** Admin and above: the seats that configure a tenant. */
export function isAdmin(u: User | null): boolean {
  return u?.role === "admin" || u?.role === "superadmin";
}

/** Anyone who manages other people's work. */
export function isManagement(u: User | null): boolean {
  return isAdmin(u) || u?.role === "manager";
}

export function isSiteEngineer(
  s: WorkforceState,
  userId?: string | null,
  projectId?: string,
): boolean {
  const u = userById(s, userId);
  if (!u) return false;
  const named = s.labourTeams.some(
    (t) =>
      t.siteEngineerId === u.id &&
      t.status !== "archived" &&
      (!projectId || t.projectId === projectId),
  );
  if (named) return true;
  const titled = SITE_ENGINEER_TITLES.includes(u.designation.trim().toLowerCase());
  return titled && (!projectId || u.projectIds.includes(projectId));
}

/* ------------------------------------------------------------ capabilities */

/** Create, edit, archive teams and move labour between them. */
export function canManageTeams(s: WorkforceState, userId?: string | null): boolean {
  return isManagement(userById(s, userId));
}

/**
 * Take a group attendance capture.
 *
 * Deliberately wider than canManageTeams: the whole point of the feature is
 * that the person standing in front of the gang records it, and that person
 * is the site engineer.
 */
export function canCaptureGroupAttendance(
  s: WorkforceState,
  userId: string | null | undefined,
  projectId: string,
): boolean {
  return (
    isManagement(userById(s, userId)) || isSiteEngineer(s, userId, projectId)
  );
}

/** Write a project note. Labour read notes; they do not write them. */
export function canCreateNote(
  s: WorkforceState,
  userId: string | null | undefined,
  projectId: string,
): boolean {
  return (
    isManagement(userById(s, userId)) || isSiteEngineer(s, userId, projectId)
  );
}

/** Pin a note to a project dashboard, or unpin one. */
export function canPinNote(s: WorkforceState, userId?: string | null): boolean {
  return isManagement(userById(s, userId));
}

/** Edit or delete a note: management, or the person who wrote it. */
export function canEditNote(
  s: WorkforceState,
  note: ProjectNote,
  userId?: string | null,
): boolean {
  return isManagement(userById(s, userId)) || note.authorId === userId;
}

/**
 * Whether a note may be read.
 *
 * Default-closed. An unknown visibility value — from an older record or a
 * future one — resolves to management only, because the failure that costs
 * something here is showing a payment dispute to a site crew, not hiding a
 * note from a director for an afternoon.
 */
export function canSeeNote(
  s: WorkforceState,
  note: ProjectNote,
  userId?: string | null,
): boolean {
  const u = userById(s, userId);
  if (!u) return false;
  if (note.authorId === u.id) return true;
  if (isAdmin(u)) return true;

  switch (note.visibility) {
    case "project-team":
      return u.projectIds.includes(note.projectId) || isManagement(u);
    case "managers-engineers":
      return isManagement(u) || isSiteEngineer(s, u.id, note.projectId);
    case "selected":
      return (note.visibleTo ?? []).includes(u.id);
    case "management":
      return isManagement(u);
    default:
      return isManagement(u);
  }
}

/** Teams this person is entitled to see on a project. */
export function visibleTeams(
  s: WorkforceState,
  userId: string | null | undefined,
  projectId?: string,
): LabourTeam[] {
  const u = userById(s, userId);
  const all = s.labourTeams.filter(
    (t) => (!projectId || t.projectId === projectId) && t.status !== "archived",
  );
  if (!u) return [];
  if (isManagement(u)) return all;
  // A labourer sees the gangs they are actually on; an engineer sees theirs.
  const mine = new Set(
    s.teamMembers
      .filter((m) => m.employeeId === u.id && !m.leftAt)
      .map((m) => m.teamId),
  );
  return all.filter((t) => mine.has(t.id) || t.siteEngineerId === u.id);
}
