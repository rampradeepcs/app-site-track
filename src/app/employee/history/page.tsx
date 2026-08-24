"use client";

/**
 * Route history — pick any worked day and replay the movement:
 * geofence + polyline + playback + timeline (RouteReview).
 */

import { useMemo, useState } from "react";
import { RouteReview } from "@/components/RouteReview";
import { ScreenHeader } from "@/components/shell";
import { EmptyState, StatusChip } from "@/components/ui";
import { fmtDateLong, fmtDateShort, fmtWeekday } from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import { IRoute } from "@/components/WfIcons";

export default function EmployeeHistory() {
  const { state, currentUser } = useWorkforce();

  const days = useMemo(
    () =>
      state.attendance
        .filter((a) => a.employeeId === currentUser?.id && a.checkIn)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [state.attendance, currentUser],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = days.find((d) => d.id === selectedId) ?? days[0] ?? null;
  const project = selected
    ? state.projects.find((p) => p.id === selected.projectId)
    : null;

  return (
    <div>
      <ScreenHeader title="Route History" sub="Where you went during each shift" />
      <div className="flex flex-col gap-4 px-4">
        {days.length === 0 ? (
          <EmptyState
            icon={<IRoute size={30} />}
            title="No routes yet"
            body="Once you check in and work a shift, your movement route appears here."
          />
        ) : (
          <>
            {/* day picker rail */}
            <div className="wf-scroll-x -mx-4 flex gap-2 px-4 pb-1">
              {days.map((d) => {
                const active = d.id === selected?.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`flex shrink-0 cursor-pointer flex-col items-center rounded-xl border px-3.5 py-2 transition ${
                      active
                        ? "border-[var(--wf-amber)] bg-[rgba(246,167,35,0.12)]"
                        : "border-[var(--wf-line)] bg-[var(--wf-surface)] hover:border-[var(--wf-line-strong)]"
                    }`}
                  >
                    <span className={`text-[0.62rem] font-bold uppercase ${active ? "text-[var(--wf-amber)]" : "text-[var(--wf-faint)]"}`}>
                      {fmtWeekday(d.date)}
                    </span>
                    <span className="text-[0.82rem] font-bold">{fmtDateShort(d.date)}</span>
                  </button>
                );
              })}
            </div>

            {selected && project && currentUser && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="wf-display font-bold">{fmtDateLong(selected.date)}</h2>
                    <p className="text-[0.76rem] text-[var(--wf-muted)]">{project.name}</p>
                  </div>
                  <StatusChip status={selected.status} />
                </div>
                <RouteReview
                  attendance={selected}
                  project={project}
                  user={currentUser}
                  compact
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
