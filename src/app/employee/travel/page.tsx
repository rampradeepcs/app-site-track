"use client";

/**
 * Employee travel history — every work run this person has made, what it
 * measured, what it earned, and where it stands. Selecting a trip opens the
 * route on the map with its start and end anchors (spec §14).
 *
 * Amounts here are the engine's, recomputed on render; the employee never
 * calculates a kilometre or a rupee themselves (spec §30).
 */

import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { BottomSheet, Chip, EmptyState } from "@/components/ui";
import { SiteMap, type MapMarker } from "@/components/SiteMap";
import {
  dayAllowances,
  fmtKmLabel,
  fmtMinute,
  runTrack,
  travelAllowancesForDay,
  type FoodAllowance,
  type TravelAllowance,
} from "@/lib/allowances";
import { fmtDateLong, fmtDuration, fmtTime } from "@/lib/format";
import { fmtINR } from "@/lib/payroll";
import { useWorkforce } from "@/lib/store";
import type { TravelSession } from "@/lib/types";
import { ICoffee, INav } from "@/components/WfIcons";

const STATUS_TONE: Record<TravelSession["status"], "blue" | "amber" | "green" | "red"> = {
  active: "blue",
  pending: "amber",
  approved: "green",
  rejected: "red",
};

const FOOD_TONE: Record<FoodAllowance["status"], "amber" | "green" | "red"> = {
  auto: "green",
  approved: "green",
  pending: "amber",
  rejected: "red",
  "not-eligible": "red",
};

export default function EmployeeTravel() {
  const { state, currentUser } = useWorkforce();
  const [selected, setSelected] = useState<TravelAllowance | null>(null);

  const byDay = useMemo(() => {
    if (!currentUser) return [];
    // Food allowances live here too — this is the one place a worker can
    // see what their day earned beyond the wage, and whether it is settled.
    const food = new Map<string, FoodAllowance[]>();
    for (const att of state.attendance) {
      if (att.employeeId !== currentUser.id || !att.checkIn) continue;
      const earned = dayAllowances(state, att).food.filter((f) => f.eligible);
      if (earned.length) food.set(att.date, [...(food.get(att.date) ?? []), ...earned]);
    }
    const dates = [
      ...new Set([
        ...state.travelSessions
          .filter((t) => t.employeeId === currentUser.id)
          .map((t) => t.date),
        ...food.keys(),
      ]),
    ].sort((a, b) => (a < b ? 1 : -1));
    return dates.map((date) => ({
      date,
      // Rejected runs stay listed with their reason; a decision never makes
      // a trip disappear from the person it was about.
      trips: travelAllowancesForDay(state, currentUser.id, date, { includeRejected: true }),
      food: food.get(date) ?? [],
    }));
  }, [state, currentUser]);

  if (!currentUser) return null;

  return (
    <div>
      <ScreenHeader
        title="Travel"
        sub="Your work runs, meal allowances and what they earned"
        back="/employee/more"
      />
      <div className="flex flex-col gap-4 px-4">
        {byDay.length === 0 ? (
          <EmptyState
            icon={<INav size={26} />}
            title="No work travel yet"
            body="When your manager enables travel on a project, Start Travel appears on your shift screen — the route and allowance are worked out for you."
          />
        ) : (
          byDay.map(({ date, trips, food }) => {
            const counted = trips.filter((t) => t.session.status !== "rejected");
            const earned =
              trips.filter((t) => t.payable).reduce((t, a) => t + a.amount, 0) +
              food.filter((f) => f.payable).reduce((t, f) => t + f.amount, 0);
            return (
            <div key={date} className="wf-card overflow-hidden">
              <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
                <h2 className="wf-display text-[0.95rem]">
                  {fmtDateLong(date)}
                </h2>
                <p className="text-[0.74rem] tabular-nums text-[var(--wf-muted)]">
                  {counted.length ? fmtKmLabel(counted.reduce((t, a) => t + a.meters, 0)) : ""}
                  {earned > 0 ? (
                    <span className="ml-2 font-semibold text-[var(--wf-green)]">
                      {fmtINR(earned)}
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="wf-list">
                {trips.map((trip) => (
                  <button
                    key={trip.session.id}
                    className="wf-row w-full cursor-pointer text-left hover:bg-[var(--wf-fill-3)]"
                    onClick={() => setSelected(trip)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.88rem] font-semibold">
                        {trip.session.purpose}
                      </span>
                      <span className="block truncate text-[0.72rem] tabular-nums text-[var(--wf-muted)]">
                        {fmtTime(trip.session.start.at)}
                        {trip.session.end ? ` → ${fmtTime(trip.session.end.at)}` : " → …"}
                        {" · "}
                        {fmtKmLabel(trip.meters)}
                        {trip.amount > 0
                          ? trip.payable
                            ? ` · ${fmtINR(trip.amount)}`
                            : trip.session.status === "pending"
                              ? ` · ≈ ${fmtINR(trip.amount)} if approved`
                              : ""
                          : ""}
                      </span>
                    </span>
                    <Chip tone={STATUS_TONE[trip.session.status]}>
                      {trip.session.status}
                    </Chip>
                  </button>
                ))}
                {food.map((f) => (
                  <div key={f.rule.id} className="wf-row">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                      <ICoffee size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.88rem] font-semibold">
                        {f.rule.meal} allowance
                      </span>
                      <span className="block truncate text-[0.72rem] tabular-nums text-[var(--wf-muted)]">
                        Check-in {fmtMinute(f.rule.startMinute)} – {fmtMinute(f.rule.endMinute)}
                        {" · "}
                        {fmtINR(f.amount)}
                      </span>
                    </span>
                    <Chip tone={FOOD_TONE[f.status]}>
                      {f.status === "auto" ? "approved" : f.status}
                    </Chip>
                  </div>
                ))}
              </div>
            </div>
            );
          })
        )}
      </div>

      <BottomSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.session.purpose} — ${fmtDateLong(selected.session.date)}` : ""}
        tall
      >
        {selected ? <TripDetail trip={selected} /> : null}
      </BottomSheet>
    </div>
  );
}

/** The route with its anchors, and the allowance maths — shared shape with
    the manager's review so both sides argue from the same picture. */
export function TripDetail({
  trip,
  children,
}: {
  trip: TravelAllowance;
  children?: React.ReactNode;
}) {
  const { state } = useWorkforce();
  const s = trip.session;
  // The drawn route starts at the start anchor, the same as the measured one.
  const points = useMemo(() => runTrack(state, s).points, [state, s]);
  const project = state.projects.find((p) => p.id === s.projectId);
  const measured =
    s.status === "active" ? runTrack(state, s).meters : s.distanceMeters;
  const adjusted = s.approvedMeters != null && Math.abs(s.approvedMeters - measured) >= 50;

  const markers: MapMarker[] = [
    {
      id: "start",
      coords: s.start.coords,
      kind: "start",
      color: "var(--wf-green)",
      label: `${s.start.name} · ${fmtTime(s.start.at)}`,
    },
  ];
  if (s.end) {
    markers.push({
      id: "end",
      coords: s.end.coords,
      kind: "end",
      color: "var(--wf-red)",
      label: `${s.end.name} · ${fmtTime(s.end.at)}`,
    });
  }

  const durationMin = s.end ? (s.end.at - s.start.at) / 60000 : null;

  const facts: Array<[string, string]> = [
    ["Route", `${s.start.name} → ${s.end?.name ?? "…"}`],
    [
      "Time",
      `${fmtTime(s.start.at)}${s.end ? ` – ${fmtTime(s.end.at)}` : " – running"}${
        durationMin != null ? ` (${fmtDuration(durationMin)})` : ""
      }`,
    ],
    // What the phone measured stays on the record; a manager's settled
    // figure sits under it, never over it.
    ["Distance travelled", fmtKmLabel(measured)],
    ...(adjusted
      ? ([["Approved distance", fmtKmLabel(s.approvedMeters!)]] as Array<[string, string]>)
      : []),
    ...(s.status === "rejected"
      ? []
      : ([["Eligible distance", fmtKmLabel(trip.eligibleMeters)]] as Array<[string, string]>)),
    [
      "Allowance",
      s.status === "rejected"
        ? "Not approved"
        : trip.rule
          ? trip.payable
            ? fmtINR(trip.amount)
            : s.status === "pending"
              ? `≈ ${fmtINR(trip.amount)} · pending approval`
              : s.status === "active"
                ? `≈ ${fmtINR(trip.amount)} so far`
                : "—"
          : "—",
    ],
    // A rejection's reason is already the line under the facts.
    ...(s.decisionNote && s.status !== "rejected"
      ? ([["Manager's note", s.decisionNote]] as Array<[string, string]>)
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <SiteMap
        project={project ?? undefined}
        trail={points.map((pt) => ({
          lat: pt.lat,
          lng: pt.lng,
          at: pt.at,
          segmentStart: pt.segmentStart,
        }))}
        markers={markers}
        // The whole run and both ends, so neither anchor is ever off-screen.
        fit={[
          s.start.coords,
          ...points.map((pt) => ({ lat: pt.lat, lng: pt.lng })),
          ...(s.end ? [s.end.coords] : []),
        ]}
        heightClass="h-[260px]"
      />

      <div className="wf-card2 divide-y divide-[var(--wf-line)]">
        {facts.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="shrink-0 text-[0.8rem] text-[var(--wf-muted)]">{label}</span>
            <span className="min-w-0 truncate text-right text-[0.86rem] font-semibold tabular-nums">
              {value}
            </span>
          </div>
        ))}
      </div>

      <p className="wf-inset px-3.5 py-2.5 text-[0.76rem] leading-snug text-[var(--wf-muted)]">
        {trip.why}
        {s.note ? ` · “${s.note}”` : ""}
      </p>

      {s.flags.length > 0 ? (
        <div className="wf-inset px-3.5 py-2.5">
          <p className="mb-1 text-[0.7rem] font-bold uppercase tracking-wider text-[var(--wf-amber)]">
            GPS notes
          </p>
          {s.flags.map((f, i) => (
            <p key={i} className="text-[0.74rem] leading-snug text-[var(--wf-muted)]">
              {fmtTime(f.at)} — {f.detail}
            </p>
          ))}
        </div>
      ) : null}

      {children}
    </div>
  );
}
