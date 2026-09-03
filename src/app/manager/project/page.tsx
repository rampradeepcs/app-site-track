"use client";

/**
 * Project dashboard — overview KPIs, live workforce map, geofence editor,
 * team assignment, attendance and work-update feeds for one project.
 */

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GeofenceEditor } from "@/components/GeofenceEditor";
import { ScreenHeader } from "@/components/shell";
import { SiteMap, type MapMarker } from "@/components/SiteMap";
import { BarTrend } from "@/components/charts";
import { EmployeePicker } from "@/components/EmployeePicker";
import { STATUS_TEXT, StatusPills } from "@/components/StatusPills";
import {
  Avatar,
  BottomSheet,
  Chip,
  KpiCard,
  SectionTitle,
  Segmented,
  StatusChip,
  Toggle,
  useNowTick,
} from "@/components/ui";
import {
  fmtClock,
  fmtDateLong,
  fmtDuration,
  fmtShiftTime,
  fmtTime,
  initialsOf,
  todayISO,
} from "@/lib/format";
import { attendanceTrend, liveBoard } from "@/lib/metrics";
import { activeMembers, groupCaptures, teamsForProject } from "@/lib/teams";
import { noteSummary } from "@/lib/notes";
import { ProjectHints } from "@/components/notes/ProjectHints";
import { useWorkforce } from "@/lib/store";
import {
  IArrowR,
  ICheck,
  ISearch,
  IMapPin,
  IPhone,
  IPlus,
  ITarget,
  IUsers,
  IX,
} from "@/components/WfIcons";

type Tab = "overview" | "geofence" | "team" | "attendance" | "updates";

export default function ProjectPage() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-sm text-[var(--wf-muted)]">Loading…</div>}>
      <ProjectInner />
    </Suspense>
  );
}

function ProjectInner() {
  const { state, updateGeofence, saveProject, assignEmployee, removeEmployeeFromProject } =
    useWorkforce();
  const params = useSearchParams();
  const id = params.get("id");
  const project = state.projects.find((p) => p.id === id) ?? null;
  const [tab, setTab] = useState<Tab>("overview");
  const [assigning, setAssigning] = useState(false);
  const now = useNowTick(15);

  const board = useMemo(
    () => (project ? liveBoard(state, project.id, now) : []),
    [state, project, now],
  );
  const trend = useMemo(
    () => (project ? attendanceTrend(state, 10, project.id, now) : []),
    [state, project, now],
  );

  /* team-based workforce, notes and today's captures */
  const projectTeams = useMemo(
    () => (project ? teamsForProject(state, project.id) : []),
    [state, project],
  );
  const teamWorkers = useMemo(
    () =>
      projectTeams.reduce((n, t) => n + activeMembers(state, t.id).length, 0),
    [projectTeams, state],
  );
  const todaysCaptures = useMemo(
    () =>
      project
        ? groupCaptures(state, { projectId: project.id, date: todayISO(now) })
        : [],
    [state, project, now],
  );
  const notes = useMemo(
    () =>
      project
        ? noteSummary(state, state.session?.userId, project.id)
        : { open: 0, important: 0, critical: 0, pinned: 0 },
    [state, project],
  );

  if (!project) {
    // The header carries the back button here too. A not-found state is
    // exactly when someone most needs the ordinary way out, and it is the
    // one screen that hides the tab bar without offering one.
    return (
      <div>
        <ScreenHeader back title="Project not found" />
        <p className="px-4 pt-6 text-center text-sm text-[var(--wf-muted)]">
          It may have been removed.{" "}
          <Link href="/manager/projects" className="font-semibold text-[var(--wf-amber)]">
            Back to projects
          </Link>
        </p>
      </div>
    );
  }

  const working = board.filter((b) => b.state === "working");
  const team = state.users.filter((u) => project.employeeIds.includes(u.id));
  const unassigned = state.users.filter(
    (u) => u.role === "employee" && u.status === "active" && !project.employeeIds.includes(u.id),
  );
  const attendance = state.attendance
    .filter((a) => a.projectId === project.id && a.checkIn)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const updates = state.updates.filter((u) => u.projectId === project.id).slice(0, 20);

  /* ---- attendance tab: date, search, and totals that agree with them ---- */

  // Opens on the most recent day that has records rather than on today,
  // which on a quiet morning would show an empty table and zero totals.
  const [attDate, setAttDate] = useState(() => attendance[0]?.date ?? "");
  const [attQuery, setAttQuery] = useState("");
  const [attStatus, setAttStatus] = useState<string | null>(null);

  const attRows = useMemo(() => {
    const q = attQuery.trim().toLowerCase();
    return attendance.filter((a) => {
      if (attDate && a.date !== attDate) return false;
      if (attStatus && a.status !== attStatus) return false;
      if (!q) return true;
      const u = state.users.find((x) => x.id === a.employeeId);
      return [u?.name, u?.employeeCode, u?.designation]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [attendance, attDate, attQuery, attStatus, state.users]);

  /*
   * Totals describe exactly the rows below them.
   *
   * Counting the whole project while the table shows one filtered day would
   * be worse than no total at all — the number would look like a summary of
   * what you are reading and would not be one.
   */
  /*
   * The pills count the day and the search, deliberately *not* the status
   * they filter by. Counting the filtered rows would zero every other pill
   * the moment you picked one, leaving no way to see what else was there
   * or to compare — the strip has to keep describing the whole day.
   */
  const attTotals = useMemo(() => {
    const q = attQuery.trim().toLowerCase();
    const by = new Map<string, number>();
    for (const a of attendance) {
      if (attDate && a.date !== attDate) continue;
      if (q) {
        const u = state.users.find((x) => x.id === a.employeeId);
        const hit = [u?.name, u?.employeeCode, u?.designation]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
        if (!hit) continue;
      }
      by.set(a.status, (by.get(a.status) ?? 0) + 1);
    }
    return by;
  }, [attendance, attDate, attQuery, state.users]);


  /** Only dates this project actually has records for. */
  const attDates = useMemo(
    () => [...new Set(attendance.map((a) => a.date))].sort().reverse(),
    [attendance],
  );

  const markers: MapMarker[] = working
    .filter((b) => b.lastPoint)
    .map((b) => ({
      id: b.user.id,
      coords: { lat: b.lastPoint!.lat, lng: b.lastPoint!.lng },
      kind: "worker" as const,
      hue: b.user.avatarHue,
      initials: initialsOf(b.user.name),
      label: `${b.user.name.split(" ")[0]} — ${b.place}`,
      pulse: true,
    }));

  return (
    <div>
      <ScreenHeader
        back
        title={project.name}
        sub={`${project.code} · ${project.client}`}
        action={
          <StatusChip
            status={project.status === "active" ? "working" : "not-in"}
            label={project.status[0].toUpperCase() + project.status.slice(1)}
          />
        }
      />
      <div className="flex flex-col gap-4 px-4">
        <Segmented<Tab>
          ariaLabel="Project sections"
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: "overview", label: "Overview" },
            { value: "geofence", label: "Geofence" },
            { value: "team", label: `Team (${team.length})` },
            { value: "attendance", label: "Attendance" },
            { value: "updates", label: "Updates" },
          ]}
        />

        {tab === "overview" && (
          <>
            {/* What the site needs to know before anything else on the page. */}
            <ProjectHints projectId={project.id} />

            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <KpiCard label="On site now" value={working.length} tone="green" />
              <KpiCard label="Present today" value={board.filter((b) => b.attendance).length} tone="blue" sub={`of ${team.length} assigned`} />
              <KpiCard label="Completed" value={board.filter((b) => b.attendance?.checkOut).length} />
              <KpiCard
                label="Shift"
                value={`${fmtShiftTime(project.rules.shiftStart).replace(" ", "")}`}
                sub={`to ${fmtShiftTime(project.rules.shiftEnd)}`}
              />
            </div>
            <SiteMap
              project={project}
              markers={markers}
              heightClass="h-[320px]"
            />
            <div className="wf-card grid gap-3 p-4 text-[0.82rem] sm:grid-cols-2">
              <p className="flex items-center gap-2 text-[var(--wf-muted)]">
                <IMapPin size={14} className="shrink-0 text-[var(--wf-amber)]" /> {project.address}
              </p>
              <p className="flex items-center gap-2 text-[var(--wf-muted)]">
                <IPhone size={14} className="shrink-0 text-[var(--wf-amber)]" /> {project.siteContact} · {project.siteContactPhone}
              </p>
              <p className="text-[var(--wf-muted)] sm:col-span-2">{project.description}</p>
              <p className="text-[0.72rem] text-[var(--wf-faint)] sm:col-span-2">
                {fmtDateLong(project.startDate)} → {project.endDate ? fmtDateLong(project.endDate) : "TBD"}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <Link href={`/manager/teams?project=${project.id}`} className="wf-card2 px-3 py-2.5">
                <p className="text-[1.05rem] font-bold tabular-nums">{projectTeams.length}</p>
                <p className="text-[0.62rem] uppercase tracking-wider text-[var(--wf-muted)]">
                  Labour teams
                </p>
                <p className="mt-0.5 text-[0.66rem] text-[var(--wf-faint)]">
                  {teamWorkers} workers
                </p>
              </Link>
              <Link
                href={`/manager/group-attendance/history?project=${project.id}`}
                className="wf-card2 px-3 py-2.5"
              >
                <p className="text-[1.05rem] font-bold tabular-nums">{todaysCaptures.length}</p>
                <p className="text-[0.62rem] uppercase tracking-wider text-[var(--wf-muted)]">
                  Group captures
                </p>
                <p className="mt-0.5 text-[0.66rem] text-[var(--wf-faint)]">today</p>
              </Link>
              <Link href={`/manager/notes?project=${project.id}`} className="wf-card2 px-3 py-2.5">
                <p className="text-[1.05rem] font-bold tabular-nums">{notes.open}</p>
                <p className="text-[0.62rem] uppercase tracking-wider text-[var(--wf-muted)]">
                  Open notes
                </p>
                <p className="mt-0.5 text-[0.66rem] text-[var(--wf-faint)]">
                  {notes.critical} critical · {notes.important} important
                </p>
              </Link>
            </div>

            <div className="wf-card p-4">
              <SectionTitle>Attendance trend</SectionTitle>
              <BarTrend
                data={trend.map((t) => t.presentPct)}
                labels={trend.map((t) => t.date.slice(8))}
                format={(v) => `${Math.round(v)}%`}
                ariaLabel="Project attendance trend"
                height={90}
              />
            </div>
          </>
        )}

        {tab === "geofence" && (
          <>
            <GeofenceEditor
              key={project.id}
              project={project}
              onSave={(fence) => {
                updateGeofence(project.id, fence);
              }}
            />
            {/* Editable here rather than only at creation: the reason to
                narrow tracking usually surfaces once a crew is working. */}
            <div className="wf-card flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.88rem] font-bold">
                    Track employees inside the boundary
                  </p>
                  <p className="mt-0.5 text-[0.76rem] leading-snug text-[var(--wf-muted)]">
                    {project.trackingMode === "full-shift"
                      ? "The full shift is recorded, from check-in to checkout."
                      : "Nothing is recorded on site. Recording starts when someone leaves the boundary and runs until checkout — and checkout is only accepted at one of their assigned premises."}
                  </p>
                </div>
                <Toggle
                  checked={project.trackingMode === "full-shift"}
                  onChange={(on) =>
                    saveProject(
                      {
                        name: project.name,
                        trackingMode: on ? "full-shift" : "outside-only",
                      },
                      project.id,
                    )
                  }
                  label="Track employees inside the project boundary"
                />
              </div>
            </div>
            <div className="wf-card p-4 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
              <p className="mb-1 font-bold text-[var(--wf-fg)]">How the fence is enforced</p>
              Inside the boundary → check-in allowed. Outside → check-in blocked
              with distance guidance. Leaving mid-shift never auto-ends the
              shift: the exit is recorded and both employee and manager are
              notified per project rules ({project.rules.exitAlertMinutes} min
              alert threshold).
            </div>
          </>
        )}

        {tab === "team" && (
          <>
            <button className="wf-btn wf-btn-primary" onClick={() => setAssigning(true)}>
              <IPlus size={16} /> Assign employees
            </button>
            <div className="flex flex-col gap-2">
              {team.length === 0 && (
                <p className="wf-card2 px-4 py-6 text-center text-sm text-[var(--wf-muted)]">
                  Nobody assigned yet.
                </p>
              )}
              {team.map((u) => {
                const live = board.find((b) => b.user.id === u.id);
                return (
                  <div key={u.id} className="wf-card2 flex items-center gap-3 px-3.5 py-3">
                    <Avatar
                      name={u.name}
                      hue={u.avatarHue}
                      photo={u.photo}
                      size={40}
                      ring={live?.state === "working" ? "green" : "none"}
                    />
                    <Link href={`/manager/employee?id=${u.id}`} className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{u.name}</span>
                      <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                        {u.designation} · {u.employeeCode}
                      </span>
                    </Link>
                    {live?.state === "working" ? (
                      <Chip tone="green">{live.place}</Chip>
                    ) : (
                      <StatusChip status={live?.attendance ? live.attendance.status : "not-in"} />
                    )}
                    <button
                      aria-label={`Remove ${u.name} from project`}
                      className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-[var(--wf-faint)] transition hover:bg-[var(--wf-red-soft)] hover:text-[var(--wf-red)]"
                      onClick={() => removeEmployeeFromProject(u.id, project.id)}
                    >
                      <IX size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "attendance" && (
          <>
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="wf-input w-auto min-w-40 flex-1"
                  aria-label="Attendance date"
                  value={attDate}
                  onChange={(e) => setAttDate(e.target.value)}
                >
                  <option value="">All dates</option>
                  {attDates.map((d) => (
                    <option key={d} value={d}>
                      {fmtDateLong(d)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <ISearch
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]"
                />
                <input
                  className="wf-input wf-input-search"
                  placeholder="Search name, code, trade…"
                  value={attQuery}
                  onChange={(e) => setAttQuery(e.target.value)}
                />
              </div>

              {/* Totals for the rows below, not for the project — see the
                  note where they are computed. */}
              <StatusPills
                counts={attTotals}
                value={attStatus}
                onChange={setAttStatus}
              />
            </div>

            <div className="wf-card overflow-hidden">
            <div className="wf-scroll-x">
              <table className="wf-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employee</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Hours</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {attRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[var(--wf-muted)]">
                        No {attStatus ? (STATUS_TEXT[attStatus] ?? attStatus).toLowerCase() : ""} records match.
                      </td>
                    </tr>
                  ) : null}
                  {attRows.slice(0, 60).map((a) => {
                    const u = state.users.find((x) => x.id === a.employeeId);
                    return (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap tabular-nums">{a.date.slice(5)}</td>
                        <td className="whitespace-nowrap font-semibold">{u?.name}</td>
                        <td className="whitespace-nowrap tabular-nums">{a.checkIn ? fmtTime(a.checkIn.at) : "—"}</td>
                        <td className="whitespace-nowrap tabular-nums">{a.checkOut ? fmtTime(a.checkOut.at) : "…"}</td>
                        <td className="whitespace-nowrap tabular-nums">
                          {a.workedMinutes != null
                            ? fmtDuration(a.workedMinutes)
                            : a.checkIn && !a.checkOut
                              ? fmtClock(now - a.checkIn.at).slice(0, 5)
                              : "—"}
                        </td>
                        <td><StatusChip status={a.status} /></td>
                        <td>
                          <Link
                            href={`/manager/history?att=${a.id}`}
                            className="wf-btn wf-btn-quiet wf-btn-sm"
                          >
                            Route <IArrowR size={12} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </div>
          </>
        )}

        {tab === "updates" && (
          <div className="flex flex-col gap-2.5">
            {updates.length === 0 && (
              <p className="wf-card2 px-4 py-6 text-center text-sm text-[var(--wf-muted)]">
                No work updates for this project yet.
              </p>
            )}
            {updates.map((u) => {
              const emp = state.users.find((x) => x.id === u.employeeId);
              return (
                <article key={u.id} className="wf-card2 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Avatar name={emp?.name ?? "?"} hue={emp?.avatarHue ?? 0} photo={emp?.photo} size={26} />
                    <span className="text-[0.82rem] font-semibold">{emp?.name}</span>
                    <Chip tone={u.kind === "daily" ? "blue" : "neutral"}>
                      {u.kind === "daily" ? "Daily summary" : u.category}
                    </Chip>
                    <span className="ml-auto text-[0.68rem] tabular-nums text-[var(--wf-faint)]">
                      {fmtDateLong(u.date)} · {fmtTime(u.at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[0.84rem] leading-relaxed text-[var(--wf-muted)]">
                    {u.description}
                  </p>
                  {u.place ? (
                    <p className="mt-1 flex items-center gap-1 text-[0.68rem] text-[var(--wf-faint)]">
                      <IMapPin size={11} /> {u.place}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* assignment sheet */}
      <BottomSheet open={assigning} onClose={() => setAssigning(false)} title="Assign employees" tall fill>
        {unassigned.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--wf-muted)]">
            <IUsers size={22} className="mx-auto mb-2" />
            Every active employee is already on this project.
          </p>
        ) : (
          /* Single-select: assigning is one tap with nothing to confirm, so
             the row acts immediately rather than building a set. */
          <EmployeePicker
            fill
            people={unassigned}
            mode="single"
            onToggle={(u) => assignEmployee(u.id, project.id)}
            maxHeight="24rem"
            emptyLabel="Nobody available matches"
            secondary={(u) =>
              `${u.designation}${
                u.projectIds.length
                  ? ` · also on ${u.projectIds.length} project${u.projectIds.length > 1 ? "s" : ""}`
                  : ""
              }`
            }
            action={(u) => (
              <button
                className="wf-btn wf-btn-ghost wf-btn-sm shrink-0"
                onClick={() => assignEmployee(u.id, project.id)}
              >
                <ICheck size={14} /> Assign
              </button>
            )}
          />
        )}
      </BottomSheet>

      {/* target chip for zones */}
      <div className="mt-4 flex items-center justify-center gap-1.5 pb-2 text-[0.66rem] text-[var(--wf-faint)]">
        <ITarget size={12} /> {project.zones.length} named zones on the site plan
      </div>
    </div>
  );
}
