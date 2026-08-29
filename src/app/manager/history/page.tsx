"use client";

/**
 * Historical employee movement — pick project + employee + date (or arrive
 * via ?att= deep link) and replay the full shift: geofence, polyline,
 * playback, dwell timeline, selfies and updates.
 */

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RouteReview } from "@/components/RouteReview";
import { ScreenHeader } from "@/components/shell";
import { EmptyState, StatusChip } from "@/components/ui";
import { fmtDateLong } from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import { IRoute } from "@/components/WfIcons";

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-sm text-[var(--wf-muted)]">Loading…</div>}>
      <HistoryInner />
    </Suspense>
  );
}

function HistoryInner() {
  const { state } = useWorkforce();
  const params = useSearchParams();
  const deepAtt = params.get("att")
    ? state.attendance.find((a) => a.id === params.get("att")) ?? null
    : null;

  const [projectId, setProjectId] = useState(
    () => deepAtt?.projectId ?? state.projects[0]?.id ?? "",
  );
  const [employeeId, setEmployeeId] = useState(() => deepAtt?.employeeId ?? "");
  const [date, setDate] = useState(() => deepAtt?.date ?? "");

  const employees = useMemo(
    () =>
      state.users.filter(
        (u) => u.role === "employee" && u.projectIds.includes(projectId),
      ),
    [state.users, projectId],
  );

  const candidates = useMemo(
    () =>
      state.attendance
        .filter(
          (a) =>
            a.projectId === projectId &&
            a.checkIn &&
            (!employeeId || a.employeeId === employeeId),
        )
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [state.attendance, projectId, employeeId],
  );

  const dates = useMemo(() => [...new Set(candidates.map((a) => a.date))], [candidates]);

  const selected = useMemo(() => {
    if (deepAtt && !employeeId && !date) return deepAtt;
    return (
      candidates.find((a) => (!date || a.date === date)) ?? null
    );
  }, [deepAtt, candidates, date, employeeId]);

  const project = state.projects.find((p) => p.id === (selected?.projectId ?? projectId));
  const user = state.users.find((u) => u.id === (selected?.employeeId ?? employeeId));

  return (
    <div>
      <ScreenHeader
        back
        title="Movement History"
        sub="Where did an employee go between check-in and checkout?"
      />
      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Project"
            className="wf-input w-auto min-w-40 flex-1"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setEmployeeId("");
              setDate("");
            }}
          >
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            aria-label="Employee"
            className="wf-input w-auto min-w-40 flex-1"
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setDate("");
            }}
          >
            <option value="">Any employee</option>
            {employees.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select
            aria-label="Date"
            className="wf-input w-auto min-w-36 flex-1"
            value={date || selected?.date || ""}
            onChange={(e) => setDate(e.target.value)}
          >
            {dates.map((d) => (
              <option key={d} value={d}>{fmtDateLong(d)}</option>
            ))}
          </select>
        </div>

        {selected && project && user ? (
          <>
            <div className="wf-card flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <h2 className="wf-display font-bold">
                  {user.name} — {fmtDateLong(selected.date)}
                </h2>
                <p className="text-[0.74rem] text-[var(--wf-muted)]">
                  {project.name} · {user.designation}
                </p>
              </div>
              <StatusChip status={selected.status} />
            </div>
            <RouteReview attendance={selected} project={project} user={user} />
          </>
        ) : (
          <EmptyState
            icon={<IRoute size={30} />}
            title="No matching shift"
            body="Pick a project, employee and date with a recorded check-in to replay the route."
          />
        )}
      </div>
    </div>
  );
}
