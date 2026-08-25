"use client";

/** Billing — revenue summary and the platform-wide invoice ledger. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHead } from "@/components/platform/PlatformShell";
import { InvoicePill, MetricCard } from "@/components/platform/bits";
import { Segmented, useNowTick } from "@/components/ui";
import { fmtDateLong } from "@/lib/format";
import { usePlatform } from "@/lib/platform-store";
import { money, platformStats } from "@/lib/saas-metrics";
import { downloadCSV, toCSV } from "@/lib/reports";
import type { InvoiceStatus } from "@/lib/saas-types";
import { IDownload, ISearch } from "@/components/WfIcons";

type Filter = "all" | "unpaid" | InvoiceStatus;

export default function BillingPage() {
  const { platform, setInvoiceStatus } = usePlatform();
  const now = useNowTick(60);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const stats = useMemo(() => platformStats(platform, now), [platform, now]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return platform.invoices
      .map((inv) => ({ inv, org: platform.organizations.find((o) => o.id === inv.orgId) }))
      .filter(({ inv, org }) => {
        if (needle && !`${inv.number} ${org?.name ?? ""} ${inv.periodLabel}`.toLowerCase().includes(needle))
          return false;
        if (filter === "all") return true;
        if (filter === "unpaid")
          return ["issued", "pending", "overdue", "failed"].includes(inv.status);
        return inv.status === filter;
      })
      .sort((a, b) => b.inv.issuedAt - a.inv.issuedAt);
  }, [platform, filter, q]);

  const paid = platform.invoices.filter((i) => i.status === "paid");
  const totalRevenue = paid.reduce((t, i) => t + i.amount + i.taxAmount, 0);

  const exportCsv = () =>
    downloadCSV(
      "invoices.csv",
      toCSV(
        ["Invoice", "Client", "Period", "Amount", "Tax", "Issued", "Due", "Status", "Method"],
        rows.map(({ inv, org }) => [
          inv.number,
          org?.name ?? inv.orgId,
          inv.periodLabel,
          inv.amount,
          inv.taxAmount,
          fmtDateLong(inv.issuedAt),
          fmtDateLong(inv.dueAt),
          inv.status,
          inv.paymentMethod,
        ]),
      ),
    );

  return (
    <div className="pb-10">
      <PageHead
        title="Billing"
        sub={`${platform.invoices.length} invoices · ${money(totalRevenue)} collected all-time`}
        action={
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={exportCsv}>
            <IDownload size={14} /> Export CSV
          </button>
        }
      />
      <div className="flex flex-col gap-4 px-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <MetricCard label="Total revenue" value={money(totalRevenue)} tone="green" sub="collected" />
          <MetricCard label="MRR" value={money(stats.mrr)} tone="violet" />
          <MetricCard label="ARR" value={money(stats.arr)} tone="violet" />
          <MetricCard label="Outstanding" value={money(stats.outstanding)} tone={stats.outstanding ? "amber" : "neutral"} />
          <MetricCard label="Overdue" value={platform.invoices.filter((i) => i.status === "overdue").length} tone="orange" />
          <MetricCard label="Failed" value={stats.failedPayments} tone={stats.failedPayments ? "red" : "neutral"} />
        </div>

        <div className="relative">
          <ISearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]" />
          <input
            className="wf-input wf-input-search"
            aria-label="Search invoices"
            placeholder="Search invoice number, client or period…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="wf-scroll-x">
          <Segmented<Filter>
            ariaLabel="Invoice filter"
            value={filter}
            onChange={setFilter}
            size="sm"
            options={[
              { value: "all", label: `All (${platform.invoices.length})` },
              { value: "unpaid", label: "Unpaid" },
              { value: "paid", label: "Paid" },
              { value: "pending", label: "Pending" },
              { value: "overdue", label: "Overdue" },
              { value: "failed", label: "Failed" },
              { value: "refunded", label: "Refunded" },
            ]}
          />
        </div>

        <div className="wf-card overflow-hidden">
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Invoice</th><th>Client</th><th className="text-right">Amount</th>
                  <th>Issued</th><th>Due</th><th>Status</th><th>Method</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="py-10 text-center text-[var(--wf-muted)]">No invoices match.</td></tr>
                )}
                {rows.map(({ inv, org }) => (
                  <tr key={inv.id}>
                    <td>
                      <span className="font-semibold">{inv.number}</span>
                      <span className="block text-[0.64rem] text-[var(--wf-faint)]">{inv.periodLabel}</span>
                    </td>
                    <td>
                      <Link
                        href={`/platform/client?id=${inv.orgId}&tab=billing`}
                        className="inline-block py-1.5 text-[var(--wf-muted)] hover:text-[var(--wf-violet)]"
                      >
                        {org?.name ?? inv.orgId}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">
                      {money(inv.amount + inv.taxAmount, inv.currency)}
                      <span className="block text-[0.62rem] text-[var(--wf-faint)]">tax {money(inv.taxAmount, inv.currency)}</span>
                    </td>
                    <td className="whitespace-nowrap text-[0.76rem]">{fmtDateLong(inv.issuedAt)}</td>
                    <td className="whitespace-nowrap text-[0.76rem]">{fmtDateLong(inv.dueAt)}</td>
                    <td>
                      <InvoicePill status={inv.status} />
                      {inv.failureReason && (
                        <span className="block text-[0.62rem] text-[var(--wf-red)]">{inv.failureReason}</span>
                      )}
                    </td>
                    <td className="text-[0.72rem] text-[var(--wf-muted)]">{inv.paymentMethod}</td>
                    <td>
                      <span className="flex gap-1">
                        {inv.status !== "paid" && inv.status !== "cancelled" && inv.status !== "refunded" && (
                          <button className="wf-btn wf-btn-quiet wf-btn-sm" onClick={() => setInvoiceStatus(inv.id, "paid")}>
                            Mark paid
                          </button>
                        )}
                        {inv.status === "paid" && (
                          <button className="wf-btn wf-btn-quiet wf-btn-sm" onClick={() => setInvoiceStatus(inv.id, "refunded")}>
                            Refund
                          </button>
                        )}
                        {(inv.status === "draft" || inv.status === "issued") && (
                          <button className="wf-btn wf-btn-quiet wf-btn-sm" onClick={() => setInvoiceStatus(inv.id, "cancelled")}>
                            Void
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
