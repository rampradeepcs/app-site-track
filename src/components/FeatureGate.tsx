"use client";

/**
 * Subscription enforcement in the client-facing app.
 *
 * A feature the client's plan doesn't include is never silently missing:
 * it explains what's unavailable and offers the upgrade path, exactly as
 * §23 of the product spec requires.
 */

import { entitlementsFor } from "@/lib/entitlements";
import { usePlatform } from "@/lib/platform-store";
import type { EntryBlock } from "./EntryRequired";
import { useWorkforce } from "@/lib/store";
import type { FeatureSet } from "@/lib/saas-types";
import { FEATURE_LABELS } from "@/lib/saas-types";
import { ILock, IShield } from "./WfIcons";
import { useNowTick } from "./ui";

/**
 * Which client's plan is on screen.
 *
 * Not "which user is signed in". A plan belongs to a construction company,
 * so every gate has to resolve the company being *looked at* — which is the
 * signed-in person's own company almost always, and the impersonated tenant
 * when a super admin is standing inside a client's screens. Reading it from
 * the user meant the super admin saw "no subscription" on the very screens
 * that client's own admin saw a plan on, which is the clearest possible way
 * to make a per-company plan look per-person.
 *
 * Every entitlement check goes through here so no future screen re-derives
 * the org from the viewer.
 */
export function useViewingOrgId(): string {
  const { platform } = usePlatform();
  const { currentUser } = useWorkforce();
  return platform.impersonating?.orgId ?? currentUser?.orgId ?? "";
}

/** Why the app is closed to this company right now. */
export interface ServiceLapse {
  status: "suspended" | "cancelled" | "paused" | "trial-ended";
  orgName: string;
  planName: string;
  /** When it lapsed, where the record says. */
  since?: number;
  /** The operator's own note, for a suspension. */
  reason?: string;
}

/**
 * Has this company's plan stopped?
 *
 * Deliberately narrower than `entitlements.serviceable`, which is also false
 * when there is simply no subscription row to read. That state is not proof of
 * anything: it is what a platform store that has not loaded yet looks like, and
 * it is exactly the bug that had founders and freshly-invited workers staring at
 * a product with every feature switched off. Walling the app on "we cannot see a
 * subscription" would turn a slow network into an expired account. So this
 * answers only when a row exists and that row says, in as many words, that the
 * plan has stopped.
 *
 * Two people are never stopped. A super admin has to be able to reach the
 * console to lift the suspension, and one who is impersonating the client is
 * looking at the problem on purpose — locking them out of the screens would
 * remove the only view of what the client is seeing.
 */
export function useServiceBlock(): ServiceLapse | null {
  const { platform } = usePlatform();
  const { currentUser } = useWorkforce();
  const orgId = useViewingOrgId();
  // Not Date.now() in the body: reading the clock during render is impure, and
  // a trial that lapses while somebody is looking at the screen should take
  // effect on the next tick rather than never. A minute is fine for a date.
  const now = useNowTick(60);

  if (currentUser?.role === "superadmin") return null;
  if (platform.impersonating) return null;
  if (!orgId) return null;

  const sub = platform.subscriptions.find((x) => x.orgId === orgId);
  if (!sub) return null; // unknown, not expired — see above

  const org = platform.organizations.find((o) => o.id === orgId);
  const orgName = org?.name ?? "this company";
  const planName = platform.plans.find((pl) => pl.id === sub.planId)?.name ?? "";

  if (sub.status === "suspended" || sub.status === "cancelled" || sub.status === "paused") {
    return {
      status: sub.status,
      orgName,
      planName,
      since: sub.cancelledAt,
      reason: org?.suspendedReason || undefined,
    };
  }

  // A trial whose end date has passed while the status was never flipped. The
  // status is normally authoritative, but "still trialling four months later"
  // is a backend that did not run, not a customer who is entitled to the app.
  if (sub.status === "trial" && sub.trialEndsAt && sub.trialEndsAt < now) {
    return { status: "trial-ended", orgName, planName, since: sub.trialEndsAt };
  }

  return null;
}

/** Effective entitlements for the client whose screens are open. */
export function useEntitlements() {
  const { platform } = usePlatform();
  const orgId = useViewingOrgId();
  return entitlementsFor(platform, orgId);
}

export function useFeature(key: keyof FeatureSet): boolean {
  const ent = useEntitlements();
  // A super admin inspecting a tenant is never blocked by that tenant's plan.
  const { currentUser } = useWorkforce();
  if (currentUser?.role === "superadmin") return true;
  return ent.features[key];
}

/** Wraps a gated feature; renders the upsell when the plan excludes it. */
export function FeatureGate({
  feature,
  children,
  compact,
}: {
  feature: keyof FeatureSet;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const allowed = useFeature(feature);
  const ent = useEntitlements();
  if (allowed) return <>{children}</>;
  return (
    <UpgradeNotice
      title={`${FEATURE_LABELS[feature]} isn't available on your current plan.`}
      body={`Your organisation is on ${ent.planName}. Ask your administrator to upgrade to unlock ${FEATURE_LABELS[feature].toLowerCase()}.`}
      compact={compact}
    />
  );
}

export function UpgradeNotice({
  title,
  body,
  compact,
}: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`wf-card flex items-start gap-3 border-[var(--wf-violet-edge)] ${compact ? "p-3.5" : "p-5"}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--wf-violet-soft)] text-[var(--wf-violet)]">
        <ILock size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-snug">{title}</p>
        <p className="mt-1 text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">{body}</p>
        <button className="wf-btn wf-btn-ghost wf-btn-sm mt-3">
          <IShield size={14} /> Contact admin to upgrade
        </button>
      </div>
    </div>
  );
}

/**
 * Limit enforcement. `onLimitReached` on the subscription decides whether a
 * ceiling actually blocks, merely warns, bills overage, or auto-upgrades.
 */
export function useLimitGuard(kind: "employees" | "projects" | "managers") {
  const { platform } = usePlatform();
  const { state, currentUser } = useWorkforce();
  const orgId = useViewingOrgId();
  const ent = entitlementsFor(platform, orgId);
  const sub = platform.subscriptions.find((s) => s.orgId === orgId);

  const used =
    kind === "projects"
      ? state.projects.filter((p) => p.orgId === orgId).length
      : state.users.filter(
          (u) => u.orgId === orgId && u.role === (kind === "managers" ? "manager" : "employee"),
        ).length;

  const limit = ent.limits[kind];
  const reached = limit !== null && used >= limit;
  const behaviour = sub?.onLimitReached ?? "block";
  return {
    used,
    limit,
    reached,
    /** True only when the ceiling should actually stop the action. */
    blocked: reached && behaviour === "block" && currentUser?.role !== "superadmin",
    behaviour,
    message:
      limit === null
        ? ""
        : `You've reached your ${kind} limit of ${limit}.`,
  };
}

/* ------------------------------------------------------ entering at all ----
 *
 * "Without project or company, we will not enter into the app."
 *
 * Every rule below that lets somebody in is a `return null`, and there are
 * more of those than there are ways to be blocked. That asymmetry is the
 * design: a worker wrongly held at this wall is standing at a gate unable to
 * start their shift, while somebody wrongly let past sees a quiet screen
 * telling them to ask their manager. Those are not comparable costs, so
 * every uncertainty resolves towards letting them in.
 */
export function useEntryBlock(): EntryBlock | null {
  const { platform } = usePlatform();
  const { state, currentUser, rosterAt } = useWorkforce();

  const role = state.session?.role;

  // 1. The platform owner has no company by design — org_id is null — and
  //    /platform passes through this same guard. Walling them would take
  //    away the console used to fix everybody else.
  if (role === "superadmin") return null;
  // 2. Impersonation does not swap the workforce session, so the owner
  //    looking at a tenant is still the owner, with no company and no site.
  if (platform.impersonating) return null;
  // 3. No session at all is the sign-in gate's business, not this one.
  if (!role || !currentUser) return null;

  // 4. No company, whoever they are. Read from the store rather than the
  //    companies list: loadMyCompanies short-circuits to [] whenever there
  //    is no live backend, which would wall every demo persona and every
  //    local build.
  if (!currentUser.orgId) return { kind: "no-company" };

  // 5. The site half is for employees only. Managers and administrators run
  //    a company rather than stand on one — and blocking an administrator
  //    would be a deadlock, because the only screen that creates the first
  //    project is behind this very guard.
  if (role !== "employee") return null;

  // 6. Wait for the roster to have actually arrived for THIS session.
  //    Without this the wall fires on every sign-in: loginAs seeds the
  //    person with an empty projectIds and the app navigates as soon as the
  //    cheap companies read resolves, while the roster is still in flight.
  //    Offline, and on a read that failed, rosterAt never advances and this
  //    returns null for good — which is the right way to be wrong.
  if (rosterAt <= (state.session?.at ?? 0)) return null;

  // 7. On a site. Status is not consulted: a crew mobilised onto a project
  //    that has not opened yet, or kept on one just finished, are both on a
  //    site as far as this question goes.
  if (currentUser.projectIds.length > 0) return null;

  // 8. Mid-shift always passes. Somebody who is checked in must be able to
  //    check out, whatever the roster says about them now.
  if (state.attendance.some((a) => a.employeeId === currentUser.id && a.checkIn && !a.checkOut)) {
    return null;
  }

  const org = platform.organizations.find((o) => o.id === currentUser.orgId);
  return { kind: "no-project", orgName: org?.name ?? "" };
}
