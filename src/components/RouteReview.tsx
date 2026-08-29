"use client";

/**
 * RouteReview — historical movement viewer shared by the manager's history
 * screen and the employee's attendance details: geofence + full polyline,
 * route playback with scrubber/speed, and a tappable location timeline.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FeatureGate } from "./FeatureGate";
import type { MapMarker } from "./SiteMap";
import { SiteMap } from "./SiteMap";
import {
  buildTimeline,
  trailFor,
  type TimelineEntry,
} from "@/lib/metrics";
import { useWorkforce } from "@/lib/store";
import { dayMetrics, shiftFor } from "@/lib/payroll";
import { VoiceNotePlayer } from "./VoiceRecorder";
import {
  fmtDistance,
  fmtDuration,
  fmtTime,
  initialsOf,
} from "@/lib/format";
import type { Attendance, LatLng, Project, User } from "@/lib/types";
import { downloadCSV, movementCSV } from "@/lib/reports";
import {
  ICheckCircle,
  IClipboard,
  ICoffee,
  IDownload,
  IMapPin,
  IPause,
  IPlay,
  IRoute,
  IAlert,
} from "./WfIcons";

const SPEEDS = [1, 4, 16, 64] as const;

export function RouteReview({
  attendance,
  project,
  user,
  compact,
}: {
  attendance: Attendance;
  project: Project;
  user: User;
  compact?: boolean;
}) {
  const { state } = useWorkforce();
  const trail = useMemo(
    () => trailFor(state, attendance.id),
    [state, attendance.id],
  );
  const timeline = useMemo(
    () => buildTimeline(attendance, trail, project, state.updates),
    [attendance, trail, project, state.updates],
  );

  /* The day measured against its shift: shift duration vs break vs net
     working time are deliberately three numbers, never one (spec §3, §26). */
  const metrics = useMemo(() => {
    const def =
      state.shifts.find((x) => x.id === attendance.shiftId) ??
      shiftFor(state, attendance.employeeId, attendance.date);
    return def && attendance.checkIn ? dayMetrics(attendance, def) : null;
  }, [state, attendance]);

  const start = attendance.checkIn?.at ?? trail[0]?.at ?? 0;
  const end =
    attendance.checkOut?.at ?? trail[trail.length - 1]?.at ?? start + 1;
  const span = Math.max(1, end - start);

  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(2);
  const [cursor, setCursor] = useState(end);
  const [highlight, setHighlight] = useState<LatLng | null>(null);
  const raf = useRef<number | null>(null);
  const lastTick = useRef(0);

  /* playback loop */
  useEffect(() => {
    if (!playing) return;
    const step = (t: number) => {
      const dt = lastTick.current ? t - lastTick.current : 0;
      lastTick.current = t;
      setCursor((c) => {
        const next = c + dt * SPEEDS[speedIdx] * 60; // 1s wall = 1min route at 1×… scaled
        if (next >= end) {
          setPlaying(false);
          return end;
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      lastTick.current = 0;
    };
  }, [playing, speedIdx, end]);

  const playheadPoint = useMemo(() => {
    if (!trail.length) return null;
    let best = trail[0];
    for (const p of trail) {
      if (p.at <= cursor) best = p;
      else break;
    }
    return best;
  }, [trail, cursor]);

  const distanceSoFar = useMemo(() => {
    // Approximate: fraction of points passed → fraction of distance.
    if (!trail.length) return 0;
    const passed = trail.filter((p) => p.at <= cursor).length;
    return (attendance.distanceMeters * passed) / trail.length;
  }, [trail, cursor, attendance.distanceMeters]);

  const markers = useMemo(() => {
    const list: MapMarker[] = [];
    if (attendance.checkIn) {
      list.push({
        id: "in",
        coords: attendance.checkIn.coords,
        kind: "point",
        color: "var(--wf-green)",
        label: `In ${fmtTime(attendance.checkIn.at)}`,
      });
    }
    if (attendance.checkOut) {
      list.push({
        id: "out",
        coords: attendance.checkOut.coords,
        kind: "point",
        color: "var(--wf-red)",
        label: `Out ${fmtTime(attendance.checkOut.at)}`,
      });
    }
    if (playheadPoint && cursor < end) {
      list.push({
        id: "head",
        coords: { lat: playheadPoint.lat, lng: playheadPoint.lng },
        kind: "worker",
        hue: user.avatarHue,
        initials: initialsOf(user.name),
        label: fmtTime(playheadPoint.at),
        pulse: true,
      });
    }
    return list;
  }, [attendance, playheadPoint, cursor, end, user]);

  const pctDone = ((cursor - start) / span) * 100;

  return (
    <div className="flex flex-col gap-4">
      <SiteMap
        project={project}
        trail={trail}
        trailUpto={cursor}
        markers={markers}
        highlight={highlight}
        heightClass={compact ? "h-64" : "h-[340px] md:h-[420px]"}
      />

      {/* playback deck — a paid capability on most plans */}
      <FeatureGate feature="routePlayback" compact>
      {trail.length > 1 ? (
        <div className="wf-card2 p-3.5">
          <div className="flex items-center gap-3">
            <button
              aria-label={playing ? "Pause route playback" : "Play route"}
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--wf-on-amber)] shadow-lg transition active:scale-95"
              style={{ background: "linear-gradient(180deg, var(--wf-amber-hi), var(--wf-amber))" }}
              onClick={() => {
                if (cursor >= end) setCursor(start);
                setPlaying((p) => !p);
              }}
            >
              {playing ? <IPause size={18} /> : <IPlay size={18} />}
            </button>
            <div className="min-w-0 flex-1">
              <input
                type="range"
                aria-label="Route playback position"
                min={start}
                max={end}
                step={1000}
                value={cursor}
                onChange={(e) => {
                  setPlaying(false);
                  setCursor(Number(e.target.value));
                }}
                className="wf-range w-full accent-[var(--wf-amber)]"
                style={{ height: 26 }}
              />
              <div className="flex justify-between text-[0.66rem] font-semibold tabular-nums text-[var(--wf-muted)]">
                <span>{fmtTime(start)}</span>
                <span className="text-[var(--wf-amber)]">
                  {fmtTime(cursor)} · {fmtDistance(distanceSoFar)}
                </span>
                <span>{fmtTime(end)}</span>
              </div>
            </div>
            <button
              aria-label="Change playback speed"
              onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
              className="wf-btn wf-btn-ghost wf-btn-sm shrink-0 tabular-nums"
            >
              {SPEEDS[speedIdx]}×
            </button>
          </div>
          <div
            className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--wf-surface3)]"
            aria-hidden="true"
          >
            <div
              className="h-full bg-[var(--wf-amber)]"
              style={{ width: `${Math.min(100, Math.max(0, pctDone))}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="text-center text-sm text-[var(--wf-muted)]">
          No movement points recorded for this day.
        </p>
      )}
      </FeatureGate>

      {/* stats strip — shift duration, break and net working are distinct */}
      <div className="grid grid-cols-3 gap-2.5">
        <MiniStat
          label="Total shift"
          value={metrics ? fmtDuration(metrics.grossMinutes) : "—"}
        />
        <MiniStat
          label="Total break"
          value={metrics ? fmtDuration(metrics.breaks.totalMinutes) : "—"}
        />
        <MiniStat
          label="Net working"
          value={
            metrics
              ? fmtDuration(metrics.netMinutes)
              : attendance.workedMinutes != null
                ? fmtDuration(attendance.workedMinutes)
                : "—"
          }
        />
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <MiniStat
          label="Overtime"
          value={
            metrics && metrics.overtimeMinutes > 0.5
              ? fmtDuration(metrics.overtimeMinutes)
              : "—"
          }
        />
        <MiniStat label="Distance" value={fmtDistance(attendance.distanceMeters)} />
        <MiniStat label="GPS points" value={String(trail.length)} />
      </div>

      {/* checkout voice note — streamed in place, never downloaded */}
      {attendance.voiceNote ? (
        <VoiceNotePlayer
          dataUrl={attendance.voiceNote.dataUrl}
          seconds={attendance.voiceNote.seconds}
          meta={`${user.name} · ${project.name} · recorded ${fmtTime(attendance.voiceNote.at)}`}
          transcript={attendance.voiceNote.transcript}
          transcriptLang={attendance.voiceNote.transcriptLang}
        />
      ) : null}

      {/* selfies */}
      <div className="grid grid-cols-2 gap-2.5">
        <SelfieCard
          title="Check-in"
          mark={attendance.checkIn}
          tone="var(--wf-green)"
        />
        <SelfieCard
          title="Checkout"
          mark={attendance.checkOut}
          tone="var(--wf-red)"
        />
      </div>

      {/* timeline */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="wf-display text-sm">Location timeline</h3>
          {trail.length > 0 && (
            <button
              className="wf-btn wf-btn-quiet wf-btn-sm"
              onClick={() =>
                downloadCSV(
                  `route-${user.employeeCode}-${attendance.date}.csv`,
                  movementCSV(state, attendance.id),
                  `Movement history — ${user.name}, ${attendance.date}`,
                )
              }
            >
              <IDownload size={15} /> CSV
            </button>
          )}
        </div>
        <Timeline
          entries={timeline}
          onSelect={(e) => {
            if (e.coords) {
              setHighlight(e.coords);
              setPlaying(false);
              setCursor(e.at);
            }
          }}
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="wf-card2 px-3 py-2.5 text-center">
      <div className="wf-display text-[1.05rem] tabular-nums">{value}</div>
      <div className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-[var(--wf-faint)]">
        {label}
      </div>
    </div>
  );
}

function SelfieCard({
  title,
  mark,
  tone,
}: {
  title: string;
  mark: Attendance["checkIn"];
  tone: string;
}) {
  return (
    <div className="wf-card2 overflow-hidden">
      {mark ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mark.selfie}
            alt={`${title} selfie`}
            className="aspect-[4/3] w-full object-cover"
          />
          <div className="px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[0.68rem] font-bold uppercase tracking-wider" style={{ color: tone }}>
                {title}
              </span>
              <span className="text-[0.72rem] font-semibold tabular-nums">{fmtTime(mark.at)}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[0.68rem] text-[var(--wf-muted)]">
              <IMapPin size={11} /> {mark.place} · ±{Math.round(mark.accuracy)}m
            </div>
          </div>
        </>
      ) : (
        <div className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 p-3 text-center">
          <IAlert size={20} className="text-[var(--wf-faint)]" />
          <span className="text-xs font-semibold text-[var(--wf-muted)]">
            No {title.toLowerCase()} recorded
          </span>
        </div>
      )}
    </div>
  );
}

export function Timeline({
  entries,
  onSelect,
}: {
  entries: TimelineEntry[];
  onSelect?: (e: TimelineEntry) => void;
}) {
  if (!entries.length) {
    return (
      <p className="text-sm text-[var(--wf-muted)]">No timeline events.</p>
    );
  }
  return (
    <ol className="relative ml-2 flex flex-col border-l-2 border-dashed border-[var(--wf-line-strong)]">
      {entries.map((e, i) => {
        const tone =
          e.kind === "check-in"
            ? "var(--wf-green)"
            : e.kind === "check-out"
              ? "var(--wf-red)"
              : e.kind === "event" || e.kind === "break"
                ? "var(--wf-amber)"
                : e.kind === "update"
                  ? "var(--wf-violet)"
                  : "var(--wf-blue)";
        const icon =
          e.kind === "check-in" || e.kind === "check-out" ? (
            <ICheckCircle size={13} />
          ) : e.kind === "update" ? (
            <IClipboard size={13} />
          ) : e.kind === "event" ? (
            <IAlert size={13} />
          ) : e.kind === "break" ? (
            <ICoffee size={13} />
          ) : (
            <IRoute size={13} />
          );
        return (
          <li key={i} className="relative pb-4 pl-5 last:pb-1">
            <span
              className="absolute -left-[11px] top-0 grid h-5 w-5 place-items-center rounded-full border-2 border-[var(--wf-bg)]"
              style={{ background: tone, color: "var(--wf-on-accent)" }}
            >
              {icon}
            </span>
            <button
              onClick={() => onSelect?.(e)}
              disabled={!e.coords || !onSelect}
              className={`-mt-0.5 block w-full rounded-lg px-2 py-1 text-left transition ${
                e.coords && onSelect
                  ? "cursor-pointer hover:bg-[var(--wf-surface2)]"
                  : ""
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[0.72rem] font-bold tabular-nums" style={{ color: tone }}>
                  {fmtTime(e.at)}
                </span>
                {e.end ? (
                  <span className="text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                    → {fmtTime(e.end)}
                  </span>
                ) : null}
              </div>
              <div className="text-[0.84rem] font-semibold leading-snug">{e.label}</div>
              {e.detail ? (
                <div className="text-[0.74rem] leading-snug text-[var(--wf-muted)]">{e.detail}</div>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
