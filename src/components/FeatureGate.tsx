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
import { useWorkforce } from "@/lib/store";
import type { FeatureSet } from "@/lib/saas-types";
import { FEATURE_LABELS } from "@/lib/saas-types";
import { ILock, IShield } from "./WfIcons";

/** Effective entitlements for the signed-in user's tenant. */
export function useEntitlements() {
  const { platform } = usePlatform();
  const { currentUser } = useWorkforce();
  const orgId = currentUser?.orgId ?? "";
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
      className={`wf-card flex items-start gap-3 border-[rgba(167,139,250,0.35)] ${compact ? "p-3.5" : "p-5"}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[rgba(167,139,250,0.14)] text-[var(--wf-violet)]">
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
  const orgId = currentUser?.orgId ?? "";
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
