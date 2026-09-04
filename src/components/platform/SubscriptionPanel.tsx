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

/* Date inputs speak ISO days; the store speaks milliseconds. Midnight local,
   because a renewal "on the 4th" means the 4th where the client is. */
const toDateInput = (ms?: number) =>
  ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : "";
const fromDateInput = (s: string) => new Date(`${s}T00:00:00`).getTime();

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
  const [credit, setCredit] = useState(String(sub?.creditBalance ?? 0));
  const [notes, setNotes] = useState(sub?.notes ?? "");
  const [trialDays, setTrialDays] = useState("14");

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
          <p className="wf-display mt-0.5 text-xl">
            {plan.name}
            {customised && (
              <span className="ml-2 rounded bg-[var(--wf-violet-soft)] px-1.5 py-0.5 align-middle text-[0.6rem] font-bold text-[var(--wf-violet)]">
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
              <label className="flex items-center gap-1.5 text-[0.74rem] text-[var(--wf-muted)]">
                Extend by
                <input
                  type="number"
                  min={1}
                  aria-label="Days to extend the trial by"
                  className="wf-input w-16 px-2 py-1 text-right"
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                />
                days
              </label>
              <button
                className="wf-btn wf-btn-ghost wf-btn-sm"
                disabled={!(Number(trialDays) > 0)}
                onClick={() => extendTrial(orgId, Math.round(Number(trialDays)))}
              >
                Extend trial
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
                  ? "border-[var(--wf-violet)] bg-[var(--wf-violet-soft)] text-[var(--wf-violet)]"
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
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
              onBlur={() => updateSubscription(orgId, { creditBalance: Number(credit) || 0 })}
            />
          </Field>
        </div>
      </div>

      {/* dates — set by hand when a deal says so, not only by the buttons */}
      <div className="wf-card p-4">
        <SectionTitle>Dates</SectionTitle>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Started">
            <input
              type="date"
              className="wf-input"
              value={toDateInput(sub.startedAt)}
              onChange={(e) =>
                e.target.value && updateSubscription(orgId, { startedAt: fromDateInput(e.target.value) })
              }
            />
          </Field>
          <Field label="Trial ends" hint="Blank when the account is not on trial.">
            <input
              type="date"
              className="wf-input"
              value={toDateInput(sub.trialEndsAt)}
              onChange={(e) =>
                updateSubscription(orgId, {
                  trialEndsAt: e.target.value ? fromDateInput(e.target.value) : undefined,
                })
              }
            />
          </Field>
          <Field label="Renews on" hint="The next invoice is raised for this date.">
            <input
              type="date"
              className="wf-input"
              value={toDateInput(sub.renewsAt)}
              onChange={(e) =>
                e.target.value && updateSubscription(orgId, { renewsAt: fromDateInput(e.target.value) })
              }
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
        <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
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
                      <span className="ml-1.5 rounded bg-[var(--wf-violet-soft)] px-1 py-0.5 text-[0.56rem] font-bold text-[var(--wf-violet)]">
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
      </div>

      {/* why this client is set up the way it is */}
      <div className="wf-card p-4">
        <SectionTitle>Notes</SectionTitle>
        <Field label="Account notes" hint="Why this client is configured this way. Seen here only.">
          <textarea
            className="wf-input min-h-24"
            value={notes}
            placeholder="Negotiated terms, who agreed them, what was promised…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => updateSubscription(orgId, { notes: notes.trim() || undefined })}
          />
        </Field>
      </div>
    </div>
  );
}

export { InvoicePill };
