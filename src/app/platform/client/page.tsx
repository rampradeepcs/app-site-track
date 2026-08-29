"use client";

/**
 * Client account — the Super Admin's full view of one tenant, across
 * overview, organisation, users, projects, subscription, billing, usage,
 * activity and configuration.
 */

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHead } from "@/components/platform/PlatformShell";
import {
  HealthPill,
  InvoicePill,
  MetricCard,
  StatusPill,
  UsageMeter,
} from "@/components/platform/bits";
import { SubscriptionPanel } from "@/components/platform/SubscriptionPanel";
import { BarTrend } from "@/components/charts";
import {
  Avatar,
  BottomSheet,
  Chip,
  Field,
  SectionTitle,
  Segmented,
  useNowTick,
} from "@/components/ui";
import { entitlementsFor } from "@/lib/entitlements";
import { fmtDateLong, fmtRelative } from "@/lib/format";
import { usePlatform } from "@/lib/platform-store";
import {
  clientHealth,
  invoicesFor,
  latestUsage,
  money,
  usageHistory,
  utilisationFor,
} from "@/lib/saas-metrics";
import { useWorkforce } from "@/lib/store";
import { IAlert, IArrowR, ICheckCircle, IShield, IUsers } from "@/components/WfIcons";

type Tab =
  | "overview"
  | "organization"
  | "users"
  | "projects"
  | "subscription"
  | "billing"
  | "usage"
  | "activity"
  | "configuration";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "organization", label: "Organisation" },
  { value: "users", label: "Users" },
  { value: "projects", label: "Projects" },
  { value: "subscription", label: "Subscription" },
  { value: "billing", label: "Billing" },
  { value: "usage", label: "Usage" },
  { value: "activity", label: "Activity" },
  { value: "configuration", label: "Configuration" },
];

export default function ClientPage() {
  return (
    <Suspense fallback={<div className="px-5 pt-8 text-sm text-[var(--wf-muted)]">Loading…</div>}>
      <ClientInner />
    </Suspense>
  );
}

function ClientInner() {
  const {
    platform,
    setOrgStatus,
    updateOrg,
    updateBilling,
    setInvoiceStatus,
    startImpersonation,
  } = usePlatform();
  const { state } = useWorkforce();
  const params = useSearchParams();
  const router = useRouter();
  const now = useNowTick(60);

  const id = params.get("id") ?? "";
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? "overview");
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState("");

  const org = platform.organizations.find((o) => o.id === id);
  const sub = platform.subscriptions.find((s) => s.orgId === id);
  const ent = useMemo(() => entitlementsFor(platform, id), [platform, id]);
  const usage = useMemo(() => latestUsage(platform, id), [platform, id]);
  const util = useMemo(() => utilisationFor(platform, id), [platform, id]);
  const health = useMemo(() => clientHealth(platform, id, now), [platform, id, now]);
  const invoices = useMemo(() => invoicesFor(platform, id), [platform, id]);
  const history = useMemo(() => usageHistory(platform, id), [platform, id]);
  const audit = useMemo(
    () => platform.platformAudit.filter((a) => a.orgId === id),
    [platform.platformAudit, id],
  );
  const tickets = platform.tickets.filter((t) => t.orgId === id);

  // Tenant-scoped: only this client's workforce records are ever read.
  const orgUsers = state.users.filter((u) => u.orgId === id);
  const orgProjects = state.projects.filter((p) => p.orgId === id);

  if (!org) {
    return (
      <div className="px-5 pt-10 text-center text-sm text-[var(--wf-muted)]">
        Client not found.{" "}
        <Link href="/platform/clients" className="font-semibold text-[var(--wf-violet)]">
          Back to clients
        </Link>
      </div>
    );
  }

  const setTabAndUrl = (t: Tab) => {
    setTab(t);
    router.replace(`/platform/client?id=${id}${t === "overview" ? "" : `&tab=${t}`}`);
  };

  return (
    <div className="pb-10">
      <PageHead
        back={{ href: "/platform/clients", label: "All clients" }}
        title={org.name}
        sub={`${org.code} · ${org.industry} · ${org.billing.city || org.country}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={org.status} />
            <HealthPill score={health.score} />
            {org.status === "suspended" ? (
              <button
                className="wf-btn wf-btn-ghost wf-btn-sm"
                onClick={() => setOrgStatus(org.id, "active")}
              >
                <ICheckCircle size={14} /> Reactivate
              </button>
            ) : (
              <button
                className="wf-btn wf-btn-ghost wf-btn-sm"
                onClick={() => setSuspendOpen(true)}
              >
                <IAlert size={14} /> Suspend
              </button>
            )}
            <button
              className="wf-btn wf-btn-primary wf-btn-sm"
              onClick={() => setImpersonateOpen(true)}
            >
              <IShield size={14} /> Log in as client admin
            </button>
          </div>
        }
      />

      <div className="px-5">
        <div className="wf-scroll-x -mx-1 px-1 pb-1">
          <Segmented<Tab> ariaLabel="Client sections" value={tab} onChange={setTabAndUrl} size="sm" options={TABS} />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-5 px-5">
        {/* ------------------------------------------------------ overview */}
        {tab === "overview" && (
          <>
            {org.status === "suspended" && org.suspendedReason && (
              <p className="wf-inset border-[var(--wf-red-edge)] px-4 py-3 text-[0.82rem] font-semibold text-[var(--wf-red)]">
                Suspended — {org.suspendedReason}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Plan" value={ent.planName} sub={sub ? `${sub.cycle} · renews ${fmtDateLong(sub.renewsAt)}` : "—"} tone="violet" />
              <MetricCard label="Employees" value={usage?.employees ?? 0} sub={ent.limits.employees ? `of ${ent.limits.employees}` : "unlimited"} tone="blue" />
              <MetricCard label="Active projects" value={usage?.projects ?? 0} sub={`${usage?.managers ?? 0} managers`} />
              <MetricCard label="Health" value={health.score} sub={health.band} tone={health.score >= 65 ? "green" : "amber"} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="wf-card p-4">
                <SectionTitle>Health signals</SectionTitle>
                <ul className="flex flex-col gap-1.5">
                  {health.signals.map((s, i) => (
                    <li key={i} className="flex items-center gap-2 text-[0.8rem]">
                      <i
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background:
                            s.tone === "good" ? "var(--wf-green)" : s.tone === "warn" ? "var(--wf-amber)" : "var(--wf-red)",
                        }}
                      />
                      <span className="text-[var(--wf-muted)]">{s.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="wf-card p-4">
                <SectionTitle>Utilisation</SectionTitle>
                <div className="flex flex-col gap-3">
                  <UsageMeter label="Employees" state={util.employees} />
                  <UsageMeter label="Projects" state={util.projects} />
                  <UsageMeter label="Managers" state={util.managers} />
                </div>
              </div>
              <div className="wf-card p-4">
                <SectionTitle>Primary contact</SectionTitle>
                <p className="text-[0.9rem] font-semibold">{org.contactName}</p>
                <p className="text-[0.78rem] text-[var(--wf-muted)]">{org.contactEmail}</p>
                <p className="text-[0.78rem] text-[var(--wf-muted)]">{org.contactPhone}</p>
                <p className="mt-2 border-t border-[var(--wf-line)] pt-2 text-[0.72rem] text-[var(--wf-faint)]">
                  Client since {fmtDateLong(org.createdAt)} · {org.timezone}
                </p>
                {tickets.filter((t) => t.status !== "resolved").length > 0 && (
                  <Link href="/platform/support" className="mt-2 flex items-center gap-1 text-[0.76rem] font-semibold text-[var(--wf-amber)]">
                    {tickets.filter((t) => t.status !== "resolved").length} open support ticket(s) <IArrowR size={12} />
                  </Link>
                )}
              </div>
            </div>
          </>
        )}

        {/* -------------------------------------------------- organisation */}
        {tab === "organization" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="wf-card p-4">
              <SectionTitle>Company</SectionTitle>
              <div className="flex flex-col gap-3">
                <Field label="Company name">
                  <input className="wf-input" value={org.name} onChange={(e) => updateOrg(org.id, { name: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Client ID"><input className="wf-input" value={org.code} readOnly /></Field>
                  <Field label="Industry">
                    <input className="wf-input" value={org.industry} onChange={(e) => updateOrg(org.id, { industry: e.target.value })} />
                  </Field>
                </div>
                <Field label="Website">
                  <input className="wf-input" value={org.website} onChange={(e) => updateOrg(org.id, { website: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Contact name">
                    <input className="wf-input" value={org.contactName} onChange={(e) => updateOrg(org.id, { contactName: e.target.value })} />
                  </Field>
                  <Field label="Contact phone">
                    <input className="wf-input" value={org.contactPhone} onChange={(e) => updateOrg(org.id, { contactPhone: e.target.value })} />
                  </Field>
                </div>
                <Field label="Contact email">
                  <input className="wf-input" value={org.contactEmail} onChange={(e) => updateOrg(org.id, { contactEmail: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="wf-card p-4">
              <SectionTitle>Billing profile</SectionTitle>
              <div className="flex flex-col gap-3">
                <Field label="Legal name">
                  <input className="wf-input" value={org.billing.legalName} onChange={(e) => updateBilling(org.id, { legalName: e.target.value })} />
                </Field>
                <Field label="Billing email">
                  <input className="wf-input" value={org.billing.email} onChange={(e) => updateBilling(org.id, { email: e.target.value })} />
                </Field>
                <Field label="Billing address">
                  <input className="wf-input" value={org.billing.addressLine} onChange={(e) => updateBilling(org.id, { addressLine: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City"><input className="wf-input" value={org.billing.city} onChange={(e) => updateBilling(org.id, { city: e.target.value })} /></Field>
                  <Field label="Country"><input className="wf-input" value={org.billing.country} onChange={(e) => updateBilling(org.id, { country: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Tax ID label" hint="GSTIN, VAT, EIN…">
                    <input className="wf-input" value={org.billing.taxIdLabel} onChange={(e) => updateBilling(org.id, { taxIdLabel: e.target.value })} />
                  </Field>
                  <Field label={org.billing.taxIdLabel || "Tax ID"}>
                    <input className="wf-input" value={org.billing.taxId} onChange={(e) => updateBilling(org.id, { taxId: e.target.value })} />
                  </Field>
                  <Field label="Tax %">
                    <input type="number" className="wf-input" value={org.billing.taxPercent} onChange={(e) => updateBilling(org.id, { taxPercent: Number(e.target.value) })} />
                  </Field>
                </div>
                <Field label="Payment method">
                  <input className="wf-input" value={org.billing.paymentMethod} onChange={(e) => updateBilling(org.id, { paymentMethod: e.target.value })} />
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- users */}
        {tab === "users" && (
          <div className="wf-card overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4">
              <SectionTitle>People in this organisation</SectionTitle>
              <span className="text-[0.74rem] text-[var(--wf-muted)]">{orgUsers.length} records</span>
            </div>
            {orgUsers.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[var(--wf-muted)]">
                <IUsers size={24} className="mx-auto mb-2" />
                Nobody has been added to this tenant yet — their admin
                invites their crew from inside their own workspace.
              </p>
            ) : (
              <div className="wf-scroll-x">
                <table className="wf-table">
                  <thead>
                    <tr><th>Name</th><th>Role</th><th>Designation</th><th>Department</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {orgUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <span className="flex items-center gap-2">
                            <Avatar name={u.name} hue={u.avatarHue} size={26} />
                            <span className="font-semibold">{u.name}</span>
                          </span>
                        </td>
                        <td><Chip tone={u.role === "manager" ? "amber" : "blue"}>{u.role}</Chip></td>
                        <td className="text-[var(--wf-muted)]">{u.designation}</td>
                        <td className="text-[var(--wf-muted)]">{u.department}</td>
                        <td className="capitalize text-[var(--wf-muted)]">{u.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------- projects */}
        {tab === "projects" && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {orgProjects.length === 0 && (
              <p className="wf-card px-4 py-10 text-center text-sm text-[var(--wf-muted)] lg:col-span-2">
                No projects visible for this tenant.
              </p>
            )}
            {orgProjects.map((p) => (
              <div key={p.id} className="wf-card min-w-0 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="wf-display truncate">{p.name}</p>
                    <p className="truncate text-[0.74rem] text-[var(--wf-muted)]">{p.code} · {p.address}</p>
                  </div>
                  <Chip tone={p.status === "active" ? "green" : "neutral"}>{p.status}</Chip>
                </div>
                <p className="mt-2 text-[0.72rem] text-[var(--wf-faint)]">
                  {p.employeeIds.length} assigned · {p.zones.length} zones · {p.geofence.kind} geofence
                </p>
              </div>
            ))}
          </div>
        )}

        {/* --------------------------------------------------- subscription */}
        {tab === "subscription" && <SubscriptionPanel orgId={org.id} />}

        {/* -------------------------------------------------------- billing */}
        {tab === "billing" && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Invoices" value={invoices.length} />
              <MetricCard
                label="Outstanding"
                value={money(invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled" && i.status !== "refunded").reduce((t, i) => t + i.amount + i.taxAmount, 0), org.billing.currency)}
                tone="amber"
              />
              <MetricCard label="Credit balance" value={money(sub?.creditBalance ?? 0, org.billing.currency)} tone={sub?.creditBalance ? "green" : "neutral"} />
              <MetricCard label="Next billing" value={sub ? fmtDateLong(sub.renewsAt) : "—"} />
            </div>
            <div className="wf-card overflow-hidden">
              <div className="wf-scroll-x">
                <table className="wf-table">
                  <thead>
                    <tr><th>Invoice</th><th>Period</th><th className="text-right">Amount</th><th>Issued</th><th>Due</th><th>Status</th><th>Method</th><th aria-label="Actions" /></tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-semibold">{inv.number}</td>
                        <td className="text-[var(--wf-muted)]">{inv.periodLabel}</td>
                        <td className="text-right tabular-nums">
                          {money(inv.amount + inv.taxAmount, inv.currency)}
                          <span className="block text-[0.62rem] text-[var(--wf-faint)]">incl. tax {money(inv.taxAmount, inv.currency)}</span>
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
                          {inv.status !== "paid" && inv.status !== "refunded" && inv.status !== "cancelled" && (
                            <button className="wf-btn wf-btn-quiet wf-btn-sm" onClick={() => setInvoiceStatus(inv.id, "paid")}>
                              Mark paid
                            </button>
                          )}
                          {inv.status === "paid" && (
                            <button className="wf-btn wf-btn-quiet wf-btn-sm" onClick={() => setInvoiceStatus(inv.id, "refunded")}>
                              Refund
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ---------------------------------------------------------- usage */}
        {tab === "usage" && (
          <>
            <div className="wf-card p-4">
              <SectionTitle>Limit utilisation</SectionTitle>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
                <UsageMeter label="Employees" state={util.employees} />
                <UsageMeter label="Managers" state={util.managers} />
                <UsageMeter label="Projects" state={util.projects} />
                <UsageMeter label="Storage" state={util.storage} unit="GB" />
                <UsageMeter label="API calls" state={util.api} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="wf-card p-4">
                <SectionTitle>Monthly check-ins</SectionTitle>
                <BarTrend
                  data={history.map((h) => h.checkIns)}
                  labels={history.map((h) => h.month.slice(5))}
                  format={(v) => `${Math.round(v)} check-ins`}
                  ariaLabel="Check-ins per month"
                  height={110}
                />
              </div>
              <div className="wf-card p-4">
                <SectionTitle>Active employees</SectionTitle>
                <BarTrend
                  data={history.map((h) => h.activeEmployees)}
                  labels={history.map((h) => h.month.slice(5))}
                  format={(v) => `${Math.round(v)} active`}
                  ariaLabel="Active employees per month"
                  height={110}
                />
              </div>
            </div>
            {usage && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricCard label="Tracking sessions" value={usage.trackingSessions.toLocaleString("en-IN")} sub="this month" />
                <MetricCard label="Location points" value={usage.locationPoints.toLocaleString("en-IN")} sub="this month" />
                <MetricCard label="Work updates" value={usage.workUpdates} sub="this month" />
                <MetricCard label="GPS errors" value={usage.gpsErrors} tone={usage.gpsErrors > 20 ? "amber" : "neutral"} sub="rejected fixes" />
              </div>
            )}
          </>
        )}

        {/* ------------------------------------------------------- activity */}
        {tab === "activity" && (
          <div className="wf-card p-4">
            <SectionTitle>Account activity & audit history</SectionTitle>
            {audit.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--wf-muted)]">No recorded activity.</p>
            )}
            <ol className="flex flex-col">
              {audit.map((a) => (
                <li key={a.id} className="flex gap-3 border-b border-[var(--wf-line)] py-2.5 last:border-0">
                  <span className="w-32 shrink-0 text-[0.7rem] tabular-nums text-[var(--wf-faint)]">
                    {fmtDateLong(a.at)}
                    <span className="block">{fmtRelative(a.at, now)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.82rem] font-semibold text-[var(--wf-violet)]">{a.action}</span>
                    {(a.previousValue || a.newValue) && (
                      <span className="block text-[0.76rem] text-[var(--wf-muted)]">
                        {a.previousValue ?? "—"} → {a.newValue ?? "—"}
                      </span>
                    )}
                    {a.detail && <span className="block text-[0.72rem] text-[var(--wf-faint)]">{a.detail}</span>}
                  </span>
                  <span className="shrink-0 text-[0.7rem] text-[var(--wf-faint)]">{a.actorName}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* -------------------------------------------------- configuration */}
        {tab === "configuration" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="wf-card p-4">
              <SectionTitle>Branding</SectionTitle>
              <div className="flex flex-col gap-3">
                <Field label="In-product app name">
                  <input
                    className="wf-input"
                    value={org.branding.appName}
                    onChange={(e) => updateOrg(org.id, { branding: { ...org.branding, appName: e.target.value } })}
                  />
                </Field>
                <Field label="Brand accent">
                  <input
                    type="color"
                    className="wf-input h-12 p-1"
                    value={org.branding.accent}
                    onChange={(e) => updateOrg(org.id, { branding: { ...org.branding, accent: e.target.value } })}
                  />
                </Field>
                <Field
                  label="Custom domain"
                  hint={ent.features.customDomain ? undefined : "Not available on this plan — enable it under Subscription."}
                >
                  <input
                    className="wf-input"
                    disabled={!ent.features.customDomain}
                    value={org.branding.customDomain ?? ""}
                    onChange={(e) => updateOrg(org.id, { branding: { ...org.branding, customDomain: e.target.value } })}
                  />
                </Field>
              </div>
            </div>
            <div className="wf-card p-4">
              <SectionTitle>Account status</SectionTitle>
              <div className="flex flex-col gap-2">
                {(["active", "trial", "payment-hold", "suspended", "cancelled"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setOrgStatus(org.id, s, s === "suspended" ? "Set from client configuration" : undefined)}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold capitalize transition ${
                      org.status === s
                        ? "border-[var(--wf-violet)] bg-[var(--wf-violet-soft)] text-[var(--wf-violet)]"
                        : "border-[var(--wf-line)] bg-[var(--wf-surface2)] text-[var(--wf-muted)]"
                    }`}
                  >
                    {s.replace("-", " ")}
                    {org.status === s && <ICheckCircle size={15} />}
                  </button>
                ))}
              </div>
              <p className="mt-3 border-t border-[var(--wf-line)] pt-2.5 text-[0.72rem] text-[var(--wf-faint)]">
                Suspending blocks sign-in for every user in this tenant. Data is
                retained and restored on reactivation.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* suspend confirmation */}
      <BottomSheet open={suspendOpen} onClose={() => setSuspendOpen(false)} title={`Suspend ${org.name}?`}>
        <div className="flex flex-col gap-4">
          <p className="text-[0.84rem] leading-relaxed text-[var(--wf-muted)]">
            Every user in this tenant loses access immediately. Attendance and
            location data is retained and comes back on reactivation.
          </p>
          <Field label="Reason (recorded in the audit log)" required>
            <textarea className="wf-input" rows={3} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="e.g. Two invoices overdue past 45 days" />
          </Field>
          <div className="flex gap-2.5">
            <button className="wf-btn wf-btn-ghost flex-1" onClick={() => setSuspendOpen(false)}>Cancel</button>
            <button
              className="wf-btn wf-btn-danger flex-1"
              disabled={suspendReason.trim().length < 4}
              onClick={() => {
                setOrgStatus(org.id, "suspended", suspendReason.trim());
                setSuspendReason("");
                setSuspendOpen(false);
              }}
            >
              Suspend client
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* impersonation confirmation */}
      <BottomSheet open={impersonateOpen} onClose={() => setImpersonateOpen(false)} title="Log in as client admin">
        <div className="flex flex-col gap-4">
          <p className="wf-inset flex items-start gap-2.5 px-3.5 py-3 text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
            <IShield size={16} className="mt-0.5 shrink-0 text-[var(--wf-violet)]" />
            You&apos;ll see {org.name}&apos;s workspace exactly as their admin does.
            A banner stays visible for the whole session and an audit record is
            written now — including your reason.
          </p>
          <Field label="Reason for access" required>
            <input className="wf-input" value={impersonateReason} onChange={(e) => setImpersonateReason(e.target.value)} placeholder="e.g. Reproducing ticket tkt_4 — managers can't sign in" />
          </Field>
          <div className="flex gap-2.5">
            <button className="wf-btn wf-btn-ghost flex-1" onClick={() => setImpersonateOpen(false)}>Cancel</button>
            <button
              className="wf-btn wf-btn-primary flex-1"
              disabled={impersonateReason.trim().length < 4}
              onClick={() => {
                startImpersonation(org.id, "usr_manager", impersonateReason.trim());
                setImpersonateOpen(false);
                setImpersonateReason("");
                router.push("/admin");
              }}
            >
              Continue as admin
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
