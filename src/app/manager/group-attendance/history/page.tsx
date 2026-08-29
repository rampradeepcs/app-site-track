"use client";

/**
 * Group attendance history.
 *
 * The evidence view. Pick a project, a team and a day and you get the
 * photograph, where it was taken, who took it, what the software saw and
 * what the reviewer decided — which is the whole point of storing the
 * capture rather than just its outcome. A register that says "present" and
 * cannot say why is not auditable.
 */

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { Avatar, Chip, SectionTitle } from "@/components/ui";
import { SiteMap } from "@/components/SiteMap";
import { fmtDateLong, fmtTime, todayISO } from "@/lib/format";
import { groupCaptures, teamsForProject } from "@/lib/teams";
import { useWorkforce } from "@/lib/store";
import { IMapPin } from "@/components/WfIcons";

export default function GroupAttendanceHistory() {
  const params = useSearchParams();
  const { state } = useWorkforce();
  const focusId = params.get("id");

  const [projectId, setProjectId] = useState(
    params.get("project") ?? state.activeProjectId ?? state.projects[0]?.id ?? "",
  );
  const [teamId, setTeamId] = useState(params.get("team") ?? "");
  const [date, setDate] = useState("");

  const teams = useMemo(() => teamsForProject(state, projectId), [state, projectId]);

  const captures = useMemo(() => {
    if (focusId) return state.groupAttendance.filter((g) => g.id === focusId);
    return groupCaptures(state, {
      projectId,
      teamId: teamId || undefined,
      date: date || undefined,
    });
  }, [state, projectId, teamId, date, focusId]);

  const dates = useMemo(() => {
    const set = new Set(
      groupCaptures(state, { projectId }).map((g) => todayISO(g.capturedAt)),
    );
    return [...set].sort().reverse();
  }, [state, projectId]);

  return (
    <div>
      <ScreenHeader
        back
        title="Group attendance"
        sub={focusId ? "One capture" : `${captures.length} captures`}
      />

      <div className="flex flex-col gap-3 px-4">
        {!focusId ? (
          <>
            {state.projects.length > 1 && (
              <select
                className="wf-input"
                aria-label="Project"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setTeamId("");
                }}
              >
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <div className="grid grid-cols-2 gap-2">
              <select
                className="wf-input"
                aria-label="Team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                className="wf-input"
                aria-label="Date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              >
                <option value="">All dates</option>
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {fmtDateLong(d)}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        {captures.length === 0 ? (
          <p className="wf-card2 px-4 py-8 text-center text-sm text-[var(--wf-muted)]">
            No group attendance recorded for this selection.
          </p>
        ) : null}

        {captures.map((c) => {
          const team = state.labourTeams.find((t) => t.id === c.teamId);
          const engineer = state.users.find((u) => u.id === c.siteEngineerId);
          const members = state.groupAttendanceMembers.filter(
            (m) => m.groupAttendanceId === c.id,
          );
          const present = members.filter((m) => m.attendanceStatus === "present");
          const absent = members.filter((m) => m.attendanceStatus === "absent");

          return (
            <div key={c.id} className="flex flex-col gap-2.5">
              <div className="wf-card2 flex flex-col gap-2 px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{team?.name ?? "Team"}</span>
                    <span className="block text-[0.7rem] text-[var(--wf-muted)]">
                      {fmtDateLong(c.capturedAt)} · {fmtTime(c.capturedAt)}
                    </span>
                  </span>
                  <Chip tone={c.geofenceStatus === "inside" ? "green" : "amber"}>
                    <IMapPin size={10} /> {c.geofenceStatus}
                  </Chip>
                </div>
                <p className="text-[0.72rem] text-[var(--wf-faint)]">
                  {c.id} · taken by {engineer?.name ?? "—"}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.74rem]">
                  <span>{members.length} members</span>
                  <span className="text-[var(--wf-green)]">{present.length} present</span>
                  <span className="text-[var(--wf-muted)]">{absent.length} absent</span>
                  <span className="text-[var(--wf-faint)]">{c.faceCount} faces detected</span>
                  <span className="text-[var(--wf-faint)]">{c.matchedCount} matched</span>
                </div>
              </div>

              {c.photos.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {c.photos.map((p, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={p}
                      alt={`Group photo ${i + 1}`}
                      className="h-32 w-full rounded-lg object-cover"
                    />
                  ))}
                </div>
              ) : null}

              {c.coords ? (
                <SiteMap
                  project={state.projects.find((p) => p.id === c.projectId) ?? null}
                  heightClass="h-44"
                  follow={c.coords}
                  markers={[
                    {
                      id: c.id,
                      coords: c.coords,
                      label: team?.name ?? "Capture",
                      sub: fmtTime(c.capturedAt),
                      kind: "point",
                    },
                  ]}
                />
              ) : null}

              <SectionTitle>Attendance review</SectionTitle>
              <div className="flex flex-col gap-2">
                {members.map((m) => {
                  const u = state.users.find((x) => x.id === m.employeeId);
                  return (
                    <div
                      key={m.id}
                      className="wf-card2 flex items-center gap-3 px-3.5 py-2.5"
                    >
                      <Avatar name={u?.name ?? "?"} hue={u?.avatarHue ?? 0} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.82rem] font-semibold">
                          {u?.name ?? m.employeeId}
                        </span>
                        <span className="block text-[0.66rem] text-[var(--wf-muted)]">
                          {m.detectionStatus === "detected" ? "Face detected" : "Not detected"}
                          {" · "}
                          {m.matchStatus}
                          {m.distance !== undefined ? ` · d ${m.distance.toFixed(2)}` : ""}
                          {m.reviewStatus === "corrected" ? " · corrected by reviewer" : ""}
                        </span>
                      </span>
                      <Chip tone={m.attendanceStatus === "present" ? "green" : "neutral"}>
                        {m.attendanceStatus}
                      </Chip>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <p className="pb-2 text-[0.68rem] leading-relaxed text-[var(--wf-faint)]">
          Group photos are attendance evidence. They are stored on this device with
          the rest of the company&apos;s records and are visible to the people who
          can already see the register.
        </p>
      </div>
    </div>
  );
}
