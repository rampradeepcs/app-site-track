"use client";

/**
 * Team & roles — the product owner's user administration surface:
 * everyone in the org with their role, live status and performance,
 * promote/demote between employee and manager, activate/deactivate,
 * and add people.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmployeeEditor } from "@/components/EmployeeEditor";
import { ScreenHeader } from "@/components/shell";
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
import type { Role, User } from "@/lib/types";
import { IArrowR, IPlus, ISearch, IShield } from "@/components/WfIcons";

export default function AdminTeam() {
  const { state, saveEmployee, setUserRole } = useWorkforce();
  const now = useNowTick(15);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [editing, setEditing] = useState<User | null | "new">(null);

  const board = useMemo(() => liveBoard(state, undefined, now), [state, now]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.users
      .filter((u) => roleFilter === "all" || u.role === roleFilter)
      .filter(
        (u) =>
          !q ||
          `${u.name} ${u.employeeCode} ${u.designation} ${u.department}`
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => {
        const rank = (r: Role) => (r === "admin" ? 0 : r === "manager" ? 1 : 2);
        return rank(a.role) - rank(b.role) || a.name.localeCompare(b.name);
      });
  }, [state.users, query, roleFilter]);

  return (
    <div>
      <ScreenHeader
        back="/admin"
        title="Team & Roles"
        sub={`${state.users.length} people across the organisation`}
        action={
          <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={() => setEditing("new")}>
            <IPlus size={15} /> Add
          </button>
        }
      />
      <div className="flex flex-col gap-3.5 px-4">
        <div className="relative">
          <ISearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]" />
          <input
            className="wf-input wf-input-search"
            placeholder="Search name, code, trade…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Segmented<Role | "all">
          ariaLabel="Role filter"
          value={roleFilter}
          onChange={setRoleFilter}
          size="sm"
          options={[
            { value: "all", label: `All (${state.users.length})` },
            { value: "employee", label: "Employees" },
            { value: "manager", label: "Managers" },
            { value: "admin", label: "Admins" },
          ]}
        />

        <div className="flex flex-col gap-2">
          {rows.map((u) => {
            const live = board.find((b) => b.user.id === u.id);
            const perf =
              u.role === "employee" ? performanceFor(state, u, 14, now) : null;
            const isOwner = u.id === "usr_owner";
            return (
              <div key={u.id} className="wf-card2 flex flex-wrap items-center gap-3 px-3.5 py-3">
                <Avatar
                  name={u.name}
                  hue={u.avatarHue}
                  size={42}
                  ring={live?.state === "working" ? "green" : "none"}
                />
                <Link
                  href={u.role === "employee" ? `/manager/employee?id=${u.id}` : "#"}
                  className={`min-w-0 flex-1 ${u.role === "employee" ? "" : "pointer-events-none"}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{u.name}</span>
                    <Chip
                      tone={u.role === "admin" ? "violet" : u.role === "manager" ? "amber" : "blue"}
                    >
                      {u.role === "admin" ? (
                        <>
                          <IShield size={10} /> Admin
                        </>
                      ) : (
                        u.role
                      )}
                    </Chip>
                    {u.status !== "active" && <StatusChip status="not-in" label={u.status} />}
                  </span>
                  <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                    {u.designation} · {u.department} · {u.employeeCode}
                    {perf ? ` · ${pct(perf.attendancePct)} att · score ${Math.round(perf.overall)}` : ""}
                    {live?.state === "working" ? ` · on site ${fmtClock(live.workedMs).slice(0, 5)}` : ""}
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!isOwner && u.role !== "admin" && (
                    <button
                      className="wf-btn wf-btn-ghost wf-btn-sm"
                      onClick={() =>
                        setUserRole(u.id, u.role === "manager" ? "employee" : "manager")
                      }
                    >
                      {u.role === "manager" ? "Demote to employee" : "Promote to manager"}
                    </button>
                  )}
                  {isOwner ? (
                    <Chip tone="neutral">Owner</Chip>
                  ) : (
                    <button
                      className="wf-btn wf-btn-quiet wf-btn-sm"
                      onClick={() =>
                        saveEmployee(
                          { name: u.name, status: u.status === "active" ? "inactive" : "active" },
                          u.id,
                        )
                      }
                    >
                      {u.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                  )}
                  {u.role === "employee" && (
                    <button
                      className="wf-btn wf-btn-quiet wf-btn-sm"
                      onClick={() => setEditing(u)}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[0.68rem] text-[var(--wf-faint)]">
          Role changes are audit-logged — see{" "}
          <Link href="/admin/governance" className="inline-flex items-center gap-0.5 font-semibold text-[var(--wf-violet)]">
            Governance <IArrowR size={11} />
          </Link>
        </p>
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
