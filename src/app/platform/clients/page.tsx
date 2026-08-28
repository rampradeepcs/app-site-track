"use client";

/** Clients module — the tenant register, with filters, search and onboarding. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHead } from "@/components/platform/PlatformShell";
import { HealthPill, StatusPill } from "@/components/platform/bits";
import { OnboardWizard } from "@/components/platform/OnboardWizard";
import { Segmented, useNowTick } from "@/components/ui";
import { entitlementsFor } from "@/lib/entitlements";
import { fmtDateLong } from "@/lib/format";
import { usePlatform } from "@/lib/platform-store";
import { clientHealth, latestUsage, money } from "@/lib/saas-metrics";
import { IPlus, ISearch } from "@/components/WfIcons";

type Filter =
  | "all"
  | "active"
  | "trial"
  | "expiring"
  | "suspended"
  | "due"
  | "cancelled";

const DAY = 86_400_000;

export default function ClientsPage() {
  const { platform } = usePlatform();
  const now = useNowTick(60);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [wizard, setWizard] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return platform.organizations
      .map((org) => {
        const sub = platform.subscriptions.find((s) => s.orgId === org.id);
        const ent = entitlementsFor(platform, org.id);
        const usage = latestUsage(platform, org.id);
        const health = clientHealth(platform, org.id, now);
        const unpaid = platform.invoices.some(
          (i) => i.orgId === org.id && (i.status === "overdue" || i.status === "failed" || i.status === "pending"),
        );
        return { org, sub, ent, usage, health, unpaid };
      })
      .filter((r) => {
        if (!needle) return true;
        return `${r.org.name} ${r.org.code} ${r.org.contactEmail} ${r.org.contactPhone} ${r.sub?.id ?? ""}`
          .toLowerCase()
          .includes(needle);
      })
      .filter((r) => {
        switch (filter) {
          case "active":
            return r.org.status === "active";
          case "trial":
            return r.org.status === "trial";
          case "expiring":
            return !!r.sub?.trialEndsAt && r.sub.trialEndsAt - now < 14 * DAY;
          case "suspended":
            return r.org.status === "suspended" || r.org.status === "payment-hold";
          case "due":
            return r.unpaid;
          case "cancelled":
            return r.org.status === "cancelled";
          default:
            return true;
        }
      });
  }, [platform, q, filter, now]);

  const counts = useMemo(
    () => ({
      all: platform.organizations.length,
      active: platform.organizations.filter((o) => o.status === "active").length,
      trial: platform.organizations.filter((o) => o.status === "trial").length,
    }),
    [platform.organizations],
  );

  return (
    <div className="pb-10">
      <PageHead
        title="Clients"
        sub={`${counts.all} organisations · ${counts.active} active · ${counts.trial} on trial`}
        action={
          <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={() => setWizard(true)}>
            <IPlus size={15} /> Onboard client
          </button>
        }
      />

      <div className="flex flex-col gap-4 px-5">
        <div className="relative">
          <ISearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]" />
          <input
            className="wf-input wf-input-search"
            aria-label="Search client organisations"
            placeholder="Search company, client ID, admin email, phone or subscription…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <Segmented<Filter>
          ariaLabel="Client filter"
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: "all", label: `All (${counts.all})` },
            { value: "active", label: "Active" },
            { value: "trial", label: "Trial" },
            { value: "expiring", label: "Expiring" },
            { value: "due", label: "Payment due" },
            { value: "suspended", label: "Suspended" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />

        <div className="wf-card overflow-hidden">
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Plan</th>
                  <th className="text-right">Users</th>
                  <th className="text-right">Projects</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>Renewal</th>
                  <th>Billing</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-[var(--wf-muted)]">
                      No clients match.
                    </td>
                  </tr>
                )}
                {rows.map(({ org, sub, ent, usage, health, unpaid }) => (
                  <tr key={org.id}>
                    {/* The table scrolls sideways, so a long legal name reads
                        better on one line than stacked four deep. */}
                    <td className="whitespace-nowrap">
                      <Link
                        href={`/platform/client?id=${org.id}`}
                        className="inline-block py-1.5 font-semibold hover:text-[var(--wf-violet)]"
                      >
                        {org.name}
                      </Link>
                      <span className="block text-[0.66rem] text-[var(--wf-faint)]">
                        {org.code} · {org.industry}
                      </span>
                    </td>
                    <td className="text-[var(--wf-muted)]">
                      {ent.planName}
                      {(ent.overriddenLimits.length > 0 || ent.overriddenFeatures.length > 0) && (
                        <span
                          className="ml-1 rounded bg-[var(--wf-violet-soft)] px-1 py-0.5 text-[0.58rem] font-bold text-[var(--wf-violet)]"
                          title="Customised from the base plan"
                        >
                          CUSTOM
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {usage?.employees ?? 0}
                      {ent.limits.employees ? (
                        <span className="text-[var(--wf-faint)]">/{ent.limits.employees}</span>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">{usage?.projects ?? 0}</td>
                    <td><StatusPill status={org.status} /></td>
                    <td><HealthPill score={health.score} /></td>
                    <td className="whitespace-nowrap text-[0.76rem] text-[var(--wf-muted)]">
                      {sub ? fmtDateLong(sub.renewsAt) : "—"}
                    </td>
                    <td>
                      <span
                        className="text-[0.74rem] font-semibold"
                        style={{ color: unpaid ? "var(--wf-amber)" : "var(--wf-green)" }}
                      >
                        {unpaid ? "Due" : "Paid"}
                      </span>
                      {sub ? (
                        <span className="block text-[0.64rem] text-[var(--wf-faint)]">
                          {money(sub.customPrice ?? 0) !== "₹0" ? "custom price" : sub.cycle}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <OnboardWizard open={wizard} onClose={() => setWizard(false)} />
    </div>
  );
}
