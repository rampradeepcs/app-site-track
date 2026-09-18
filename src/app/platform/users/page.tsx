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
import { Fact, Facts, Modal, Segmented } from "@/components/ui";
import { fmtDateLong, fmtRelative, fmtShiftTime } from "@/lib/format";
import { fmtINR } from "@/lib/payroll";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import type { User } from "@/lib/types";
import { ISearch, IUsers } from "@/components/WfIcons";

type Filter = "all" | "admins" | "managers" | "employees" | "pending" | "inactive";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-1 text-[0.7rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
        {title}
      </h3>
      <Facts separated caps wrap>
        <div className="wf-inset px-3 py-1 contents">{children}</div>
      </Facts>
    </section>
  );
}

export default function PlatformUsersPage() {
  const { platform } = usePlatform();
  const { state } = useWorkforce();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<User | null>(null);

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
        back={{ href: "/platform/more", label: "More" }}
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
                      {/* The name opens the record. Everything a table cannot
                          hold — the shift, the vehicle, the pay, whether a
                          face is enrolled — lives behind this. */}
                      <button
                        className="cursor-pointer text-left hover:text-[var(--wf-violet)]"
                        onClick={() => setOpen(user)}
                      >
                        <div className="font-bold">{user.name}</div>
                        <div className="text-[0.72rem] text-[var(--wf-muted)]">{user.email}</div>
                      </button>
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

      <PersonRecord
        user={open}
        company={open?.orgId ? (orgName.get(open.orgId) ?? "Unknown company") : "Platform"}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

/**
 * Everything held about one person, in one place.
 *
 * Grouped the way somebody asks about it rather than the way the table
 * stores it: who they are, where they work, whether they can get in, what
 * they are paid, what the phone knows about them.
 *
 * The face enrolment says only whether one exists. The template itself is
 * 128 floats on the phone that captured it and is never sent here, so there
 * is nothing to show and showing a count is the honest answer.
 */
function PersonRecord({
  user,
  company,
  onClose,
}: {
  user: User | null;
  company: string;
  onClose: () => void;
}) {
  const { state } = useWorkforce();

  const extra = useMemo(() => {
    if (!user) return null;
    const projects = state.projects.filter((p) => user.projectIds.includes(p.id));
    const days = state.attendance.filter((a) => a.employeeId === user.id);
    const last = days.reduce<number>((t, a) => Math.max(t, a.checkIn?.at ?? 0), 0);
    /* Salary is a history; the current figure is the newest one that has
       already taken effect. */
    const pay = (state.comp ?? [])
      .filter((c) => c.employeeId === user.id)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    return { projects, days: days.length, last, pay };
  }, [user, state.projects, state.attendance, state.comp]);

  if (!user || !extra) return null;

  const rate = extra.pay
    ? `${fmtINR(extra.pay.amount)} ${extra.pay.type === "monthly" ? "per month" : extra.pay.type === "daily" ? "per day" : "per hour"}`
    : null;

  return (
    <Modal open onClose={onClose} title={user.name}>
      <Group title="Identity">
        <Fact label="Name" value={user.name} />
        <Fact label="Email" value={user.email} />
        <Fact
          label="Email verified"
          value={user.emailVerified === undefined ? "Unknown" : user.emailVerified ? "Yes" : "No"}
        />
        <Fact label="Phone" value={user.phone} />
        <Fact label="Employee code" value={user.employeeCode} />
      </Group>

      <Group title="Place in the company">
        <Fact label="Company" value={company} />
        <Fact label="Role" value={<span className="capitalize">{user.role}</span>} />
        <Fact label="Designation" value={user.designation} />
        <Fact label="Department" value={user.department} />
        <Fact label="Status" value={<MemberStatusChip user={user} />} />
        <Fact label="Joined" value={user.joinedAt ? fmtDateLong(user.joinedAt) : null} />
        <Fact
          label="Projects"
          value={extra.projects.length ? extra.projects.map((p) => p.name).join(", ") : "None assigned"}
        />
      </Group>

      <Group title="Getting in">
        <Fact
          label="Signs in with"
          value={
            user.authProvider === "azure"
              ? "Outlook"
              : user.authProvider === "google"
                ? "Google"
                : user.authProvider === "email"
                  ? "Email code"
                  : "Not linked yet"
          }
        />
        <Fact
          label="Last signed in"
          value={user.lastSignInAt ? fmtRelative(user.lastSignInAt) : <span className="text-[var(--wf-amber)]">Never</span>}
        />
        <Fact label="App access" value={user.appAccess === false ? "Blocked" : "Allowed"} />
        <Fact
          label="Face enrolled"
          value={
            user.face?.descriptors?.length
              ? `Yes — ${user.face.descriptors.length} samples, on their own phone`
              : "No"
          }
        />
      </Group>

      <Group title="Work and pay">
        <Fact
          label="Shift"
          value={`${fmtShiftTime(user.shiftStart)} — ${fmtShiftTime(user.shiftEnd)}`}
        />
        <Fact label="Days recorded" value={String(extra.days)} />
        <Fact
          label="Last check-in"
          value={extra.last ? fmtRelative(extra.last) : "None"}
        />
        <Fact label="Pay rate" value={rate ?? "Not set"} />
        <Fact
          label="Supervisor rating"
          value={user.supervisorRating != null ? `${user.supervisorRating}/100` : null}
        />
      </Group>

      {user.vehicle && user.vehicle.type !== "none" ? (
        <Group title="Vehicle">
          <Fact label="Type" value={<span className="capitalize">{user.vehicle.type.replace("-", " ")}</span>} />
          <Fact label="Ownership" value={<span className="capitalize">{user.vehicle.ownership}</span>} />
          <Fact label="Registration" value={user.vehicle.registration} />
          <Fact label="Fuel" value={user.vehicle.fuelType} />
        </Group>
      ) : null}

      {user.orgId ? (
        <Link
          href={`/platform/client?id=${user.orgId}`}
          className="wf-btn wf-btn-ghost w-full"
          onClick={onClose}
        >
          Open {company}
        </Link>
      ) : null}
    </Modal>
  );
}
