"use client";

/**
 * Per-client subscription control: lifecycle, pricing, and the base-plan →
 * custom-override view that lets one client be tailored without minting a
 * bespoke global plan.
 */

import { useState } from "react";
import { InvoicePill, SubPill } from "./bits";
import { Field, SectionTitle, Segmented, Toggle } from "@/components/ui";
import { entitlementsFor } from "@/lib/entitlements";
import { fmtDateLong } from "@/lib/format";
import { usePlatform } from "@/lib/platform-store";
import { money } from "@/lib/saas-metrics";
import type { FeatureSet, PlanLimits, SubscriptionStatus } from "@/lib/saas-types";
import { FEATURE_LABELS } from "@/lib/saas-types";
import { IArrowR, IRefresh } from "@/components/WfIcons";

const LIMIT_ROWS: Array<[keyof PlanLimits, string, string?]> = [
  ["employees", "Employees"],
  ["managers", "Managers"],
  ["projects", "Projects"],
  ["storageGb", "Storage", "GB"],
  ["routeRetentionDays", "Route retention", "days"],
  ["apiCallsPerMonth", "API calls", "/mo"],
];

export function SubscriptionPanel({ orgId }: { orgId: string }) {
  const {
    platform,
    changePlan,
    updateSubscription,
    overrideLimit,
    overrideFeature,
    extendTrial,
    convertTrial,
  } = usePlatform();

  const sub = platform.subscriptions.find((s) => s.orgId === orgId);
  const plan = platform.plans.find((p) => p.id === sub?.planId);
  const ent = entitlementsFor(platform, orgId);
  const [discount, setDiscount] = useState(String(sub?.discountPercent ?? ""));
  const [price, setPrice] = useState(String(sub?.customPrice ?? ""));

  if (!sub || !plan) {
    return <p className="wf-card px-4 py-10 text-center text-sm text-[var(--wf-muted)]">No subscription on this account.</p>;
  }

  const customised = ent.overriddenLimits.length > 0 || ent.overriddenFeatures.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="wf-card flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-[0.7rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            {customised ? "Customised configuration" : "Subscription"}
          </p>
          <p className="wf-display mt-0.5 text-xl font-bold">
            {plan.name}
            {customised && (
              <span className="ml-2 rounded bg-[rgba(167,139,250,0.16)] px-1.5 py-0.5 align-middle text-[0.6rem] font-bold text-[var(--wf-violet)]">
                CUSTOM
              </span>
            )}
          </p>
          <p className="text-[0.78rem] text-[var(--wf-muted)]">
            {sub.cycle} ·{" "}
            {money(sub.customPrice ?? (sub.cycle === "annual" ? plan.annualPrice : plan.monthlyPrice), plan.currency)}
            {sub.discountPercent ? ` less ${sub.discountPercent}%` : ""} ·{" "}
            {sub.status === "trial" && sub.trialEndsAt
              ? `trial ends ${fmtDateLong(sub.trialEndsAt)}`
              : `renews ${fmtDateLong(sub.renewsAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SubPill status={sub.status} />
          {sub.status === "trial" && (
            <>
              <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => extendTrial(orgId, 14)}>
                Extend 14 days
              </button>
              <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={() => convertTrial(orgId)}>
                Convert to paid <IArrowR size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* lifecycle */}
      <div className="wf-card p-4">
        <SectionTitle>Lifecycle</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {(["trial", "active", "past-due", "paused", "suspended", "cancelled"] as SubscriptionStatus[]).map((s) => (
            <button
              key={s}
              onClick={() =>
                updateSubscription(orgId, {
                  status: s,
                  cancelledAt: s === "cancelled" ? Date.now() : undefined,
                })
              }
              className={`cursor-pointer rounded-xl border px-3 py-2 text-[0.78rem] font-semibold capitalize transition ${
                sub.status === s
                  ? "border-[var(--wf-violet)] bg-[rgba(167,139,250,0.12)] text-[var(--wf-violet)]"
                  : "border-[var(--wf-line)] bg-[var(--wf-surface2)] text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
              }`}
            >
              {s.replace("-", " ")}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Field label="Base plan">
            <select className="wf-input" value={sub.planId} onChange={(e) => changePlan(orgId, e.target.value)}>
              {platform.plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Billing cycle">
            <Segmented
              ariaLabel="Billing cycle"
              value={sub.cycle}
              onChange={(v) => updateSubscription(orgId, { cycle: v })}
              size="sm"
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "annual", label: "Annual" },
              ]}
            />
          </Field>
          <Field label="Custom price" hint="Blank uses the plan's list price.">
            <input
              type="number"
              className="wf-input"
              value={price}
              placeholder={String(sub.cycle === "annual" ? plan.annualPrice : plan.monthlyPrice)}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={() => updateSubscription(orgId, { customPrice: price === "" ? undefined : Number(price) })}
            />
          </Field>
          <Field label="Discount %">
            <input
              type="number"
              className="wf-input"
              value={discount}
              placeholder="0"
              onChange={(e) => setDiscount(e.target.value)}
              onBlur={() => updateSubscription(orgId, { discountPercent: discount === "" ? undefined : Number(discount) })}
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="When a limit is reached" hint="Applies to employee, project and manager ceilings.">
            <Segmented
              ariaLabel="Limit behaviour"
              value={sub.onLimitReached}
              onChange={(v) => updateSubscription(orgId, { onLimitReached: v })}
              size="sm"
              options={[
                { value: "block", label: "Block" },
                { value: "warn", label: "Warn only" },
                { value: "overage", label: "Overage" },
                { value: "auto-upgrade", label: "Auto-upgrade" },
              ]}
            />
          </Field>
          <Field label="Account credit" hint="Applied against the next invoice.">
            <input
              type="number"
              className="wf-input"
              value={sub.creditBalance}
              onChange={(e) => updateSubscription(orgId, { creditBalance: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>

      {/* base plan → overrides */}
      <div className="wf-card p-4">
        <SectionTitle>Limits — base plan → custom overrides</SectionTitle>
        <div className="wf-scroll-x">
          <table className="wf-table">
            <thead>
              <tr>
                <th>Limit</th>
                <th className="text-right">{plan.name} (base)</th>
                <th className="text-right">Override</th>
                <th className="text-right">Effective</th>
                <th aria-label="Reset" />
              </tr>
            </thead>
            <tbody>
              {LIMIT_ROWS.map(([key, label, unit]) => {
                const base = plan.limits[key];
                const override = sub.limitOverrides[key];
                const effective = ent.limits[key];
                const isOverridden = override !== undefined && override !== base;
                return (
                  <tr key={key}>
                    <td className="font-semibold">{label}</td>
                    <td className="text-right tabular-nums text-[var(--wf-muted)]">
                      {base === null ? "∞" : base}{unit ? ` ${unit}` : ""}
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        aria-label={`${label} override`}
                        className="wf-input ml-auto w-28 text-right"
                        placeholder="—"
                        value={(override as number | undefined) ?? ""}
                        onChange={(e) =>
                          overrideLimit(orgId, key, e.target.value === "" ? undefined : Number(e.target.value))
                        }
                      />
                    </td>
                    <td
                      className="text-right font-bold tabular-nums"
                      style={{ color: isOverridden ? "var(--wf-violet)" : "var(--wf-fg)" }}
                    >
                      {effective === null ? "∞" : effective}{unit ? ` ${unit}` : ""}
                    </td>
                    <td className="text-right">
                      {isOverridden && (
                        <button
                          className="wf-btn wf-btn-quiet wf-btn-sm"
                          onClick={() => overrideLimit(orgId, key, undefined)}
                          title="Reset to plan default"
                        >
                          <IRefresh size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* feature entitlements */}
      <div className="wf-card p-4">
        <SectionTitle>Feature entitlements</SectionTitle>
        <div className="grid gap-x-6 md:grid-cols-2">
          {(Object.keys(FEATURE_LABELS) as Array<keyof FeatureSet>).map((k) => {
            const base = plan.features[k];
            const effective = ent.features[k];
            const isOverridden = sub.featureOverrides[k] !== undefined && sub.featureOverrides[k] !== base;
            return (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-[var(--wf-line)] py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[0.84rem] font-semibold">
                    {FEATURE_LABELS[k]}
                    {isOverridden && (
                      <span className="ml-1.5 rounded bg-[rgba(167,139,250,0.16)] px-1 py-0.5 text-[0.56rem] font-bold text-[var(--wf-violet)]">
                        OVERRIDE
                      </span>
                    )}
                  </span>
                  <span className="block text-[0.66rem] text-[var(--wf-faint)]">
                    {plan.name}: {base ? "included" : "not included"}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {isOverridden && (
                    <button
                      className="wf-btn wf-btn-quiet wf-btn-sm"
                      onClick={() => overrideFeature(orgId, k, undefined)}
                      title="Reset to plan default"
                    >
                      <IRefresh size={12} />
                    </button>
                  )}
                  <Toggle
                    checked={effective}
                    onChange={(v) => overrideFeature(orgId, k, v === base ? undefined : v)}
                    label={FEATURE_LABELS[k]}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {sub.notes && (
          <p className="mt-3 border-t border-[var(--wf-line)] pt-2.5 text-[0.76rem] text-[var(--wf-muted)]">
            <strong className="text-[var(--wf-fg)]">Note.</strong> {sub.notes}
          </p>
        )}
      </div>
    </div>
  );
}

export { InvoicePill };
