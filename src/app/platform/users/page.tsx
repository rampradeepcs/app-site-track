"use client";

/**
 * People — every user the platform owner can see, across every client.
 *
 * The console could already reach a person, but only by knowing which
 * company they were in first: Clients → a client → Users. That works when
 * you are auditing one tenant and not at all when somebody writes in with
 * an address and no company attached to it, which is most of the time.
 *
 * So the register is flat here and the company is a column rather than a
 * route. Row-level security already decides the rows — a superadmin reads
 * every tenant from the same query a client admin uses to read one — so
 * this screen filters and sorts what it is given and never asks for more.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHead } from "@/components/platform/PlatformShell";
import { MemberStatusChip } from "@/components/MemberStatus";
import { Segmented } from "@/components/ui";
import { fmtRelative } from "@/lib/format";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import { ISearch, IUsers } from "@/components/WfIcons";

type Filter = "all" | "admins" | "managers" | "employees" | "pending" | "inactive";

export default function PlatformUsersPage() {
  const { platform } = usePlatform();
  const { state } = useWorkforce();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  /* Company names by id, so the table does not do a find() per row. */
  const orgName = useMemo(
    () => new Map(platform.organizations.map((o) => [o.id, o.name])),
    [platform.organizations],
  );

  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.users
      .map((u) => ({
        user: u,
        /* A person with no company is platform staff — the owner themselves.
           Naming that is more use than hiding the row and leaving the count
           short by one. */
        company: u.orgId ? (orgName.get(u.orgId) ?? "Unknown company") : "Platform",
        /* Invited but never signed in. The single most common reason a
           superadmin opens this screen: somebody says they never got in. */
        pending: !u.lastSignInAt,
      }))
      .filter(({ user, company }) => {
        if (!needle) return true;
        return `${user.name} ${user.email} ${user.employeeCode} ${user.phone ?? ""} ${user.designation} ${company}`
          .toLowerCase()
          .includes(needle);
      })
      .filter(({ user, pending }) => {
        switch (filter) {
          case "admins":
            return user.role === "admin" || user.role === "superadmin";
          case "managers":
            return user.role === "manager";
          case "employees":
            return user.role === "employee";
          case "pending":
            return pending;
          case "inactive":
            return user.status !== "active";
          default:
            return true;
        }
      })
      .sort(
        (a, b) =>
          a.company.localeCompare(b.company) || a.user.name.localeCompare(b.user.name),
      );
  }, [state.users, orgName, q, filter]);

  const counts = useMemo(() => {
    const all = state.users.length;
    return {
      all,
      pending: state.users.filter((u) => !u.lastSignInAt).length,
      inactive: state.users.filter((u) => u.status !== "active").length,
      companies: new Set(state.users.map((u) => u.orgId).filter(Boolean)).size,
    };
  }, [state.users]);

  return (
    <div className="pb-10">
      <PageHead
        title="People"
        sub={`${counts.all} ${counts.all === 1 ? "person" : "people"} across ${counts.companies} ${
          counts.companies === 1 ? "company" : "companies"
        }${counts.pending ? ` · ${counts.pending} never signed in` : ""}`}
      />

      <div className="flex flex-col gap-4 px-5">
        <div className="relative">
          <ISearch
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]"
          />
          <input
            className="wf-input wf-input-search"
            aria-label="Search people across all companies"
            placeholder="Search name, email, phone, employee code or company…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <Segmented<Filter>
          ariaLabel="People filter"
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: "all", label: `All (${counts.all})` },
            { value: "admins", label: "Admins" },
            { value: "managers", label: "Managers" },
            { value: "employees", label: "Employees" },
            { value: "pending", label: `Never signed in (${counts.pending})` },
            { value: "inactive", label: `Not active (${counts.inactive})` },
          ]}
        />

        <div className="wf-card overflow-hidden">
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Company</th>
                  <th>Role</th>
                  <th>Designation</th>
                  <th>Status</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {people.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[var(--wf-muted)]">
                      {state.users.length === 0
                        ? "No people have loaded yet."
                        : "Nobody matches."}
                    </td>
                  </tr>
                )}
                {people.map(({ user, company, pending }) => (
                  <tr key={user.id}>
                    <td className="whitespace-nowrap">
                      <div className="font-bold">{user.name}</div>
                      <div className="text-[0.72rem] text-[var(--wf-muted)]">{user.email}</div>
                    </td>
                    <td className="whitespace-nowrap">
                      {/* Straight through to the tenant, because the next
                          question after "who is this" is almost always
                          "and what are they paying". */}
                      {user.orgId ? (
                        <Link
                          href={`/platform/client?id=${user.orgId}`}
                          className="inline-block py-1.5 font-semibold hover:text-[var(--wf-violet)]"
                        >
                          {company}
                        </Link>
                      ) : (
                        <span className="text-[var(--wf-muted)]">{company}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap capitalize">{user.role}</td>
                    <td className="whitespace-nowrap text-[var(--wf-muted)]">
                      {user.designation || "—"}
                    </td>
                    <td>
                      <MemberStatusChip user={user} />
                    </td>
                    <td className="whitespace-nowrap text-[var(--wf-muted)]">
                      {pending ? (
                        <span className="text-[var(--wf-amber)]">Never</span>
                      ) : (
                        fmtRelative(user.lastSignInAt!)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="flex items-center gap-2 px-1 text-[0.72rem] text-[var(--wf-faint)]">
          <IUsers size={13} className="shrink-0" />
          Everyone the console can see. Row-level security decides that, not this screen.
        </p>
      </div>
    </div>
  );
}
