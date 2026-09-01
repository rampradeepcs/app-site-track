"use client";

/**
 * One labour team.
 *
 * Everything a supervisor needs before walking over to the gang: who is on
 * it, who is here, how long they have been working, and what was recorded
 * against them today. The member list reuses the live board that the
 * workforce screens use, so a team's "7 present" can never disagree with
 * the project's.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { TeamEditor } from "@/components/teams/TeamEditor";
import { TeamUpdateForm } from "@/components/teams/TeamUpdateForm";
import { EmployeePicker } from "@/components/EmployeePicker";
import {
  Avatar,
  BottomSheet,
  Chip,
  SectionTitle,
  Segmented,
  StatusChip,
  useNowTick,
} from "@/components/ui";
import { canManageTeams, canCaptureGroupAttendance } from "@/lib/access";
import { fmtClock, fmtDateLong, fmtTime } from "@/lib/format";
import {
  activeMembers,
  assignmentHistory,
  groupCaptures,
  memberHistory,
  teamStats,
  teamsForProject,
  unassignedOnProject,
} from "@/lib/teams";
import { readableNotes } from "@/lib/notes";
import { useWorkforce } from "@/lib/store";
import type { User } from "@/lib/types";
import {
  ICamera,
  ICheck,
  IClipboard,
  IEdit,
  IMapPin,
  IPlus,
  IUsers,
  IX,
} from "@/components/WfIcons";

type Tab = "members" | "today" | "history";

export default function TeamPage() {
  const params = useSearchParams();
  const router = useRouter();
  const teamId = params.get("id") ?? "";
  const { state, addTeamMembers, removeTeamMember, transferMember, setTeamLeader } =
    useWorkforce();
  const now = useNowTick(20);

  const [tab, setTab] = useState<Tab>("members");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<User | null>(null);
  const [logging, setLogging] = useState(false);

  const team = state.labourTeams.find((t) => t.id === teamId);
  const mayManage = canManageTeams(state, state.session?.userId);

  const stats = useMemo(
    () => (team ? teamStats(state, team.id, now) : null),
    [state, team, now],
  );

  const available = useMemo(
    () => (team ? unassignedOnProject(state, team.projectId) : []),
    [state, team],
  );

  const captures = useMemo(
    () => (team ? groupCaptures(state, { teamId: team.id }) : []),
    [state, team],
  );

  const teamUpdates = useMemo(() => {
    if (!team) return [];
    const ids = new Set(activeMembers(state, team.id).map((m) => m.employeeId));
    return state.updates
      .filter(
        (u) =>
          u.teamId === team.id ||
          (ids.has(u.employeeId) && u.projectId === team.projectId),
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, 12);
  }, [state, team]);

  const teamNotes = useMemo(
    () =>
      team
        ? readableNotes(state, state.session?.userId, { projectId: team.projectId }).slice(0, 3)
        : [],
    [state, team],
  );

  if (!team) {
    return (
      <div>
        <ScreenHeader back title="Team" sub="Not found" />
        <p className="wf-card2 mx-4 px-4 py-8 text-center text-sm text-[var(--wf-muted)]">
          This team no longer exists.
        </p>
      </div>
    );
  }

  const project = state.projects.find((p) => p.id === team.projectId);
  const leader = state.users.find((u) => u.id === team.leaderId);
  const engineer = state.users.find((u) => u.id === team.siteEngineerId);
  const zone = project?.zones.find((z) => z.id === team.workZoneId);
  const shift = state.shifts.find((sh) => sh.id === team.shiftId);
  const mayCapture = canCaptureGroupAttendance(state, state.session?.userId, team.projectId);
  const otherTeams = teamsForProject(state, team.projectId).filter((t) => t.id !== team.id);

  return (
    <div>
      <ScreenHeader
        back
        title={team.name}
        sub={`${team.code} · ${project?.name ?? ""}`}
        action={
          mayManage ? (
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setEditing(true)}>
              <IEdit size={15} /> Edit
            </button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 px-4">
        {/* headline numbers */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Members" value={String(stats?.size ?? 0)} />
          <Stat label="Present" value={String(stats?.present ?? 0)} tone="green" />
          <Stat label="Absent" value={String(stats?.absent ?? 0)} />
          <Stat label="Late" value={String(stats?.late ?? 0)} tone={stats?.late ? "warn" : undefined} />
          <Stat label="On site" value={String(stats?.working ?? 0)} />
          <Stat
            label="Avg hours"
            value={stats?.avgWorkedMs ? fmtClock(stats.avgWorkedMs).slice(0, 5) : "—"}
          />
        </div>

        {/* who runs it */}
        <div className="wf-card2 flex flex-col gap-2 px-3.5 py-3">
          <Row label="Trade" value={team.type} />
          <Row label="Leader" value={leader?.name ?? "Not set"} />
          <Row label="Site engineer" value={engineer?.name ?? "Not set"} />
          {zone ? <Row label="Work zone" value={zone.name} /> : null}
          {shift ? <Row label="Shift" value={shift.name} /> : null}
          <Row label="Status" value={team.status} />
          {team.description ? (
            <p className="mt-1 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
              {team.description}
            </p>
          ) : null}
        </div>

        {mayCapture ? (
          <div className="flex gap-2">
            <Link
              href={`/manager/group-attendance?project=${team.projectId}&team=${team.id}`}
              className="wf-btn wf-btn-primary flex-1"
            >
              <ICamera size={16} /> Group photo
            </Link>
            <button className="wf-btn wf-btn-ghost flex-1" onClick={() => setLogging(true)}>
              <IClipboard size={16} /> Log update
            </button>
          </div>
        ) : null}

        <Segmented
          ariaLabel="Team view"
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: "members", label: `Members (${stats?.size ?? 0})` },
            { value: "today", label: "Today" },
            { value: "history", label: "History" },
          ]}
        />

        {tab === "members" ? (
          <>
            {mayManage ? (
              <button
                className="wf-btn wf-btn-ghost"
                onClick={() => {
                  setPicked(new Set());
                  setAdding(true);
                }}
                disabled={available.length === 0}
                title={available.length === 0 ? "Everyone on this project is already on a team" : undefined}
              >
                <IPlus size={15} /> Add labour
              </button>
            ) : null}

            <div className="flex flex-col gap-2">
              {(stats?.board ?? []).length === 0 && (
                <p className="wf-card2 px-4 py-8 text-center text-sm text-[var(--wf-muted)]">
                  Nobody on this team yet.
                </p>
              )}
              {(stats?.board ?? []).map((b) => (
                <div key={b.user.id} className="wf-card2 flex items-center gap-3 px-3.5 py-3">
                  <Avatar
                    name={b.user.name}
                    hue={b.user.avatarHue}
                    size={38}
                    ring={b.state === "working" ? "green" : "none"}
                  />
                  {/* The name gets the line to itself. Sharing it with a
                      Leader chip and a status chip left "Anand Sekar" reading
                      "Ana…" — three characters of the one thing on the row
                      you are actually looking for. Leader moves down to the
                      detail line, where it costs a word instead of a name. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{b.user.name}</span>
                    <span className="block truncate text-[0.7rem] text-[var(--wf-muted)]">
                      {b.user.id === team.leaderId ? "Leader · " : ""}
                      {b.user.employeeCode} · {b.user.designation}
                      {b.state === "working" && b.place !== "—" ? ` · ${b.place}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {b.state === "working" ? (
                      <Chip tone="green">{fmtClock(b.workedMs).slice(0, 5)}</Chip>
                    ) : b.user.status !== "active" ? (
                      /* Employment status outranks the register: a man on
                         approved leave has not failed to turn up. */
                      <StatusChip status={b.user.status} />
                    ) : (
                      <StatusChip status={b.attendance ? b.attendance.status : "not-in"} />
                    )}
                  </span>
                  {mayManage ? (
                    <button
                      className="cursor-pointer p-1.5 text-[var(--wf-faint)]"
                      aria-label={`Manage ${b.user.name}`}
                      onClick={() => setMoving(b.user)}
                    >
                      <IUsers size={16} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {tab === "today" ? (
          <>
            <SectionTitle>Today&apos;s group captures</SectionTitle>
            {captures.filter((c) => fmtDateLong(c.capturedAt) === fmtDateLong(now)).length === 0 ? (
              <p className="wf-card2 px-4 py-6 text-center text-[0.82rem] text-[var(--wf-muted)]">
                No group attendance taken for this team today.
              </p>
            ) : (
              captures
                .filter((c) => fmtDateLong(c.capturedAt) === fmtDateLong(now))
                .map((c) => <CaptureRow key={c.id} id={c.id} />)
            )}

            <SectionTitle>Work updates</SectionTitle>
            {teamUpdates.length === 0 ? (
              <p className="wf-card2 px-4 py-6 text-center text-[0.82rem] text-[var(--wf-muted)]">
                Nothing logged by this team yet.
              </p>
            ) : (
              teamUpdates.map((u) => {
                const who = state.users.find((x) => x.id === u.employeeId);
                return (
                  <article key={u.id} className="wf-card2 px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={who?.name ?? "?"} hue={who?.avatarHue ?? 0} size={22} />
                      <span className="text-[0.8rem] font-semibold">{who?.name}</span>
                      <Chip tone={u.teamId === team.id ? "blue" : "neutral"}>
                        {u.teamId === team.id ? `Team · ${u.category}` : u.category}
                      </Chip>
                      <span className="ml-auto text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                        {fmtTime(u.at)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[0.82rem] leading-relaxed text-[var(--wf-muted)]">
                      {u.description}
                    </p>
                  </article>
                );
              })
            )}

            {teamNotes.length ? (
              <>
                <SectionTitle>Project notes</SectionTitle>
                {teamNotes.map((n) => (
                  <Link
                    key={n.id}
                    href={`/manager/notes?project=${team.projectId}`}
                    className="wf-card2 px-3.5 py-3"
                  >
                    <p className="text-[0.84rem] font-semibold">{n.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[0.76rem] text-[var(--wf-muted)]">
                      {n.body}
                    </p>
                  </Link>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {tab === "history" ? (
          <>
            <SectionTitle>Group attendance</SectionTitle>
            {captures.length === 0 ? (
              <p className="wf-card2 px-4 py-6 text-center text-[0.82rem] text-[var(--wf-muted)]">
                No captures recorded for this team.
              </p>
            ) : (
              captures.map((c) => <CaptureRow key={c.id} id={c.id} />)
            )}

            <SectionTitle>Membership</SectionTitle>
            <div className="flex flex-col gap-2">
              {memberHistory(state, team.id).map((m) => {
                const u = state.users.find((x) => x.id === m.employeeId);
                const to = state.labourTeams.find((t) => t.id === m.transferredToTeamId);
                return (
                  <div key={m.id} className="wf-card2 flex items-center gap-3 px-3.5 py-2.5">
                    <Avatar name={u?.name ?? "?"} hue={u?.avatarHue ?? 0} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.82rem] font-semibold">
                        {u?.name ?? m.employeeId}
                      </span>
                      <span className="block text-[0.68rem] text-[var(--wf-faint)]">
                        {fmtDateLong(m.joinedAt)} –{" "}
                        {m.leftAt ? fmtDateLong(m.leftAt) : "present"}
                        {to ? ` · moved to ${to.name}` : ""}
                      </span>
                    </span>
                    <Chip tone={m.leftAt ? "neutral" : "green"}>{m.status}</Chip>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      <TeamUpdateForm
        key={logging ? "log-open" : "log-closed"}
        open={logging}
        team={team}
        onClose={() => setLogging(false)}
      />

      <TeamEditor
        key={editing ? "edit-open" : "edit-closed"}
        open={editing}
        projectId={team.projectId}
        editing={team}
        onClose={() => setEditing(false)}
      />

      {/* add labour */}
      <BottomSheet open={adding} onClose={() => setAdding(false)} title="Add labour" tall fill>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <p className="text-[0.78rem] leading-snug text-[var(--wf-muted)]">
            Workers on {project?.name ?? "this project"} who are not already on a team.
          </p>
          <EmployeePicker
            people={available}
            selected={picked}
            fill
            onToggle={(u) =>
              setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(u.id)) next.delete(u.id);
                else next.add(u.id);
                return next;
              })
            }
          />
          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={picked.size === 0}
            onClick={() => {
              addTeamMembers(team.id, [...picked]);
              setAdding(false);
            }}
          >
            <ICheck size={16} /> Add {picked.size || ""} to {team.name}
          </button>
        </div>
      </BottomSheet>

      {/* one member's options */}
      <BottomSheet
        open={!!moving}
        onClose={() => setMoving(null)}
        title={moving?.name ?? "Member"}
      >
        {moving ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-[0.76rem] text-[var(--wf-muted)]">
              {moving.employeeCode} · {moving.designation}
            </p>

            {team.leaderId !== moving.id ? (
              <button
                className="wf-btn wf-btn-ghost"
                onClick={() => {
                  setTeamLeader(team.id, moving.id);
                  setMoving(null);
                }}
              >
                Make team leader
              </button>
            ) : (
              <button
                className="wf-btn wf-btn-ghost"
                onClick={() => {
                  setTeamLeader(team.id, undefined);
                  setMoving(null);
                }}
              >
                Remove as team leader
              </button>
            )}

            {otherTeams.length ? (
              <>
                <p className="mt-1 text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                  Transfer to
                </p>
                {otherTeams.map((t) => (
                  <button
                    key={t.id}
                    className="wf-btn wf-btn-ghost"
                    onClick={() => {
                      transferMember(moving.id, team.id, t.id);
                      setMoving(null);
                    }}
                  >
                    {t.name}
                  </button>
                ))}
              </>
            ) : null}

            <button
              className="wf-btn wf-btn-ghost wf-btn-danger-text"
              onClick={() => {
                removeTeamMember(team.id, moving.id);
                setMoving(null);
              }}
            >
              <IX size={15} /> Remove from team
            </button>

            <p className="text-center text-[0.68rem] leading-relaxed text-[var(--wf-faint)]">
              {assignmentHistory(state, moving.id).length} team assignment
              {assignmentHistory(state, moving.id).length === 1 ? "" : "s"} on record.
              Removing someone ends their spell; it does not erase it.
            </p>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );

  function CaptureRow({ id }: { id: string }) {
    const c = state.groupAttendance.find((g) => g.id === id)!;
    const members = state.groupAttendanceMembers.filter((m) => m.groupAttendanceId === id);
    const present = members.filter((m) => m.attendanceStatus === "present").length;
    return (
      <button
        className="wf-card2 flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left"
        onClick={() => router.push(`/manager/group-attendance/history?id=${c.id}`)}
      >
        {c.photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.photos[0]}
            alt=""
            className="h-11 w-11 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-[0.82rem] font-semibold">
            {fmtDateLong(c.capturedAt)} · {fmtTime(c.capturedAt)}
          </span>
          <span className="block text-[0.7rem] text-[var(--wf-muted)]">
            {c.faceCount} faces · {present} present · {members.length - present} absent
          </span>
        </span>
        <Chip tone={c.geofenceStatus === "inside" ? "green" : "amber"}>
          <IMapPin size={10} /> {c.geofenceStatus}
        </Chip>
      </button>
    );
  }
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "warn";
}) {
  return (
    <div className="wf-card2 px-3 py-2.5">
      <p
        className="text-[1.05rem] font-bold tabular-nums"
        style={{
          color:
            tone === "green"
              ? "var(--wf-green)"
              : tone === "warn"
                ? "var(--wf-warn)"
                : undefined,
        }}
      >
        {value}
      </p>
      <p className="text-[0.62rem] uppercase tracking-wider text-[var(--wf-muted)]">
        {label}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[0.74rem] text-[var(--wf-muted)]">{label}</span>
      <span className="truncate text-[0.82rem] font-semibold">{value}</span>
    </div>
  );
}
