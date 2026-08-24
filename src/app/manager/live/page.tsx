"use client";

/**
 * Live workforce map — every checked-in employee as a live marker; tap one
 * for their shift card, or lock on to follow their movement in real time.
 */

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ScreenHeader } from "@/components/shell";
import { SiteMap, type MapMarker } from "@/components/SiteMap";
import { Avatar, BottomSheet, Chip, Segmented, useNowTick } from "@/components/ui";
import {
  fmtClock,
  fmtDistance,
  fmtRelative,
  fmtTime,
  initialsOf,
} from "@/lib/format";
import { liveBoard, trailFor, type LiveStatus } from "@/lib/metrics";
import { useWorkforce } from "@/lib/store";
import { IArrowR, ICrosshair, IRoute } from "@/components/WfIcons";

export default function LiveMapPage() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-sm text-[var(--wf-muted)]">Loading…</div>}>
      <LiveInner />
    </Suspense>
  );
}

function LiveInner() {
  const { state } = useWorkforce();
  const params = useSearchParams();
  const now = useNowTick(5);
  const [projectId, setProjectId] = useState(
    () => params.get("project") ?? state.projects[0]?.id ?? "",
  );
  const [selectedId, setSelectedId] = useState<string | null>(params.get("track"));
  const [tracking, setTracking] = useState(!!params.get("track"));

  const project = state.projects.find((p) => p.id === projectId) ?? null;
  const board = useMemo(() => liveBoard(state, projectId, now), [state, projectId, now]);
  const working = board.filter((b) => b.state === "working" && b.lastPoint);
  const selected = board.find((b) => b.user.id === selectedId) ?? null;

  const trail = useMemo(
    () =>
      tracking && selected?.attendance
        ? trailFor(state, selected.attendance.id).map((p) => ({ lat: p.lat, lng: p.lng, at: p.at }))
        : [],
    [tracking, selected, state],
  );

  const markers: MapMarker[] = working.map((b) => ({
    id: b.user.id,
    coords: { lat: b.lastPoint!.lat, lng: b.lastPoint!.lng },
    kind: "worker" as const,
    hue: b.user.avatarHue,
    initials: initialsOf(b.user.name),
    label: `${b.user.name.split(" ")[0]} — ${b.place}`,
    pulse: true,
    selected: b.user.id === selectedId,
    dim: !!selectedId && b.user.id !== selectedId,
    onClick: () => {
      setSelectedId(b.user.id);
      setTracking(false);
    },
  }));

  const followPoint =
    tracking && selected?.lastPoint
      ? { lat: selected.lastPoint.lat, lng: selected.lastPoint.lng }
      : null;

  return (
    <div>
      <ScreenHeader
        back="/manager"
        title="Live Workforce Map"
        sub={`${working.length} employee${working.length === 1 ? "" : "s"} on site right now`}
      />
      <div className="flex flex-col gap-4 px-4">
        <Segmented
          ariaLabel="Project"
          value={projectId}
          onChange={(id) => {
            setProjectId(id);
            setSelectedId(null);
            setTracking(false);
          }}
          size="sm"
          options={state.projects.map((p) => ({
            value: p.id,
            label: p.name.split(" ").slice(0, 2).join(" "),
          }))}
        />

        <SiteMap
          project={project}
          markers={markers}
          trail={trail}
          trailColor="var(--wf-green)"
          follow={followPoint}
          heightClass="h-[420px] md:h-[500px]"
          mapStyle={state.settings.mapStyle}
        >
          {tracking && selected && (
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl bg-black/75 px-3 py-2 text-[0.74rem] font-bold text-white shadow-lg backdrop-blur">
              <span className="wf-pulse-dot" style={{ background: "var(--wf-green)", width: 8, height: 8 }} />
              Tracking {selected.user.name}
              <button
                className="ml-1 cursor-pointer rounded-md bg-white/15 px-2 py-0.5 text-[0.66rem] hover:bg-white/25"
                onClick={() => setTracking(false)}
              >
                Stop
              </button>
            </div>
          )}
        </SiteMap>

        {/* roster rail */}
        <div className="wf-scroll-x -mx-4 flex gap-2 px-4 pb-1">
          {working.map((b) => (
            <button
              key={b.user.id}
              onClick={() => {
                setSelectedId(b.user.id);
                setTracking(false);
              }}
              className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 transition ${
                b.user.id === selectedId
                  ? "border-[var(--wf-amber)] bg-[rgba(246,167,35,0.1)]"
                  : "border-[var(--wf-line)] bg-[var(--wf-surface)] hover:border-[var(--wf-line-strong)]"
              }`}
            >
              <Avatar name={b.user.name} hue={b.user.avatarHue} size={30} ring="green" />
              <span className="text-left">
                <span className="block text-[0.78rem] font-semibold leading-tight">
                  {b.user.name.split(" ")[0]}
                </span>
                <span className="block text-[0.62rem] text-[var(--wf-muted)]">{b.place}</span>
              </span>
            </button>
          ))}
          {working.length === 0 && (
            <p className="w-full py-4 text-center text-sm text-[var(--wf-muted)]">
              Nobody is checked in on this project right now.
            </p>
          )}
        </div>
      </div>

      {/* employee card */}
      <BottomSheet
        open={!!selected && !tracking}
        onClose={() => setSelectedId(null)}
        title={selected?.user.name}
      >
        {selected && <LiveCard status={selected} now={now} onTrack={() => setTracking(true)} />}
      </BottomSheet>
    </div>
  );
}

function LiveCard({
  status: b,
  now,
  onTrack,
}: {
  status: LiveStatus;
  now: number;
  onTrack: () => void;
}) {
  const { state } = useWorkforce();
  const todayUpdate = state.updates.find(
    (u) => u.employeeId === b.user.id && u.attendanceId === b.attendance?.id,
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar name={b.user.name} hue={b.user.avatarHue} size={52} ring="green" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.78rem] text-[var(--wf-muted)]">
            {b.user.designation} · {b.user.employeeCode}
          </p>
          <p className="flex items-center gap-1.5 text-[0.8rem] font-semibold text-[var(--wf-green)]">
            <span className="wf-pulse-dot" style={{ background: "var(--wf-green)", width: 7, height: 7 }} />
            Working · {b.place}
          </p>
        </div>
        <Chip tone="neutral">
          {b.lastPoint ? `updated ${fmtRelative(b.lastPoint.at, now)}` : "no fix"}
        </Chip>
      </div>
      <div className="grid grid-cols-3 gap-2.5 text-center">
        <div className="wf-card2 px-2 py-2.5">
          <div className="wf-display text-[1rem] font-bold tabular-nums">{b.attendance?.checkIn ? fmtTime(b.attendance.checkIn.at) : "—"}</div>
          <div className="text-[0.6rem] font-bold uppercase tracking-wider text-[var(--wf-faint)]">Check-in</div>
        </div>
        <div className="wf-card2 px-2 py-2.5">
          <div className="wf-display text-[1rem] font-bold tabular-nums text-[var(--wf-green)]">{fmtClock(b.workedMs).slice(0, 5)}</div>
          <div className="text-[0.6rem] font-bold uppercase tracking-wider text-[var(--wf-faint)]">Duration</div>
        </div>
        <div className="wf-card2 px-2 py-2.5">
          <div className="wf-display text-[1rem] font-bold tabular-nums text-[var(--wf-blue)]">{fmtDistance(b.attendance?.distanceMeters ?? 0)}</div>
          <div className="text-[0.6rem] font-bold uppercase tracking-wider text-[var(--wf-faint)]">Distance</div>
        </div>
      </div>
      {todayUpdate ? (
        <div className="wf-card2 p-3.5">
          <p className="mb-1 text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-violet)]">
            Today&apos;s work update · {fmtTime(todayUpdate.at)}
          </p>
          <p className="text-[0.82rem] leading-snug">{todayUpdate.description}</p>
        </div>
      ) : (
        <p className="text-center text-[0.76rem] text-[var(--wf-faint)]">No work update yet today.</p>
      )}
      <div className="flex gap-2.5">
        <button className="wf-btn wf-btn-primary flex-1" onClick={onTrack}>
          <ICrosshair size={16} /> Track employee
        </button>
        <Link
          href={`/manager/history?att=${b.attendance?.id ?? ""}`}
          className="wf-btn wf-btn-ghost flex-1"
        >
          <IRoute size={16} /> Route so far
        </Link>
      </div>
      <Link
        href={`/manager/employee?id=${b.user.id}`}
        className="flex items-center justify-center gap-1 text-[0.78rem] font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
      >
        Full profile <IArrowR size={13} />
      </Link>
    </div>
  );
}
