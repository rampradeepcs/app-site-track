"use client";

/**
 * What a company sees when its plan has stopped.
 *
 * Not a dialog. There is no close button, no backdrop to tap, no Escape — this
 * renders *instead of* the app rather than over it, so there is nothing to
 * dismiss and nothing behind it to reach. A modal that can be closed is a
 * paywall with a keyboard shortcut, and the subscription is the whole
 * commercial relationship; a suspended client browsing attendance because they
 * pressed Escape is the failure this exists to prevent.
 *
 * Two ways out are deliberate and neither of them is "continue anyway". Signing
 * out has to work or somebody whose company lapsed could never sign in as
 * anybody else. Switching company has to work because a person can belong to
 * more than one, and only one of them has stopped paying — /companies sits
 * outside the role guard, so that route is still reachable.
 *
 * The tone is the point. Nobody reading this screen chose the billing status,
 * and most of them cannot change it: a worker at the gate whose employer's card
 * expired needs to know their record is safe and who to tell, not to be sold to.
 */

import Link from "next/link";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import { fmtDateLong } from "@/lib/format";
import { IAlert, ILock } from "./WfIcons";
import type { ServiceLapse } from "./FeatureGate";

const HEADLINE: Record<ServiceLapse["status"], string> = {
  suspended: "This account is suspended",
  cancelled: "This plan has been cancelled",
  paused: "This plan is paused",
  "trial-ended": "The free trial has ended",
};

const EXPLAIN: Record<ServiceLapse["status"], string> = {
  suspended:
    "Workfence has been suspended for this company. Attendance, sites and payroll are all still here — nothing has been deleted — and everything comes back the moment it is reinstated.",
  cancelled:
    "The subscription for this company has been cancelled. Your records have not been deleted; they are waiting for the plan to be restarted.",
  paused:
    "The subscription for this company is paused. Nothing has been lost, and the app returns as soon as the plan is resumed.",
  "trial-ended":
    "The trial for this company has finished. Everything recorded during it is still here and will be waiting on whichever plan is chosen.",
};

export function PlanExpired({ lapse }: { lapse: ServiceLapse }) {
  const { platform } = usePlatform();
  const { logout } = useWorkforce();
  const support = platform.platformSettings.supportEmail;

  const subject = encodeURIComponent(
    `Workfence — ${lapse.orgName} (${lapse.status})`,
  );

  return (
    // role="alertdialog" without aria-modal: this is not layered over anything,
    // it is the document. Focus has nowhere else to go.
    <div
      role="alertdialog"
      aria-labelledby="plan-expired-title"
      className="grid min-h-[calc(100dvh-var(--wf-safe-top))] place-items-center px-5 py-10"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--wf-red-soft)] text-[var(--wf-red)]">
          <ILock size={28} />
        </span>

        <div className="flex flex-col gap-2">
          <h1 id="plan-expired-title" className="wf-display text-[1.5rem] leading-tight">
            {HEADLINE[lapse.status]}
          </h1>
          <p className="text-[0.92rem] font-semibold text-[var(--wf-muted)]">
            {lapse.orgName}
            {lapse.planName ? ` · ${lapse.planName}` : ""}
            {lapse.since ? ` · since ${fmtDateLong(new Date(lapse.since).toISOString().slice(0, 10))}` : ""}
          </p>
        </div>

        <p className="text-[0.88rem] leading-relaxed text-[var(--wf-muted)]">
          {EXPLAIN[lapse.status]}
        </p>

        {/* The operator's own words, when they left any. More use than anything
            generic this screen could say about why. */}
        {lapse.reason ? (
          <p className="flex w-full items-start gap-2 rounded-xl bg-[var(--wf-fill-2)] px-3.5 py-3 text-left text-[0.82rem] leading-relaxed">
            <IAlert size={15} className="mt-0.5 shrink-0 text-[var(--wf-amber)]" />
            <span className="min-w-0">{lapse.reason}</span>
          </p>
        ) : null}

        <div className="flex w-full flex-col gap-2 pt-1">
          {support ? (
            <a className="wf-btn wf-btn-primary" href={`mailto:${support}?subject=${subject}`}>
              Contact {support}
            </a>
          ) : null}
          {/* Outside the role guard, so it is still reachable from here — and a
              person with a second company should not be stranded by this one. */}
          <Link className="wf-btn wf-btn-ghost" href="/companies">
            Switch company
          </Link>
          <button className="wf-btn wf-btn-ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>

        <p className="text-[0.76rem] leading-relaxed text-[var(--wf-faint)]">
          If you look after billing for {lapse.orgName}, contacting us is the
          fastest way to get everyone back on site.
        </p>
      </div>
    </div>
  );
}
