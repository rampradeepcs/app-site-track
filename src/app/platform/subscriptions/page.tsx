"use client";

/** Plan catalogue — create, edit and archive the subscription plans on sale. */

import { useState } from "react";
import { PageHead } from "@/components/platform/PlatformShell";
import { BottomSheet, Field, Toggle } from "@/components/ui";
import { usePlatform } from "@/lib/platform-store";
import { money } from "@/lib/saas-metrics";
import type { FeatureSet, Plan, PlanLimits, SupportLevel } from "@/lib/saas-types";
import { FEATURE_LABELS } from "@/lib/saas-types";
import { IPlus } from "@/components/WfIcons";

export default function SubscriptionsPage() {
  const { platform, savePlan, archivePlan } = usePlatform();
  const [editing, setEditing] = useState<Plan | "new" | null>(null);

  const subsFor = (planId: string) =>
    platform.subscriptions.filter((s) => s.planId === planId).length;

  return (
    <div className="pb-10">
      <PageHead
        title="Subscriptions"
        sub={`${platform.plans.filter((p) => !p.archived).length} plans on sale · ${platform.subscriptions.length} active subscriptions`}
        action={
          <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={() => setEditing("new")}>
            <IPlus size={15} /> New plan
          </button>
        }
      />
      <div className="grid grid-cols-1 gap-4 px-5 lg:grid-cols-3">
        {platform.plans.map((p) => (
          <div key={p.id} className={`wf-card flex flex-col p-4 ${p.archived ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="wf-display truncate text-lg font-bold">{p.name}</h2>
                <p className="text-[0.74rem] text-[var(--wf-muted)]">{p.description}</p>
              </div>
              {p.archived && (
                <span className="shrink-0 rounded bg-[var(--wf-surface3)] px-1.5 py-0.5 text-[0.58rem] font-bold text-[var(--wf-faint)]">
                  ARCHIVED
                </span>
              )}
            </div>

            <p className="wf-display mt-3 text-2xl font-bold">
              {money(p.monthlyPrice, p.currency)}
              <span className="text-[0.8rem] font-normal text-[var(--wf-muted)]">/mo</span>
            </p>
            <p className="text-[0.72rem] text-[var(--wf-faint)]">
              or {money(p.annualPrice, p.currency)}/yr · {p.trialDays}-day trial · {p.supportLevel} support
            </p>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-y border-[var(--wf-line)] py-2.5 text-[0.74rem]">
              {([
                ["Employees", p.limits.employees],
                ["Managers", p.limits.managers],
                ["Projects", p.limits.projects],
                ["Storage", p.limits.storageGb ? `${p.limits.storageGb} GB` : null],
              ] as Array<[string, number | string | null]>).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-[var(--wf-muted)]">{k}</dt>
                  <dd className="font-semibold tabular-nums">{v ?? "Unlimited"}</dd>
                </div>
              ))}
            </dl>

            <ul className="mt-2.5 flex flex-1 flex-col gap-1 text-[0.74rem]">
              {(Object.keys(FEATURE_LABELS) as Array<keyof FeatureSet>)
                .filter((k) => p.features[k])
                .map((k) => (
                  <li key={k} className="flex items-center gap-1.5 text-[var(--wf-muted)]">
                    <span className="text-[var(--wf-green)]">✓</span> {FEATURE_LABELS[k]}
                  </li>
                ))}
            </ul>

            <p className="mt-3 text-[0.7rem] text-[var(--wf-faint)]">
              {subsFor(p.id)} client{subsFor(p.id) === 1 ? "" : "s"} on this plan
            </p>
            <div className="mt-2 flex gap-2">
              <button className="wf-btn wf-btn-ghost wf-btn-sm flex-1" onClick={() => setEditing(p)}>
                Edit
              </button>
              <button
                className="wf-btn wf-btn-quiet wf-btn-sm"
                onClick={() => archivePlan(p.id, !p.archived)}
              >
                {p.archived ? "Restore" : "Archive"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <PlanEditor
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={(patch, id) => {
          savePlan(patch, id);
          setEditing(null);
        }}
      />
    </div>
  );
}

function PlanEditor({
  editing,
  onClose,
  onSave,
}: {
  editing: Plan | "new" | null;
  onClose: () => void;
  onSave: (p: Partial<Plan> & { name: string }, id?: string) => void;
}) {
  const base = editing !== "new" && editing ? editing : null;
  const [name, setName] = useState(base?.name ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [monthly, setMonthly] = useState(String(base?.monthlyPrice ?? 10000));
  const [annual, setAnnual] = useState(String(base?.annualPrice ?? 100000));
  const [currency, setCurrency] = useState<"INR" | "USD">(base?.currency ?? "INR");
  const [trialDays, setTrialDays] = useState(base?.trialDays ?? 14);
  const [support, setSupport] = useState<SupportLevel>(base?.supportLevel ?? "standard");
  const [limits, setLimits] = useState<PlanLimits>(
    base?.limits ?? {
      employees: 50,
      managers: 2,
      projects: 5,
      storageGb: 25,
      routeRetentionDays: 30,
      apiCallsPerMonth: 0,
    },
  );
  const [features, setFeatures] = useState<FeatureSet>(
    base?.features ?? {
      attendance: true,
      geofencing: true,
      liveTracking: true,
      routePlayback: false,
      workUpdates: false,
      shifts: true,
      breaks: true,
      overtime: false,
      salary: false,
      payroll: false,
      voiceNotes: true,
      petrolAllowance: false,
      foodAllowance: false,
      performance: false,
      advancedReports: false,
      dataExport: false,
      apiAccess: false,
      customBranding: false,
      customDomain: false,
      prioritySupport: false,
    },
  );
  const [err, setErr] = useState("");

  return (
    <BottomSheet
      open={editing !== null}
      onClose={onClose}
      title={base ? `Edit plan — ${base.name}` : "Create plan"}
      tall
      wide
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Plan name" required>
          <input className="wf-input" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} />
        </Field>
        {err ? <p className="-mt-2 text-[0.78rem] font-semibold text-[var(--wf-red)]">{err}</p> : null}
        <Field label="Description">
          <textarea className="wf-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Monthly price"><input type="number" className="wf-input" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
          <Field label="Annual price"><input type="number" className="wf-input" value={annual} onChange={(e) => setAnnual(e.target.value)} /></Field>
          <Field label="Currency">
            <select className="wf-input" value={currency} onChange={(e) => setCurrency(e.target.value as "INR" | "USD")}>
              <option value="INR">INR ₹</option>
              <option value="USD">USD $</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Trial — ${trialDays} days`}>
            <input type="range" min={0} max={45} value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} className="w-full accent-[var(--wf-violet)]" />
          </Field>
          <Field label="Support level">
            <select className="wf-input" value={support} onChange={(e) => setSupport(e.target.value as SupportLevel)}>
              {(["community", "standard", "priority", "dedicated"] as SupportLevel[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="wf-card2 p-3.5">
          <p className="mb-2.5 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            Limits — leave blank for unlimited
          </p>
          <div className="grid grid-cols-2 gap-3">
            {([
              ["employees", "Max employees"],
              ["managers", "Max managers"],
              ["projects", "Max projects"],
              ["storageGb", "Max storage (GB)"],
              ["routeRetentionDays", "Route retention (days)"],
              ["apiCallsPerMonth", "API calls / month"],
            ] as Array<[keyof PlanLimits, string]>).map(([k, label]) => (
              <Field key={k} label={label}>
                <input
                  type="number"
                  className="wf-input"
                  placeholder="Unlimited"
                  value={limits[k] === null ? "" : String(limits[k])}
                  onChange={(e) =>
                    setLimits((l) => ({
                      ...l,
                      [k]: e.target.value === "" ? (k === "routeRetentionDays" || k === "apiCallsPerMonth" ? 0 : null) : Number(e.target.value),
                    }))
                  }
                />
              </Field>
            ))}
          </div>
        </div>

        <div className="wf-card2 p-3.5">
          <p className="mb-1 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            Feature access
          </p>
          <div className="flex flex-col divide-y divide-[var(--wf-line)]">
            {(Object.keys(FEATURE_LABELS) as Array<keyof FeatureSet>).map((k) => (
              <div key={k} className="flex items-center justify-between gap-3 py-2">
                <span className="text-[0.84rem] font-semibold">{FEATURE_LABELS[k]}</span>
                <Toggle
                  checked={features[k]}
                  onChange={(v) => setFeatures((f) => ({ ...f, [k]: v }))}
                  label={FEATURE_LABELS[k]}
                />
              </div>
            ))}
          </div>
        </div>

        <button
          className="wf-btn wf-btn-primary"
          onClick={() => {
            if (name.trim().length < 2) {
              setErr("Give the plan a name.");
              return;
            }
            onSave(
              {
                name: name.trim(),
                description: description.trim(),
                monthlyPrice: Number(monthly) || 0,
                annualPrice: Number(annual) || 0,
                currency,
                trialDays,
                supportLevel: support,
                limits,
                features,
              },
              base?.id,
            );
          }}
        >
          {base ? "Save plan" : "Create plan"}
        </button>
      </div>
    </BottomSheet>
  );
}
