"use client";

/** Support — client issues, with a jump into the relevant account context. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHead } from "@/components/platform/PlatformShell";
import { MetricCard, StatusPill } from "@/components/platform/bits";
import { Chip, Segmented, useNowTick } from "@/components/ui";
import { fmtRelative } from "@/lib/format";
import { usePlatform } from "@/lib/platform-store";
import type { TicketStatus } from "@/lib/saas-types";
import { IArrowR } from "@/components/WfIcons";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "var(--wf-red)",
  high: "var(--wf-orange)",
  normal: "var(--wf-blue)",
  low: "var(--wf-faint)",
};

export default function SupportPage() {
  const { platform, setTicketStatus } = usePlatform();
  const now = useNowTick(60);
  const [filter, setFilter] = useState<TicketStatus | "all">("all");

  const rows = useMemo(
    () =>
      platform.tickets
        .filter((t) => filter === "all" || t.status === filter)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [platform.tickets, filter],
  );

  const open = platform.tickets.filter((t) => t.status !== "resolved");

  return (
    <div className="pb-10">
      <PageHead title="Support" sub={`${open.length} open · ${platform.tickets.length} total`} />
      <div className="flex flex-col gap-4 px-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-5">
          <MetricCard label="Open" value={platform.tickets.filter((t) => t.status === "open").length} tone="amber" />
          <MetricCard label="In progress" value={platform.tickets.filter((t) => t.status === "in-progress").length} tone="blue" />
          <MetricCard label="Waiting" value={platform.tickets.filter((t) => t.status === "waiting").length} />
          <MetricCard label="Urgent" value={platform.tickets.filter((t) => t.priority === "urgent" && t.status !== "resolved").length} tone="red" />
          <MetricCard label="Resolved" value={platform.tickets.filter((t) => t.status === "resolved").length} tone="green" />
        </div>

        <Segmented<TicketStatus | "all">
          ariaLabel="Ticket filter"
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: "all", label: `All (${platform.tickets.length})` },
            { value: "open", label: "Open" },
            { value: "in-progress", label: "In progress" },
            { value: "waiting", label: "Waiting" },
            { value: "resolved", label: "Resolved" },
          ]}
        />

        <div className="flex flex-col gap-2.5">
          {rows.length === 0 && (
            <p className="wf-card px-4 py-10 text-center text-sm text-[var(--wf-muted)]">
              Nothing here.
            </p>
          )}
          {rows.map((t) => {
            const org = platform.organizations.find((o) => o.id === t.orgId);
            return (
              <article key={t.id} className="wf-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase"
                    style={{
                      background: `color-mix(in oklab, ${PRIORITY_TONE[t.priority]} 16%, transparent)`,
                      color: PRIORITY_TONE[t.priority],
                    }}
                  >
                    {t.priority}
                  </span>
                  <Chip tone="neutral">{t.kind}</Chip>
                  {org && <StatusPill status={org.status} />}
                  <span className="ml-auto text-[0.68rem] text-[var(--wf-faint)]">
                    updated {fmtRelative(t.updatedAt, now)}
                  </span>
                </div>
                <h2 className="mt-1.5 font-semibold">{t.subject}</h2>
                <p className="mt-0.5 text-[0.82rem] leading-relaxed text-[var(--wf-muted)]">{t.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--wf-line)] pt-3">
                  <span className="text-[0.74rem] text-[var(--wf-muted)]">
                    {org?.name} · raised by {t.raisedBy}
                  </span>
                  <span className="ml-auto flex flex-wrap gap-1.5">
                    {(["open", "in-progress", "waiting", "resolved"] as TicketStatus[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => setTicketStatus(t.id, s)}
                        aria-pressed={t.status === s}
                        // These set a ticket's state, so they are real actions,
                        // not labels — min-h keeps them hittable at 27px text.
                        className={`inline-flex min-h-9 cursor-pointer items-center rounded-lg border px-3 text-[0.7rem] font-semibold capitalize transition ${
                          t.status === s
                            ? "border-[var(--wf-violet)] bg-[var(--wf-violet-soft)] text-[var(--wf-violet)]"
                            : "border-[var(--wf-line)] text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
                        }`}
                      >
                        {s.replace("-", " ")}
                      </button>
                    ))}
                    <Link href={`/platform/client?id=${t.orgId}`} className="wf-btn wf-btn-ghost wf-btn-sm">
                      Account <IArrowR size={13} />
                    </Link>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
