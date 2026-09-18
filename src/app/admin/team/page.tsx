"use client";

/**
 * Team & roles — the product owner's user administration surface:
 * everyone in the org with their role, live status and performance,
 * promote/demote between employee and manager, activate/deactivate,
 * and add people.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RemoveMemberDialog } from "@/components/RemoveMemberDialog";
import { useMyCompanies } from "@/lib/companies";
import { MemberStatusChip } from "@/components/MemberStatus";
import {
  cancelInvitationRemote,
  fetchCompanyMembers,
  fetchPendingInvitations,
  type MemberState,
  type PendingInvitation,
} from "@/lib/supabase/repository";
import { describeError } from "@/lib/errors";
import { showToast } from "@/lib/toast";
import { ScreenHeader } from "@/components/shell";
import {
  Avatar,
  Chip,
  EmptyState,
  Segmented,
  StatusChip,
  useNowTick,
} from "@/components/ui";
import { fmtClock, fmtDateShort, pct, roleTone } from "@/lib/format";
import { liveBoard, performanceFor } from "@/lib/metrics";
import { useWorkforce } from "@/lib/store";
import { isLiveBackend } from "@/lib/supabase/client";
import { demoActive } from "@/lib/demo/mode";
import type { Role, User } from "@/lib/types";
import {
  IArrowR,
  IEdit,
  IPlus,
  ISearch,
  IShield,
  IUsers,
} from "@/components/WfIcons";

/**
 * Whether this person has ever signed in, and how.
 *
 * The database writes it at every sign-in from what Google, Outlook or the
 * emailed code vouched for, so this is the register's answer to "did the
 * invite land" — the thing an administrator otherwise finds out by asking.
 * Live backend only: demo people have never signed in anywhere, and saying
 * so on every row would be noise.
 */
function SignInNote({ u }: { u: User }) {
  if (!isLiveBackend) return null;
  if (!u.lastSignInAt) {
    return (
      <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
        Not signed in yet
      </span>
    );
  }
  const via =
    u.authProvider === "google"
      ? "Google"
      : u.authProvider === "azure"
        ? "Outlook"
        : "email code";
  return (
    <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
      Signed in with {via} · {fmtDateShort(u.lastSignInAt)}
    </span>
  );
}

/** Role names read as labels, not as enum values. */
const ROLE_LABEL: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
  superadmin: "Super Admin",
};

export default function AdminTeam() {
  const { state, saveEmployee, setUserRole, reloadFromBackend } = useWorkforce();
  const now = useNowTick(15);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all" | "invited">("all");
  const [removing, setRemoving] = useState<User | null>(null);
  const { active } = useMyCompanies();

  /*
   * Who has actually arrived, and who is still being waited on.
   *
   * A membership row exists from the moment somebody types a name; these two
   * reads are what separate a colleague from an address. Refused for anyone
   * who is not an administrator here, which is an empty map — the list still
   * renders, without the labels.
   */
  const [memberState, setMemberState] = useState<Map<string, MemberState>>(new Map());
  const [pending, setPending] = useState<PendingInvitation[]>([]);
  const loadMembership = useCallback(() => {
    if (!isLiveBackend || demoActive()) return;
    void fetchCompanyMembers().then(setMemberState).catch(() => {});
    void fetchPendingInvitations().then(setPending).catch(() => {});
  }, []);
  useEffect(loadMembership, [loadMembership, state.users.length]);

  const board = useMemo(() => liveBoard(state, undefined, now), [state, now]);

  /** Everyone still a member: the count the All tab is counting. */
  const rowsAll = useMemo(
    () => state.users.filter((u) => u.status !== "revoked"),
    [state.users],
  );

  /** Invitations for people who have no membership row yet, so appear nowhere else. */
  const pendingOutside = useMemo(
    () => pending.filter((i) => !i.hasMembership),
    [pending],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (roleFilter === "invited") return [];
    return state.users
      .filter((u) => u.status !== "revoked")
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
        sub={`${rowsAll.length} people`}
        action={
          <span className="flex items-center gap-2">
            {/* Two different acts. Add writes a record for a crew that may
                never sign in; Invite asks a person to join, and if they
                already have a Workfence account it becomes a second
                membership on the identity they already have. */}
            {isLiveBackend && !demoActive() ? (
              <Link
                className="wf-btn wf-btn-ghost wf-btn-sm"
                href="/admin/team/invite"
              >
                <IUsers size={15} /> Invite
              </Link>
            ) : null}
            {/* Its own screen, and the same one onboarding uses: type them
                in or take them from the phone's contacts. */}
            <Link href="/admin/team/add" className="wf-btn wf-btn-primary wf-btn-sm">
              <IPlus size={15} /> Add
            </Link>
          </span>
        }
      />
      <RemoveMemberDialog
        member={removing}
        companyName={active?.name ?? "this company"}
        onClose={() => setRemoving(null)}
        onRemoved={() => void reloadFromBackend()}
      />
      <div className="flex flex-col gap-3.5 px-4">
        <div className="relative">
          <ISearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]" />
          <input
            className="wf-input wf-input-search"
            aria-label="Search team by name, employee code or trade"
            placeholder="Search name, code, trade…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Segmented<Role | "all" | "invited">
          ariaLabel="Role filter"
          value={roleFilter}
          onChange={setRoleFilter}
          size="sm"
          options={[
            { value: "all", label: `All (${rowsAll.length})` },
            { value: "employee", label: "Employees" },
            { value: "manager", label: "Managers" },
            { value: "admin", label: "Admins" },
            /* People who have been asked and have not answered. A tab
               rather than a banner above the list: they are part of the
               team's picture, and a banner pushed the actual team down the
               screen on every visit whether or not anyone was waiting. */
            ...(pendingOutside.length > 0
              ? [
                  {
                    value: "invited" as const,
                    label: `Invited (${pendingOutside.length})`,
                  },
                ]
              : []),
          ]}
        />

        {roleFilter === "invited" ? (
          <div className="flex flex-col gap-2">
            {pendingOutside.map((inv) => (
              <div key={inv.id} className="wf-card flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={inv.name || inv.email} hue={(inv.email.length * 47) % 360} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9rem] font-bold">
                      {inv.name || inv.email}
                    </span>
                    <span className="block truncate text-[0.74rem] text-[var(--wf-muted)]">
                      {inv.email}
                    </span>
                    <span className="block truncate text-[0.72rem] text-[var(--wf-faint)]">
                      Invited as {ROLE_LABEL[inv.role] ?? inv.role}
                      {inv.invitedBy ? ` by ${inv.invitedBy}` : ""}
                    </span>
                  </span>
                  <Chip tone="blue">Invited</Chip>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="wf-btn wf-btn-ghost wf-btn-sm wf-btn-danger-text"
                    onClick={() =>
                      void cancelInvitationRemote(inv.id)
                        .then(() => {
                          showToast(`Invitation to ${inv.email} cancelled`);
                          loadMembership();
                        })
                        .catch((e) => showToast(describeError(e), "danger"))
                    }
                  >
                    Cancel invitation
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="flex flex-col gap-2">
          {/* A filter that matches nothing left a blank screen — which reads
              as a broken page rather than as "no matches". */}
          {rows.length === 0 && (
            <EmptyState
              icon={<IUsers size={26} />}
              title="Nobody matches that"
              body={
                query.trim()
                  ? `No one in the team matches "${query.trim()}"${roleFilter === "all" ? "" : ` in ${roleFilter}s`}. Try a shorter search, or clear the filter.`
                  : "No one holds that role yet."
              }
            />
          )}
          {rows.map((u) => {
            const live = board.find((b) => b.user.id === u.id);
            const perf =
              u.role === "employee" ? performanceFor(state, u, 14, now) : null;
            const isOwner = u.id === "usr_owner";
            return (
              /* Identity on one line, actions on the next. Sharing the row
                 squeezed admin names down to "Divy…" while manager rows —
                 whose buttons happened to wrap — showed the name in full, so
                 one list read two different ways. */
              <div
                key={u.id}
                className="wf-card2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-3.5 py-3"
              >
                <Avatar
                  name={u.name}
                  hue={u.avatarHue}
                  photo={u.photo}
                  size={42}
                  ring={live?.state === "working" ? "green" : "none"}
                />
                {/* The name owns the left, the role sits at the right edge
                    where the eye can run down a column of them. Jammed up
                    against the name it competed with it and pushed long
                    names into an ellipsis for no reason. */}
                <Link
                  href={u.role === "employee" ? `/manager/employee?id=${u.id}` : "#"}
                  className={`min-w-0 ${u.role === "employee" ? "" : "pointer-events-none"}`}
                >
                  <span className="block truncate font-semibold">{u.name}</span>
                  <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                    {u.designation} · {u.department} · {u.employeeCode}
                    {perf ? ` · ${pct(perf.attendancePct)} att · score ${Math.round(perf.overall)}` : ""}
                    {live?.state === "working" ? ` · on site ${fmtClock(live.workedMs).slice(0, 5)}` : ""}
                  </span>
                  <SignInNote u={u} />
                </Link>
                <span className="flex shrink-0 items-center gap-1.5">
                  {u.status !== "active" && <StatusChip status="not-in" label={u.status} />}
                  <Chip
                    tone={roleTone(u.role)}
                  >
                    {u.role === "admin" ? (
                      <>
                        <IShield size={10} /> Admin
                      </>
                    ) : (
                      ROLE_LABEL[u.role] ?? u.role
                    )}
                  </Chip>
                  <MemberStatusChip user={u} live={memberState.get(u.id)} />
                </span>
                <div className="col-span-3 flex flex-wrap items-center gap-2">
                  {/* Edit comes first, and applies to everyone.
                      Restricting it to employees meant a manager's or an
                      admin's details could not be corrected at all — and
                      since the phone number is now the identity they sign
                      in with, a typo in one locked them out with no way to
                      fix it from here. Role and status stay separately
                      guarded below. */}
                  <Link
                    className="wf-btn wf-btn-ghost wf-btn-sm"
                    href={`/manager/workforce/edit?id=${u.id}&from=${encodeURIComponent("/admin/team")}`}
                  >
                    <IEdit size={13} /> Edit
                  </Link>
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
                      className="wf-btn wf-btn-ghost wf-btn-sm"
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
                  {/* Removal is the company's door, not a status: it ends the
                      membership and nothing else they belong to. */}
                  {!isOwner && isLiveBackend && !demoActive() ? (
                    <button
                      className="wf-btn wf-btn-ghost wf-btn-sm wf-btn-danger-text"
                      onClick={() => setRemoving(u)}
                    >
                      Remove from company
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        )}

        <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[0.68rem] text-[var(--wf-faint)]">
          Role changes are audit-logged — see{" "}
          <Link href="/admin/governance" className="inline-flex items-center gap-0.5 font-semibold text-[var(--wf-violet)]">
            Governance <IArrowR size={11} />
          </Link>
        </p>
      </div>

    </div>
  );
}
