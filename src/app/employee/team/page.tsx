"use client";

/**
 * My gang.
 *
 * The worker's half of labour teams, and deliberately not a copy of the
 * manager's screen. A labourer does not need to move people between teams
 * or read a performance score; they need to know who they are working with
 * today, who is running the gang, where it is working, and who has not
 * turned up — the things you ask on the way to the site.
 */

import { useMemo } from "react";
import { ScreenHeader } from "@/components/shell";
import { Avatar, Chip, SectionTitle, StatusChip, useNowTick } from "@/components/ui";
import { fmtClock, fmtDateLong, fmtTime } from "@/lib/format";
import { teamStats, teamsOf } from "@/lib/teams";
import { useWorkforce } from "@/lib/store";
import { IMapPin, IUsers } from "@/components/WfIcons";

export default function EmployeeTeam() {
  const { state, currentUser } = useWorkforce();
  const now = useNowTick(20);

  const myTeams = useMemo(
    () => (currentUser ? teamsOf(state, currentUser.id) : []),
    [state, currentUser],
  );

  if (!currentUser) return null;

  return (
    <div>
      <ScreenHeader
        back
        title="My team"
        sub={
          myTeams.length === 0
            ? "Not on a team yet"
            : myTeams.map((t) => t.name).join(" · ")
        }
      />

      <div className="flex flex-col gap-3 px-4">
        {myTeams.length === 0 ? (
          <div className="wf-card2 flex flex-col items-center gap-2.5 px-4 py-8 text-center">
            <IUsers size={22} className="text-[var(--wf-faint)]" />
            <p className="text-sm text-[var(--wf-muted)]">
              You have not been put on a labour team yet. Your supervisor
              organises the gangs on your project.
            </p>
          </div>
        ) : null}

        {myTeams.map((team) => {
          const stats = teamStats(state, team.id, now);
          const project = state.projects.find((p) => p.id === team.projectId);
          const leader = state.users.find((u) => u.id === team.leaderId);
          const engineer = state.users.find((u) => u.id === team.siteEngineerId);
          const zone = project?.zones.find((z) => z.id === team.workZoneId);
          const updates = state.updates
            .filter((u) => u.teamId === team.id)
            .sort((a, b) => b.at - a.at)
            .slice(0, 4);

          return (
            <div key={team.id} className="flex flex-col gap-3">
              <div className="wf-card2 flex flex-col gap-2 px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{team.name}</span>
                  <Chip tone="neutral">{team.code}</Chip>
                </div>
                <p className="text-[0.74rem] text-[var(--wf-muted)]">
                  {project?.name}
                  {zone ? ` · ${zone.name}` : ""}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.74rem]">
                  <span className="font-semibold tabular-nums">
                    {stats.size} <span className="font-normal text-[var(--wf-muted)]">in the gang</span>
                  </span>
                  <span className="tabular-nums text-[var(--wf-green)]">{stats.present} in today</span>
                  {stats.absent > 0 ? (
                    <span className="tabular-nums text-[var(--wf-muted)]">{stats.absent} not in</span>
                  ) : null}
                </div>
                {leader || engineer ? (
                  <p className="text-[0.7rem] text-[var(--wf-faint)]">
                    {leader ? `Led by ${leader.name}` : ""}
                    {leader && engineer ? " · " : ""}
                    {engineer ? `Engineer ${engineer.name}` : ""}
                  </p>
                ) : null}
              </div>

              <SectionTitle>Who is on today</SectionTitle>
              <div className="flex flex-col gap-2">
                {stats.board.map((b) => (
                  <div key={b.user.id} className="wf-card2 flex items-center gap-3 px-3.5 py-2.5">
                    <Avatar
                      name={b.user.name}
                      hue={b.user.avatarHue}
                      photo={b.user.photo}
                      size={34}
                      ring={b.state === "working" ? "green" : "none"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[0.84rem] font-semibold">
                          {b.user.name}
                          {b.user.id === currentUser.id ? " (you)" : ""}
                        </span>
                        {b.user.id === team.leaderId ? <Chip tone="blue">Leader</Chip> : null}
                      </span>
                      <span className="block truncate text-[0.68rem] text-[var(--wf-muted)]">
                        {b.user.designation}
                        {b.state === "working" && b.place !== "—" ? ` · ${b.place}` : ""}
                      </span>
                    </span>
                    {b.state === "working" ? (
                      <Chip tone="green">{fmtClock(b.workedMs).slice(0, 5)}</Chip>
                    ) : (
                      <StatusChip status={b.attendance ? b.attendance.status : "not-in"} />
                    )}
                  </div>
                ))}
              </div>

              {updates.length ? (
                <>
                  <SectionTitle>Team updates</SectionTitle>
                  {updates.map((u) => (
                    <article key={u.id} className="wf-card2 px-3.5 py-3">
                      <div className="flex items-center gap-2">
                        <Chip tone="blue">{u.category}</Chip>
                        <span className="ml-auto text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                          {fmtDateLong(u.date)} · {fmtTime(u.at)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[0.82rem] leading-relaxed text-[var(--wf-muted)]">
                        {u.description}
                      </p>
                      {u.place ? (
                        <p className="mt-1 flex items-center gap-1 text-[0.66rem] text-[var(--wf-faint)]">
                          <IMapPin size={10} /> {u.place}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
