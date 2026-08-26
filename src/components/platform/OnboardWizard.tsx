"use client";

/**
 * Five-step client onboarding: company → primary admin → subscription →
 * customisation → review. Nothing is written until the final step, so a
 * half-finished wizard never leaves a partial tenant behind.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePlatform } from "@/lib/platform-store";
import type { FeatureSet, PlanLimits } from "@/lib/saas-types";
import { FEATURE_LABELS } from "@/lib/saas-types";
import { BottomSheet, Field, Segmented, Toggle } from "@/components/ui";
import { money } from "@/lib/saas-metrics";
import { ICheck, ICheckCircle } from "@/components/WfIcons";

const STEPS = ["Company", "Admin", "Subscription", "Branding", "Review"] as const;

export function OnboardWizard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { platform, onboardClient } = usePlatform();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);

  /* step 1 */
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [industry, setIndustry] = useState("Civil construction");
  const [website, setWebsite] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("India");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");

  /* step 2 */
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminRole, setAdminRole] = useState("Client Owner");
  const [invite, setInvite] = useState(true);

  /* step 3 */
  const [planId, setPlanId] = useState(platform.platformSettings.defaultPlanId);
  const [cycle, setCycle] = useState<"monthly" | "annual">("annual");
  const [trialDays, setTrialDays] = useState(platform.platformSettings.defaultTrialDays);
  const [limits, setLimits] = useState<Partial<PlanLimits>>({});

  /* step 4 */
  const [appName, setAppName] = useState("Workfence");
  const [accent, setAccent] = useState("#f6a723");
  const [customDomain, setCustomDomain] = useState("");
  const [features, setFeatures] = useState<Partial<FeatureSet>>({});

  const plan = platform.plans.find((p) => p.id === planId);

  const reset = () => {
    setStep(0);
    setErr("");
    setCreated(null);
    setName(""); setCode(""); setWebsite(""); setContactName("");
    setContactEmail(""); setContactPhone(""); setAddressLine(""); setCity("");
    setAdminName(""); setAdminEmail(""); setAdminPhone("");
    setLimits({}); setFeatures({}); setCustomDomain("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const next = () => {
    setErr("");
    if (step === 0) {
      if (name.trim().length < 3) return setErr("Enter the company name.");
      if (!contactEmail.includes("@")) return setErr("Enter a valid contact email.");
    }
    if (step === 1) {
      if (adminName.trim().length < 3) return setErr("Enter the admin's name.");
      if (!adminEmail.includes("@")) return setErr("Enter a valid admin email.");
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const create = () => {
    if (!plan) return;
    const org = onboardClient({
      org: {
        name: name.trim(),
        code: code.trim() || `CL-${1000 + platform.organizations.length + 1}`,
        industry,
        website: website.trim(),
        contactName: contactName.trim() || adminName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        country,
        timezone,
        billing: {
          legalName: name.trim(),
          contactName: contactName.trim() || adminName.trim(),
          email: contactEmail.trim(),
          phone: contactPhone.trim(),
          addressLine: addressLine.trim(),
          city: city.trim(),
          state: "",
          postcode: "",
          country,
          taxIdLabel: country === "India" ? "GSTIN" : "VAT / Tax ID",
          taxId: "",
          taxPercent: country === "India" ? 18 : 0,
          currency,
          paymentMethod: "Not set",
        },
        branding: {
          appName: appName.trim() || "Workfence",
          accent,
          logoText: name.trim().split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase(),
          customDomain: customDomain.trim() || undefined,
        },
      },
      admin: { name: adminName.trim(), email: adminEmail.trim(), phone: adminPhone.trim(), role: adminRole },
      planId,
      cycle,
      trialDays,
      limitOverrides: limits,
      featureOverrides: features,
    });
    setCreated({ id: org.id, code: org.code });
  };

  /* ---------------------------------------------------------- rendering */

  if (created) {
    return (
      <BottomSheet open={open} onClose={close} title="Client onboarded" tall wide>
        <div className="flex flex-col gap-4 text-center">
          <ICheckCircle size={44} className="mx-auto text-[var(--wf-green)]" />
          <div>
            <p className="wf-display text-lg font-bold">Client successfully onboarded</p>
            <p className="mt-1 text-[0.82rem] text-[var(--wf-muted)]">
              {name} is live on {plan?.name}
              {trialDays > 0 ? ` with a ${trialDays}-day trial` : ""}.
            </p>
          </div>
          <dl className="wf-card2 divide-y divide-[var(--wf-line)] text-left text-[0.8rem]">
            {[
              ["Client ID", created.code],
              ["Admin account", `${adminName} · ${adminEmail}`],
              ["Subscription", `${plan?.name} (${cycle})`],
              ["Billing status", trialDays > 0 ? "Trial — no invoice yet" : "Invoice on first cycle"],
              ["Login URL", `workfence.app/${created.code.toLowerCase()}`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-[var(--wf-muted)]">{k}</dt>
                <dd className="min-w-0 truncate text-right font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2.5">
            <button className="wf-btn wf-btn-ghost flex-1" onClick={close}>
              Done
            </button>
            <button
              className="wf-btn wf-btn-primary flex-1"
              onClick={() => {
                const id = created.id;
                close();
                router.push(`/platform/client?id=${id}`);
              }}
            >
              Open client
            </button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet open={open} onClose={close} title={`Onboard client — ${STEPS[step]}`} tall wide>
      <div className="flex flex-col gap-4">
        {/* stepper */}
        <ol className="flex items-center gap-1.5" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-1.5">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.66rem] font-bold ${
                  i < step
                    ? "bg-[var(--wf-green)] text-[#06210f]"
                    : i === step
                      ? "bg-[var(--wf-violet)] text-[#1b1030]"
                      : "bg-[var(--wf-surface3)] text-[var(--wf-faint)]"
                }`}
              >
                {i < step ? <ICheck size={12} /> : i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span className={`h-px flex-1 ${i < step ? "bg-[var(--wf-green)]" : "bg-[var(--wf-line)]"}`} />
              )}
            </li>
          ))}
        </ol>

        {err ? (
          <p className="text-[0.8rem] font-semibold text-[var(--wf-red)]">{err}</p>
        ) : null}

        {step === 0 && (
          <div className="flex flex-col gap-3.5">
            <Field label="Company name" required>
              <input className="wf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Orbit Infra Projects" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company ID"><input className="wf-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto" /></Field>
              <Field label="Industry">
                <select className="wf-input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  {["Civil construction", "Commercial towers", "Residential", "Industrial plants", "Highways", "Interiors", "Bridges", "Earthworks"].map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Website"><input className="wf-input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="www.example.in" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primary contact"><input className="wf-input" value={contactName} onChange={(e) => setContactName(e.target.value)} /></Field>
              <Field label="Contact phone"><input className="wf-input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></Field>
            </div>
            <Field label="Contact email" required>
              <input className="wf-input" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="admin@example.in" />
            </Field>
            <Field label="Billing address"><input className="wf-input" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="City"><input className="wf-input" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
              <Field label="Country">
                <select className="wf-input" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {["India", "United Arab Emirates", "Singapore", "United States"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Currency">
                <select className="wf-input" value={currency} onChange={(e) => setCurrency(e.target.value as "INR" | "USD")}>
                  <option value="INR">INR ₹</option>
                  <option value="USD">USD $</option>
                </select>
              </Field>
            </div>
            <Field label="Time zone">
              <select className="wf-input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "America/New_York"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3.5">
            <p className="text-[0.8rem] text-[var(--wf-muted)]">
              This account becomes the client&apos;s first admin and can invite their own managers.
            </p>
            <Field label="Full name" required><input className="wf-input" value={adminName} onChange={(e) => setAdminName(e.target.value)} /></Field>
            <Field label="Email" required><input className="wf-input" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone"><input className="wf-input" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} /></Field>
              <Field label="Role">
                <select className="wf-input" value={adminRole} onChange={(e) => setAdminRole(e.target.value)}>
                  {["Client Owner", "Admin"].map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
            </div>
            <div className="wf-card2 flex items-center justify-between gap-3 px-3.5 py-3">
              <div>
                <p className="text-sm font-semibold">Send an invitation email</p>
                <p className="text-[0.72rem] text-[var(--wf-muted)]">
                  They set their own password — no credential is ever shown here.
                </p>
              </div>
              <Toggle checked={invite} onChange={setInvite} label="Send invitation email" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3.5">
            <div>
              <span className="wf-label">Subscription plan</span>
              <div className="flex flex-col gap-2">
                {platform.plans.filter((p) => !p.archived).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPlanId(p.id)}
                    className={`cursor-pointer rounded-xl border px-3.5 py-3 text-left transition ${
                      planId === p.id
                        ? "border-[var(--wf-violet)] bg-[rgba(167,139,250,0.1)]"
                        : "border-[var(--wf-line)] bg-[var(--wf-surface2)]"
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-bold">{p.name}</span>
                      <span className="text-[0.8rem] font-bold tabular-nums">
                        {money(cycle === "annual" ? p.annualPrice : p.monthlyPrice, p.currency)}
                        <span className="text-[0.68rem] font-normal text-[var(--wf-muted)]">/{cycle === "annual" ? "yr" : "mo"}</span>
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[0.72rem] text-[var(--wf-muted)]">{p.description}</span>
                    <span className="mt-1 block text-[0.68rem] text-[var(--wf-faint)]">
                      {p.limits.employees ?? "Unlimited"} employees · {p.limits.projects ?? "Unlimited"} projects · {p.limits.managers ?? "Unlimited"} managers
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Billing cycle">
                <Segmented
                  ariaLabel="Billing cycle"
                  value={cycle}
                  onChange={setCycle}
                  size="sm"
                  options={[
                    { value: "monthly", label: "Monthly" },
                    { value: "annual", label: "Annual" },
                  ]}
                />
              </Field>
              <Field label={`Trial — ${trialDays} days`}>
                <input type="range" min={0} max={45} step={1} value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} className="w-full accent-[var(--wf-violet)]" />
              </Field>
            </div>
            <div className="wf-card2 p-3.5">
              <p className="mb-2 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                Override plan limits for this client (optional)
              </p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ["employees", "Employees"],
                  ["managers", "Managers"],
                  ["projects", "Projects"],
                  ["storageGb", "Storage (GB)"],
                ] as Array<[keyof PlanLimits, string]>).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <input
                      type="number"
                      className="wf-input"
                      placeholder={String(plan?.limits[k] ?? "Unlimited")}
                      value={(limits[k] as number | undefined) ?? ""}
                      onChange={(e) =>
                        setLimits((l) => {
                          const next = { ...l };
                          if (e.target.value === "") delete next[k];
                          else (next[k] as number) = Number(e.target.value);
                          return next;
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="App name (in-product)"><input className="wf-input" value={appName} onChange={(e) => setAppName(e.target.value)} /></Field>
              <Field label="Brand accent">
                <input type="color" className="wf-input h-12 p-1" value={accent} onChange={(e) => setAccent(e.target.value)} />
              </Field>
            </div>
            <Field label="Custom domain" hint="Requires a plan with the custom-domain feature.">
              <input className="wf-input" value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="sites.example.in" />
            </Field>
            <div className="wf-card2 p-3.5">
              <p className="mb-2 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                Feature availability — overrides the plan for this client only
              </p>
              <div className="flex flex-col divide-y divide-[var(--wf-line)]">
                {(Object.keys(FEATURE_LABELS) as Array<keyof FeatureSet>).map((k) => {
                  const planHas = plan?.features[k] ?? false;
                  const effective = features[k] ?? planHas;
                  return (
                    <div key={k} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[0.82rem] font-semibold">{FEATURE_LABELS[k]}</span>
                        <span className="block text-[0.64rem] text-[var(--wf-faint)]">
                          {plan?.name}: {planHas ? "included" : "not included"}
                          {features[k] !== undefined && features[k] !== planHas ? " · overridden" : ""}
                        </span>
                      </span>
                      <Toggle
                        checked={effective}
                        onChange={(v) =>
                          setFeatures((f) => {
                            const next = { ...f };
                            if (v === planHas) delete next[k];
                            else next[k] = v;
                            return next;
                          })
                        }
                        label={FEATURE_LABELS[k]}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-3">
            {[
              ["Company", `${name || "—"} · ${industry}`],
              ["Client ID", code || "auto-assigned"],
              ["Primary contact", `${contactName || adminName || "—"} · ${contactEmail || "—"}`],
              ["Location", `${city || "—"}, ${country} · ${timezone}`],
              ["Primary admin", `${adminName || "—"} (${adminRole})${invite ? " · invite email" : ""}`],
              ["Plan", `${plan?.name ?? "—"} · ${cycle} · ${money(cycle === "annual" ? plan?.annualPrice ?? 0 : plan?.monthlyPrice ?? 0, plan?.currency)}`],
              ["Trial", trialDays > 0 ? `${trialDays} days` : "No trial — bills immediately"],
              ["Limit overrides", Object.keys(limits).length ? Object.entries(limits).map(([k, v]) => `${k}: ${v}`).join(", ") : "None — plan defaults"],
              ["Feature overrides", Object.keys(features).length ? Object.keys(features).map((k) => FEATURE_LABELS[k as keyof FeatureSet]).join(", ") : "None — plan defaults"],
              ["Branding", `${appName} · ${accent}${customDomain ? ` · ${customDomain}` : ""}`],
            ].map(([k, v]) => (
              <div key={k} className="wf-card2 flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                <span className="shrink-0 text-[0.74rem] text-[var(--wf-muted)]">{k}</span>
                <span className="min-w-0 text-right text-[0.82rem] font-semibold">{v}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2.5 pt-1">
          {step > 0 && (
            <button className="wf-btn wf-btn-ghost flex-1" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          {step < 4 ? (
            <button className="wf-btn wf-btn-primary flex-1" onClick={next}>
              Next — {STEPS[step + 1]}
            </button>
          ) : (
            <button className="wf-btn wf-btn-primary flex-1" onClick={create}>
              Create client account
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
