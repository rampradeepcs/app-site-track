/**
 * Labour teams — the reading half.
 *
 * A construction site is organised by gang, not by headcount: the plumbing
 * team turned up, the mason team is on Level 3. These helpers answer the
 * questions that follow from that, and they are pure so the same answers
 * serve a screen, a report and a test.
 *
 * Membership is read through {@link activeMembers} everywhere, because a
 * team's roster is a set of dated spells rather than a list. Filtering on
 * `leftAt` in one place is what keeps a transferred worker out of today's
 * register while leaving them in March's.
 */

import { liveStatusFor, type LiveStatus } from "./metrics";
import { todayISO } from "./format";
import type {
  LabourTeam,
  LabourTeamMember,
  User,
  WorkforceState,
} from "./types";

/** Members currently on the team — a spell that has started and not ended. */
export function activeMembers(
  s: WorkforceState,
  teamId: string,
): LabourTeamMember[] {
  return s.teamMembers.filter(
    (m) => m.teamId === teamId && !m.leftAt && m.status !== "transferred",
  );
}

/** Every spell on this team, newest first — the history view. */
export function memberHistory(
  s: WorkforceState,
  teamId: string,
): LabourTeamMember[] {
  return s.teamMembers
    .filter((m) => m.teamId === teamId)
    .sort((a, b) => b.joinedAt - a.joinedAt);
}

/** The teams a worker is on right now, across projects. */
export function teamsOf(s: WorkforceState, employeeId: string): LabourTeam[] {
  const ids = new Set(
    s.teamMembers
      .filter((m) => m.employeeId === employeeId && !m.leftAt)
      .map((m) => m.teamId),
  );
  return s.labourTeams.filter((t) => ids.has(t.id));
}

/** Every spell this worker has served, newest first. */
export function assignmentHistory(
  s: WorkforceState,
  employeeId: string,
): Array<{ member: LabourTeamMember; team: LabourTeam | undefined }> {
  return s.teamMembers
    .filter((m) => m.employeeId === employeeId)
    .sort((a, b) => b.joinedAt - a.joinedAt)
    .map((member) => ({
      member,
      team: s.labourTeams.find((t) => t.id === member.teamId),
    }));
}

export function teamsForProject(
  s: WorkforceState,
  projectId?: string,
  includeArchived = false,
): LabourTeam[] {
  return s.labourTeams
    .filter(
      (t) =>
        (!projectId || t.projectId === projectId) &&
        (includeArchived || t.status !== "archived"),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function teamUsers(s: WorkforceState, teamId: string): User[] {
  const ids = new Set(activeMembers(s, teamId).map((m) => m.employeeId));
  return s.users.filter((u) => ids.has(u.id));
}

export interface TeamStats {
  size: number;
  /** On approved leave today — counted apart from absence. */
  onLeave: number;
  present: number;
  absent: number;
  late: number;
  working: number;
  /** Mean worked milliseconds across those who are in today. */
  avgWorkedMs: number;
  board: LiveStatus[];
}

/**
 * Today's picture for one gang.
 *
 * The board is reused from the workforce screens rather than recomputed, so
 * a team's "7 present" can never disagree with the project's.
 */
export function teamStats(
  s: WorkforceState,
  teamId: string,
  now = Date.now(),
): TeamStats {
  /* Built from the membership rows outward, not by filtering the live
     board inward. The live board is active-staff-only by design, so
     intersecting with it used to drop anyone on leave — the roster said
     "Members (4)", listed three, and named the missing one as Leader in
     the panel above it. On a team screen, the member on leave is the
     entry you most need to see. */
  const ids = new Set(activeMembers(s, teamId).map((m) => m.employeeId));
  const board = s.users
    .filter((u) => ids.has(u.id))
    .map((u) => liveStatusFor(s, u, now));
  const today = todayISO(now);

  let present = 0;
  let onLeave = 0;
  let late = 0;
  let working = 0;
  let workedTotal = 0;
  let workedCount = 0;

  for (const b of board) {
    const att = s.attendance.find(
      (a) => a.employeeId === b.user.id && a.date === today,
    );
    if (att?.checkIn) {
      present += 1;
      workedTotal += b.workedMs;
      workedCount += 1;
    }
    else if (b.user.status === "on-leave") onLeave += 1;
    if (att?.status === "late") late += 1;
    if (b.state === "working") working += 1;
  }

  return {
    size: ids.size,
    present,
    onLeave,
    /* Approved leave is not absence. Rolling the two together inflated the
       absence rate that performance scoring and payroll both read from. */
    absent: ids.size - present - onLeave,
    late,
    working,
    avgWorkedMs: workedCount ? Math.round(workedTotal / workedCount) : 0,
    board,
  };
}

/**
 * The next free team code on a project.
 *
 * Sequential per project rather than global, because a code is read aloud
 * on a site — "T-004" should mean something here, not be a serial number
 * from an org with two hundred teams.
 */
export function nextTeamCode(s: WorkforceState, projectId: string): string {
  const used = s.labourTeams
    .filter((t) => t.projectId === projectId)
    .map((t) => Number(/^T-(\d+)$/.exec(t.code)?.[1] ?? 0));
  const next = Math.max(0, ...used) + 1;
  return `T-${String(next).padStart(3, "0")}`;
}

/**
 * Workers on the project who are not already on a team.
 *
 * The add-member picker offers these first: a labourer on two gangs at once
 * is nearly always a mistake, and the ones nobody has claimed are the ones
 * a manager is actually looking for.
 */
export function unassignedOnProject(
  s: WorkforceState,
  projectId: string,
): User[] {
  const claimed = new Set(
    s.teamMembers
      .filter((m) => !m.leftAt)
      .filter((m) => {
        const t = s.labourTeams.find((x) => x.id === m.teamId);
        return t?.projectId === projectId;
      })
      .map((m) => m.employeeId),
  );
  return s.users.filter(
    (u) =>
      u.role === "employee" &&
      u.status === "active" &&
      u.projectIds.includes(projectId) &&
      !claimed.has(u.id),
  );
}

/** Group attendance events for a team on a date, newest first. */
export function groupCaptures(
  s: WorkforceState,
  opts: { projectId?: string; teamId?: string; date?: string } = {},
) {
  return s.groupAttendance
    .filter((g) => {
      if (opts.projectId && g.projectId !== opts.projectId) return false;
      if (opts.teamId && g.teamId !== opts.teamId) return false;
      if (opts.date && todayISO(g.capturedAt) !== opts.date) return false;
      return g.status !== "discarded";
    })
    .sort((a, b) => b.capturedAt - a.capturedAt);
}

export function captureMembers(s: WorkforceState, groupAttendanceId: string) {
  return s.groupAttendanceMembers.filter(
    (m) => m.groupAttendanceId === groupAttendanceId,
  );
}
