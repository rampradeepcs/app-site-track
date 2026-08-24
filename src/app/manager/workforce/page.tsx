"use client";

/**
 * Workforce directory — search/filter, live status per employee,
 * add/edit employees and quick project assignment.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { EmployeeEditor } from "@/components/EmployeeEditor";
import { UpgradeNotice, useLimitGuard } from "@/components/FeatureGate";
import {
  Avatar,
  Chip,
  Segmented,
  StatusChip,
  useNowTick,
} from "@/components/ui";
import { fmtClock, pct } from "@/lib/format";
import { liveBoard, performanceFor } from "@/lib/metrics";
import { useWorkforce } from "@/lib/store";
import type { User } from "@/lib/types";
import { IArrowR, IPlus, ISearch } from "@/components/WfIcons";

export default function WorkforcePage() {
  const { state, saveEmployee } = useWorkforce();
  const now = useNowTick(15);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "working" | "out" | "absent">("all");
  const [editing, setEditing] = useState<User | null | "new">(null);

  const board = useMemo(() => liveBoard(state, undefined, now), [state, now]);
  const seats = useLimitGuard("employees");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return board.filter((b) => {
      if (q && !`${b.user.name} ${b.user.employeeCode} ${b.user.designation} ${b.user.department}`.toLowerCase().includes(q))
        return false;
      if (filter === "working") return b.state === "working";
      if (filter === "out") return b.state === "checked-out";
      if (filter === "absent") return b.state === "absent" || b.state === "not-in";
      return true;
    });
  }, [board, query, filter]);

  return (
    <div>
      <ScreenHeader
        title="Workforce"
        sub={`${board.length} active employees`}
        action={
          <button
            className="wf-btn wf-btn-primary wf-btn-sm"
            disabled={seats.blocked}
            title={seats.blocked ? seats.message : undefined}
            onClick={() => setEditing("new")}
          >
            <IPlus size={15} /> Add
          </button>
        }
      />
      <div className="flex flex-col gap-3.5 px-4">
        {seats.reached && (
          <UpgradeNotice
            title={seats.message}
            body={
              seats.blocked
                ? "New employees can't be added until the limit is raised. Ask your administrator to upgrade the subscription."
                : "You're over the included allowance — additional seats are billed as overage on the next invoice."
            }
            compact
          />
        )}
        <div className="relative">
          <ISearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]" />
          <input
            className="wf-input wf-input-search"
            placeholder="Search name, code, trade…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Segmented
          ariaLabel="Status filter"
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: "all", label: `All (${board.length})` },
            { value: "working", label: `Working (${board.filter((b) => b.state === "working").length})` },
            { value: "out", label: "Checked out" },
            { value: "absent", label: "Not in" },
          ]}
        />
        <div className="flex flex-col gap-2">
          {rows.length === 0 && (
            <p className="wf-card2 px-4 py-8 text-center text-sm text-[var(--wf-muted)]">
              No employees match.
            </p>
          )}
          {rows.map((b) => {
            const perf = performanceFor(state, b.user, 14, now);
            return (
              <Link
                key={b.user.id}
                href={`/manager/employee?id=${b.user.id}`}
                className="wf-card2 flex items-center gap-3 px-3.5 py-3 transition hover:border-[var(--wf-line-strong)]"
              >
                <Avatar
                  name={b.user.name}
                  hue={b.user.avatarHue}
                  size={42}
                  ring={b.state === "working" ? "green" : "none"}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{b.user.name}</span>
                    <span className="text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                      {b.user.employeeCode}
                    </span>
                  </span>
                  <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                    {b.user.designation} · {b.user.department}
                    {b.project ? ` · ${b.project.name.split(" ")[0]}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {b.state === "working" ? (
                    <Chip tone="green">{fmtClock(b.workedMs).slice(0, 5)} · {b.place}</Chip>
                  ) : (
                    <StatusChip status={b.attendance ? b.attendance.status : "not-in"} />
                  )}
                  <span className="text-[0.64rem] tabular-nums text-[var(--wf-faint)]">
                    {pct(perf.attendancePct)} att · score {Math.round(perf.overall)}
                  </span>
                </span>
                <IArrowR size={15} className="shrink-0 text-[var(--wf-faint)]" />
              </Link>
            );
          })}
        </div>
      </div>

      <EmployeeEditor
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={(patch, id) => {
          saveEmployee(patch, id);
          setEditing(null);
        }}
      />
    </div>
  );
}
