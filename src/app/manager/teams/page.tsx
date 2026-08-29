"use client";

/**
 * Labour teams for a project.
 *
 * The list is the answer to the first question a manager asks when they
 * open a job: what gangs are working here, and did they turn up. So each
 * row carries today's headcount rather than a name and a chevron — a list
 * you have to tap through to learn anything is a menu, not a dashboard.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { TeamEditor } from "@/components/teams/TeamEditor";
import { Avatar, Chip, useNowTick } from "@/components/ui";
import { StatusPills, countByStatus } from "@/components/StatusPills";
import { canManageTeams } from "@/lib/access";
import { fmtClock } from "@/lib/format";
import { teamStats, teamsForProject, activeMembers } from "@/lib/teams";
import { useWorkforce } from "@/lib/store";
import { IArrowR, ICamera, IPlus, ISearch, IUsers } from "@/components/WfIcons";

export default function TeamsPage() {
  const { state } = useWorkforce();
  const now = useNowTick(30);
  const [projectId, setProjectId] = useState(
    state.activeProjectId ?? state.projects[0]?.id ?? "",
  );
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const mayManage = canManageTeams(state, state.session?.userId);
  const teams = useMemo(
    () => teamsForProject(state, projectId),
    [state, projectId],
  );

  const counts = useMemo(() => countByStatus(teams, (t) => t.type), [teams]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams.filter((t) => {
      if (type && t.type !== type) return false;
      if (!q) return true;
      return `${t.name} ${t.type} ${t.code}`.toLowerCase().includes(q);
    });
  }, [teams, query, type]);

  const totals = useMemo(() => {
    let workers = 0;
    let present = 0;
    for (const t of teams) {
      const st = teamStats(state, t.id, now);
      workers += st.size;
      present += st.present;
    }
    return { workers, present };
  }, [teams, state, now]);

  return (
    <div>
      <ScreenHeader
        back
        title="Labour teams"
        sub={`${teams.length} teams · ${totals.workers} workers · ${totals.present} in today`}
        action={
          mayManage ? (
            <button
              className="wf-btn wf-btn-primary wf-btn-sm"
              onClick={() => setEditing(true)}
              disabled={!projectId}
            >
              <IPlus size={15} /> Team
            </button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 px-4">
        {state.projects.length > 1 && (
          <select
            className="wf-input"
            aria-label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <div className="relative">
          <ISearch
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]"
          />
          <input
            className="wf-input wf-input-search"
            aria-label="Search teams"
            placeholder="Search team, trade or code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <StatusPills
          counts={counts}
          value={type}
          onChange={setType}
          emptyLabel="No teams on this project yet."
        />

        <div className="flex flex-col gap-2">
          {rows.length === 0 && (
            <div className="wf-card2 flex flex-col items-center gap-2.5 px-4 py-8 text-center">
              <IUsers size={22} className="text-[var(--wf-faint)]" />
              <p className="text-sm text-[var(--wf-muted)]">
                {teams.length === 0
                  ? "No labour teams on this project yet."
                  : "No teams match."}
              </p>
              {mayManage && teams.length === 0 ? (
                <button
                  className="wf-btn wf-btn-ghost wf-btn-sm"
                  onClick={() => setEditing(true)}
                >
                  <IPlus size={14} /> Create the first team
                </button>
              ) : null}
            </div>
          )}

          {rows.map((t) => {
            const st = teamStats(state, t.id, now);
            const leader = state.users.find((u) => u.id === t.leaderId);
            const zone = state.projects
              .find((p) => p.id === t.projectId)
              ?.zones.find((z) => z.id === t.workZoneId);
            return (
              <Link
                key={t.id}
                href={`/manager/team?id=${t.id}`}
                className="wf-card2 flex flex-col gap-2.5 px-3.5 py-3 transition hover:border-[var(--wf-line-strong)]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{t.name}</span>
                      <Chip tone={t.status === "active" ? "green" : "neutral"}>
                        {t.code}
                      </Chip>
                    </span>
                    <span className="mt-0.5 block truncate text-[0.72rem] text-[var(--wf-muted)]">
                      {leader ? `Led by ${leader.name}` : "No leader set"}
                      {zone ? ` · ${zone.name}` : ""}
                    </span>
                  </span>
                  <IArrowR size={15} className="shrink-0 text-[var(--wf-faint)]" />
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.72rem]">
                  <span className="font-semibold tabular-nums">
                    {st.size}{" "}
                    <span className="font-normal text-[var(--wf-muted)]">
                      {st.size === 1 ? "member" : "members"}
                    </span>
                  </span>
                  <span className="tabular-nums text-[var(--wf-green)]">
                    {st.present} present
                  </span>
                  {st.absent > 0 ? (
                    <span className="tabular-nums text-[var(--wf-muted)]">
                      {st.absent} absent
                    </span>
                  ) : null}
                  {st.late > 0 ? (
                    <span className="tabular-nums text-[var(--wf-warn)]">{st.late} late</span>
                  ) : null}
                  {st.avgWorkedMs > 0 ? (
                    <span className="ml-auto tabular-nums text-[var(--wf-faint)]">
                      avg {fmtClock(st.avgWorkedMs).slice(0, 5)}
                    </span>
                  ) : null}
                </div>

                {/* The people, at a glance. A gang is faces, not a number. */}
                <div className="flex items-center gap-1">
                  {activeMembers(state, t.id)
                    .slice(0, 8)
                    .map((m) => {
                      const u = state.users.find((x) => x.id === m.employeeId);
                      return u ? (
                        <Avatar key={m.id} name={u.name} hue={u.avatarHue} size={22} />
                      ) : null;
                    })}
                  {st.size > 8 ? (
                    <span className="text-[0.68rem] text-[var(--wf-faint)]">
                      +{st.size - 8}
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>

        {projectId && rows.length > 0 ? (
          <Link
            href={`/manager/group-attendance?project=${projectId}`}
            className="wf-btn wf-btn-ghost"
          >
            <ICamera size={16} /> Take group attendance
          </Link>
        ) : null}
      </div>

      {projectId ? (
        <TeamEditor
          key={editing ? "open" : "closed"}
          open={editing}
          projectId={projectId}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
