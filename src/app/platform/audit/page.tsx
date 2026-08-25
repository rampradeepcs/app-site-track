"use client";

/** Platform audit log — append-only, filterable, exportable. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHead } from "@/components/platform/PlatformShell";
import { useNowTick } from "@/components/ui";
import { fmtDateLong, fmtRelative, fmtTime } from "@/lib/format";
import { usePlatform } from "@/lib/platform-store";
import { downloadCSV, toCSV } from "@/lib/reports";
import { IDownload, ISearch, IShield } from "@/components/WfIcons";

export default function AuditPage() {
  const { platform } = usePlatform();
  const now = useNowTick(60);
  const [q, setQ] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return platform.platformAudit.filter((a) => {
      if (orgFilter !== "all" && a.orgId !== orgFilter) return false;
      if (!needle) return true;
      return `${a.action} ${a.target} ${a.detail ?? ""} ${a.previousValue ?? ""} ${a.newValue ?? ""} ${a.actorName}`
        .toLowerCase()
        .includes(needle);
    });
  }, [platform.platformAudit, q, orgFilter]);

  const exportCsv = () =>
    downloadCSV(
      "platform-audit.csv",
      toCSV(
        ["When", "Actor", "Client", "Action", "Target", "Previous", "New", "Detail"],
        rows.map((a) => [
          new Date(a.at).toISOString(),
          a.actorName,
          platform.organizations.find((o) => o.id === a.orgId)?.name ?? "—",
          a.action,
          a.target,
          a.previousValue ?? "",
          a.newValue ?? "",
          a.detail ?? "",
        ]),
      ),
    );

  return (
    <div className="pb-10">
      <PageHead
        title="Audit Logs"
        sub={`${platform.platformAudit.length} recorded actions`}
        action={
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={exportCsv}>
            <IDownload size={14} /> Export CSV
          </button>
        }
      />
      <div className="flex flex-col gap-4 px-5">
        <p className="wf-inset flex items-start gap-2.5 px-3.5 py-3 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
          <IShield size={16} className="mt-0.5 shrink-0 text-[var(--wf-violet)]" />
          Append-only. Entries are written by the system when an action happens
          and cannot be edited or deleted from this console — including the
          record written whenever a Super Admin accesses a client account.
        </p>

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-60 flex-1">
            <ISearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]" />
            <input
              className="wf-input wf-input-search"
              aria-label="Filter the platform audit trail"
            placeholder="Filter by action, client, value or actor…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="wf-input w-auto min-w-48" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} aria-label="Client filter">
            <option value="all">All clients</option>
            {platform.organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        <div className="wf-card overflow-hidden">
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>When</th><th>Actor</th><th>Client</th><th>Action</th>
                  <th>Change</th><th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-[var(--wf-muted)]">No entries match.</td></tr>
                )}
                {rows.map((a) => {
                  const org = platform.organizations.find((o) => o.id === a.orgId);
                  return (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-[0.74rem]">
                        {fmtDateLong(a.at)} {fmtTime(a.at)}
                        <span className="block text-[0.64rem] text-[var(--wf-faint)]">{fmtRelative(a.at, now)}</span>
                      </td>
                      <td className="whitespace-nowrap text-[0.78rem] font-semibold">{a.actorName}</td>
                      <td className="whitespace-nowrap text-[0.78rem]">
                        {org ? (
                          <Link
                            href={`/platform/client?id=${org.id}`}
                            className="inline-block py-1.5 text-[var(--wf-muted)] hover:text-[var(--wf-violet)]"
                          >
                            {org.name}
                          </Link>
                        ) : (
                          <span className="text-[var(--wf-faint)]">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap font-semibold text-[var(--wf-violet)]">{a.action}</td>
                      <td className="text-[0.76rem]">
                        {a.previousValue || a.newValue ? (
                          <>
                            <span className="text-[var(--wf-faint)]">{a.previousValue ?? "—"}</span>
                            <span className="mx-1">→</span>
                            <span className="font-semibold">{a.newValue ?? "—"}</span>
                          </>
                        ) : (
                          <span className="text-[var(--wf-faint)]">{a.target}</span>
                        )}
                      </td>
                      <td className="text-[0.74rem] text-[var(--wf-muted)]">{a.detail ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
