"use client";

/**
 * What this company is paying for, and what it is using.
 *
 * The platform console already answers this from the seller's side — plans,
 * subscriptions, invoices, usage across every tenant. None of it was
 * readable by the person actually on the plan, who could be blocked from
 * adding a worker by a ceiling nobody had ever shown them.
 *
 * Read-only by design, and the database agrees: a company admin may select
 * their subscription, invoices and usage, and every write to those tables is
 * the platform owner's. A customer who could move themselves onto Enterprise
 * is not a subscription model. So a change is asked for, through the one
 * table this role may write to — support_tickets — and the ask says what it
 * is for, so the platform owner does not have to guess.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { Chip, Field } from "@/components/ui";
import { useEntitlements } from "@/components/FeatureGate";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import { FEATURE_LABELS, type FeatureSet } from "@/lib/saas-types";
import { IAlert, IArrowR, ICheck, ILock } from "@/components/WfIcons";

const money = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const day = (ms: number) =>
  new Date(ms).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Whole days from now, floored at zero — a trial cannot expire twice. */
function daysUntil(ms: number): number {
  return Math.max(0, Math.ceil((ms - Date.now()) / 86_400_000));
}

/**
 * One ceiling, drawn.
 *
 * The bar is the point: a number on its own ("42 of 50") is read as a fact,
 * where a bar that is nearly full is read as a decision to make soon.
 */
function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number | null;
}) {
  const unlimited = limit === null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const tone =
    unlimited || pct < 75
      ? "var(--wf-green)"
      : pct < 100
        ? "var(--wf-amber)"
        : "var(--wf-red)";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.82rem]">{label}</span>
        <span className="text-[0.82rem] font-semibold tabular-nums">
          {used}
          <span className="text-[var(--wf-muted)]">
            {unlimited ? " · no limit" : ` of ${limit}`}
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--wf-fill-2)]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: unlimited ? "12%" : `${Math.max(pct, 2)}%`, background: tone }}
        />
      </div>
    </div>
  );
}

export default function SubscriptionPage() {
  const { platform, raiseTicket } = usePlatform();
  const { state, currentUser } = useWorkforce();
  const ent = useEntitlements();
  const orgId = currentUser?.orgId ?? "";

  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const sub = platform.subscriptions.find((s) => s.orgId === orgId) ?? null;
  const plan = sub ? platform.plans.find((p) => p.id === sub.planId) ?? null : null;
  const invoices = useMemo(
    () =>
      platform.invoices
        .filter((i) => i.orgId === orgId)
        .sort((a, b) => b.issuedAt - a.issuedAt)
        .slice(0, 6),
    [platform.invoices, orgId],
  );

  const used = useMemo(
    () => ({
      employees: state.users.filter((u) => u.orgId === orgId && u.role === "employee").length,
      managers: state.users.filter((u) => u.orgId === orgId && u.role === "manager").length,
      projects: state.projects.filter((p) => p.orgId === orgId).length,
    }),
    [state.users, state.projects, orgId],
  );

  /* Plans worth showing: the live ones, cheapest first, with the current one
     marked rather than hidden — "you are here" is half the information. */
  const catalogue = useMemo(
    () => platform.plans.filter((p) => !p.archived).sort((a, b) => a.monthlyPrice - b.monthlyPrice),
    [platform.plans],
  );

  const included = (Object.keys(ent.features) as Array<keyof FeatureSet>).filter(
    (k) => ent.features[k],
  );
  const excluded = (Object.keys(ent.features) as Array<keyof FeatureSet>).filter(
    (k) => !ent.features[k],
  );

  if (currentUser?.role !== "admin" && currentUser?.role !== "superadmin") {
    return (
      <div>
        <ScreenHeader title="Subscription" back="/admin/more" />
        <p className="wf-card2 mx-4 px-4 py-8 text-center text-sm text-[var(--wf-muted)]">
          Only an administrator can see what the company is billed for.
        </p>
      </div>
    );
  }

  if (!sub || !plan) {
    return (
      <div>
        <ScreenHeader title="Subscription" back="/admin/more" />
        <div className="wf-card2 mx-4 flex flex-col gap-3 px-4 py-8 text-center">
          <IAlert size={26} className="mx-auto text-[var(--wf-amber)]" />
          <p className="text-sm text-[var(--wf-muted)]">
            This company has no subscription on record. Attendance still works;
            billing does not know about you yet.
          </p>
        </div>
      </div>
    );
  }

  const onTrial = sub.status === "trial";
  const ends = onTrial ? sub.trialEndsAt : sub.renewsAt;
  const left = ends ? daysUntil(ends) : null;

  const ask = (planId: string) => {
    const target = platform.plans.find((p) => p.id === planId);
    raiseTicket({
      orgId,
      subject: `Plan change requested: ${plan.name} → ${target?.name ?? planId}`,
      body:
        `${currentUser?.name ?? "An administrator"} asked to move from ${plan.name} ` +
        `to ${target?.name ?? planId}.\n\n` +
        `Current usage — employees ${used.employees}` +
        `${ent.limits.employees === null ? "" : ` of ${ent.limits.employees}`}, ` +
        `managers ${used.managers}` +
        `${ent.limits.managers === null ? "" : ` of ${ent.limits.managers}`}, ` +
        `projects ${used.projects}` +
        `${ent.limits.projects === null ? "" : ` of ${ent.limits.projects}`}.` +
        (note.trim() ? `\n\nThey added: ${note.trim()}` : ""),
      kind: "subscription",
      priority: "normal",
      raisedBy: currentUser?.id ?? "",
    });
    setSent(target?.name ?? planId);
    setAsking(null);
    setNote("");
  };

  return (
    <div>
      <ScreenHeader
        title="Subscription"
        sub={`${plan.name} · ${money(plan.monthlyPrice)} a month`}
        back="/admin/more"
      />

      <div className="flex flex-col gap-4 px-4 pb-6">
        {/* where things stand */}
        <div className="wf-card flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                Current plan
              </p>
              <p className="wf-display mt-0.5 text-2xl">{plan.name}</p>
            </div>
            <Chip tone={onTrial ? "amber" : sub.status === "active" ? "green" : "red"}>
              {sub.status}
            </Chip>
          </div>

          {ends ? (
            <p className="text-[0.82rem] text-[var(--wf-muted)]">
              {onTrial ? (
                <>
                  Trial ends {day(ends)}
                  {left !== null ? (
                    <>
                      {" — "}
                      <span
                        className="font-semibold"
                        style={{ color: left <= 3 ? "var(--wf-amber)" : "var(--wf-fg)" }}
                      >
                        {left} {left === 1 ? "day" : "days"} left
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                <>Renews {day(ends)} · billed {sub.cycle === "annual" ? "annually" : "monthly"}</>
              )}
            </p>
          ) : null}

          {/* An overridden ceiling is the platform owner's doing and worth
              naming, so a number that disagrees with the published plan does
              not look like a bug. */}
          {ent.overriddenLimits.length > 0 || ent.overriddenFeatures.length > 0 ? (
            <p className="flex items-start gap-2 border-t border-[var(--wf-line)] pt-3 text-[0.74rem] leading-snug text-[var(--wf-muted)]">
              <ILock size={13} className="mt-0.5 shrink-0" />
              <span>
                Some limits or features on this account were set specially for
                you and differ from the published plan.
              </span>
            </p>
          ) : null}
        </div>

        {/* what is being used against it */}
        <div className="wf-card flex flex-col gap-4 p-4">
          <p className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            Usage this month
          </p>
          <UsageBar label="Employees" used={used.employees} limit={ent.limits.employees} />
          <UsageBar label="Managers" used={used.managers} limit={ent.limits.managers} />
          <UsageBar label="Projects" used={used.projects} limit={ent.limits.projects} />
          <p className="border-t border-[var(--wf-line)] pt-3 text-[0.74rem] leading-snug text-[var(--wf-muted)]">
            Location history is kept for {ent.limits.routeRetentionDays} days on
            this plan.
            {sub.onLimitReached === "block"
              ? " Reaching a ceiling stops new records being added until it is raised."
              : " Going over a ceiling is billed as overage rather than blocked."}
          </p>
        </div>

        {/* what the plan includes */}
        <div className="wf-card flex flex-col gap-3 p-4">
          <p className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            Included
          </p>
          <ul className="flex flex-col gap-1.5">
            {included.map((k) => (
              <li key={k} className="flex items-center gap-2 text-[0.82rem]">
                <ICheck size={14} className="shrink-0 text-[var(--wf-green)]" />
                {FEATURE_LABELS[k]}
              </li>
            ))}
          </ul>
          {excluded.length > 0 ? (
            <>
              <p className="mt-1 border-t border-[var(--wf-line)] pt-3 text-[0.68rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                Not on this plan
              </p>
              <ul className="flex flex-col gap-1.5">
                {excluded.map((k) => (
                  <li
                    key={k}
                    className="flex items-center gap-2 text-[0.82rem] text-[var(--wf-muted)]"
                  >
                    <ILock size={13} className="shrink-0" />
                    {FEATURE_LABELS[k]}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        {/* moving plan — an ask, not a switch */}
        <div className="wf-card flex flex-col gap-3 p-4">
          <div>
            <p className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
              Change plan
            </p>
            <p className="mt-1 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
              Plans are changed by the Workfence team so billing and the paperwork
              stay in step. Asking here reaches them with your usage attached.
            </p>
          </div>

          {sent ? (
            <p className="flex items-start gap-2 rounded-xl bg-[var(--wf-green-soft)] px-3 py-2.5 text-[0.8rem] leading-snug text-[var(--wf-green)]">
              <ICheck size={15} className="mt-0.5 shrink-0" />
              <span>
                Asked to move to {sent}. Someone will be in touch — nothing has
                changed on the account yet.
              </span>
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            {catalogue.map((p) => {
              const current = p.id === plan.id;
              return (
                <div
                  key={p.id}
                  className="wf-card2 flex flex-col gap-2 px-3.5 py-3"
                  style={current ? { boxShadow: "0 0 0 1.5px var(--wf-fg)" } : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-semibold">{p.name}</span>
                      <span className="block text-[0.76rem] text-[var(--wf-muted)]">
                        {money(p.monthlyPrice)} a month
                        {p.limits.employees === null
                          ? " · unlimited people"
                          : ` · up to ${p.limits.employees} people`}
                      </span>
                    </span>
                    {current ? (
                      <Chip tone="neutral">Current</Chip>
                    ) : (
                      <button
                        className="wf-btn wf-btn-ghost wf-btn-sm shrink-0"
                        onClick={() => setAsking(asking === p.id ? null : p.id)}
                      >
                        {asking === p.id ? "Cancel" : "Ask"} <IArrowR size={14} />
                      </button>
                    )}
                  </div>

                  {asking === p.id ? (
                    <div className="flex flex-col gap-2 border-t border-[var(--wf-line)] pt-2.5">
                      <Field
                        label="Anything to add"
                        hint="Optional. Your usage is included automatically."
                      >
                        <textarea
                          className="wf-input min-h-[72px]"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="e.g. we take on 30 more people in April"
                        />
                      </Field>
                      <button
                        className="wf-btn wf-btn-primary wf-btn-sm w-fit"
                        onClick={() => ask(p.id)}
                      >
                        Send the request
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* invoices */}
        <div className="wf-card flex flex-col gap-3 p-4">
          <p className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            Invoices
          </p>
          {invoices.length === 0 ? (
            <p className="text-[0.82rem] text-[var(--wf-muted)]">
              Nothing invoiced yet.
              {onTrial ? " The first one follows the trial." : ""}
            </p>
          ) : (
            <ul className="flex flex-col">
              {invoices.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 border-b border-[var(--wf-line)] py-2.5 last:border-0"
                >
                  <span className="min-w-0">
                    <span className="block text-[0.84rem] font-semibold tabular-nums">
                      {money(inv.amount + inv.taxAmount)}
                    </span>
                    <span className="block text-[0.74rem] text-[var(--wf-muted)]">
                      {day(inv.issuedAt)} · {inv.number}
                    </span>
                  </span>
                  <Chip
                    tone={
                      inv.status === "paid"
                        ? "green"
                        : inv.status === "overdue"
                          ? "red"
                          : "amber"
                    }
                  >
                    {inv.status}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link href="/admin/more" className="wf-btn wf-btn-ghost">
          Back to More
        </Link>
      </div>
    </div>
  );
}
