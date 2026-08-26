"use client";

/**
 * Platform store — the Super Admin's tenant/subscription/billing state.
 *
 * Kept separate from the workforce store so a client's operational data and
 * the platform's commercial data stay cleanly divided; the workforce app
 * only ever *reads* from here, to resolve entitlements.
 *
 * Every mutation that changes what a client is entitled to, is charged, or
 * can access appends to an append-only platform audit trail.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { currentActor } from "./actor";
import { seedPlatform } from "./saas-seed";
import { isLiveBackend } from "./supabase/client";
import { onAuthChange } from "./supabase/auth";
import { fetchPlatform } from "./supabase/repository";
import type {
  BillingProfile,
  FeatureSet,
  Invoice,
  InvoiceStatus,
  Organization,
  Plan,
  PlanLimits,
  PlatformAuditEntry,
  PlatformSettings,
  PlatformState,
  Subscription,
  SupportTicket,
  TicketStatus,
} from "./saas-types";

import { SEED_VERSION } from "./seed";

// Tied to the same shape version as the workforce store: the two are seeded
// together and a stale half is worse than no cache at all.
const KEY = `workfence.platform.v${SEED_VERSION}`;
let n = 0;
const pid = (p: string) => `${p}_${Date.now().toString(36)}_${(n++).toString(36)}`;

export interface OnboardInput {
  org: Omit<Organization, "id" | "createdAt" | "status"> & {
    status?: Organization["status"];
  };
  admin: { name: string; email: string; phone: string; role: string };
  planId: string;
  cycle: Subscription["cycle"];
  trialDays: number;
  limitOverrides: Partial<PlanLimits>;
  featureOverrides: Partial<FeatureSet>;
  /**
   * Tenant id to file this against, when the operational side has already
   * minted one. Self-serve signup provisions the company first — it has to,
   * because the admin it creates needs an org to belong to — and the two
   * halves must land on the same organisation, not two that half-match.
   */
  orgId?: string;
  /**
   * Who to credit. Supplied by signup, where the new admin does the acting
   * but is not yet the signed-in user this store can see.
   */
  actor?: { id: string; name: string };
}

interface PlatformApi {
  platform: PlatformState;
  hydrated: boolean;

  /* clients */
  onboardClient: (input: OnboardInput) => Organization;
  updateOrg: (orgId: string, patch: Partial<Organization>) => void;
  updateBilling: (orgId: string, patch: Partial<BillingProfile>) => void;
  setOrgStatus: (orgId: string, status: Organization["status"], reason?: string) => void;

  /* subscriptions */
  savePlan: (p: Partial<Plan> & { name: string }, id?: string) => Plan;
  archivePlan: (planId: string, archived: boolean) => void;
  changePlan: (orgId: string, planId: string) => void;
  updateSubscription: (orgId: string, patch: Partial<Subscription>) => void;
  overrideLimit: (orgId: string, key: keyof PlanLimits, value: number | null | undefined) => void;
  overrideFeature: (orgId: string, key: keyof FeatureSet, value: boolean | undefined) => void;
  extendTrial: (orgId: string, days: number) => void;
  convertTrial: (orgId: string) => void;

  /* billing */
  setInvoiceStatus: (invoiceId: string, status: InvoiceStatus) => void;

  /* support */
  setTicketStatus: (ticketId: string, status: TicketStatus) => void;

  /* platform */
  updatePlatformSettings: (patch: Partial<PlatformSettings>) => void;
  startImpersonation: (orgId: string, asUserId: string, reason: string) => void;
  stopImpersonation: () => void;
  resetPlatform: () => void;
}

const Ctx = createContext<PlatformApi | null>(null);

export function usePlatform(): PlatformApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("usePlatform must be used inside <PlatformProvider>");
  return api;
}

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [platform, setPlatform] = useState<PlatformState | null>(null);
  const ref = useRef<PlatformState | null>(null);
  useEffect(() => {
    ref.current = platform;
  }, [platform]);

  /* hydrate */
  useEffect(() => {
    let next = seedPlatform();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PlatformState & { v?: number };
        if (parsed.organizations?.length && parsed.plans?.length) next = parsed;
      }
    } catch {
      /* corrupt or unavailable storage → fall back to a fresh seed */
    }
    setPlatform(next);

    // Live mode: commercial state comes from Postgres. RLS decides what this
    // caller may see, so a client admin gets only their own organisation here
    // while the platform owner gets every tenant — from the same query.
    //
    // Same two rules as the workforce store: re-read on sign-in, because RLS
    // answers an unauthenticated caller with nothing; and never let an empty
    // result overwrite, because "no organisations" reads as a broken product
    // when the real cause is an unauthorised read.
    if (isLiveBackend) {
      let cancelled = false;
      const hydrate = () => {
        fetchPlatform()
          .then((live) => {
            if (cancelled) return;
            if (live.organizations.length === 0) {
              console.warn(
                "[Workfence] Supabase returned no visible organisations — not signed in, " +
                  "or this identity has no tenant. Keeping local state.",
              );
              return;
            }
            setPlatform((prev) =>
              prev
                ? {
                    ...prev,
                    organizations: live.organizations,
                    plans: live.plans,
                    subscriptions: live.subscriptions,
                    invoices: live.invoices,
                    usage: live.usage,
                  }
                : prev,
            );
          })
          .catch((err) => {
            console.error("[Workfence] Supabase platform hydration failed; staying local.", err);
          });
      };
      hydrate();
      const off = onAuthChange((signedIn) => {
        if (signedIn) hydrate();
      });
      return () => {
        cancelled = true;
        off();
      };
    }
  }, []);

  /* persist */
  useEffect(() => {
    if (!platform) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(platform));
    } catch {
      /* quota exceeded — the in-memory state stays authoritative */
    }
  }, [platform]);

  const mutate = useCallback((fn: (s: PlatformState) => PlatformState) => {
    setPlatform((prev) => (prev ? fn(prev) : prev));
  }, []);

  /**
   * Append-only: audit entries are never edited or removed from the UI.
   *
   * The actor defaults to whoever is signed in rather than being named here.
   * A hardcoded one was wrong in both directions: it credited every client
   * admin's change to the platform owner, and it credited a self-serve signup
   * to a person who was not involved. Callers may still pass an actor
   * explicitly — the signup does, because the account it is creating does not
   * exist yet at the moment the entry is written.
   */
  const record = useCallback(
    (
      s: PlatformState,
      e: Omit<PlatformAuditEntry, "id" | "at" | "actorId" | "actorName"> &
        Partial<Pick<PlatformAuditEntry, "actorId" | "actorName">>,
    ): PlatformState => {
      const who = currentActor();
      return {
        ...s,
        platformAudit: [
          {
            id: pid("pa"),
            at: Date.now(),
            actorId: who.id,
            actorName: who.name,
            ...e,
          },
          ...s.platformAudit,
        ],
      };
    },
    [],
  );

  /* ------------------------------------------------------------ clients */

  const onboardClient = useCallback<PlatformApi["onboardClient"]>(
    (input) => {
      const id = input.orgId ?? pid("org");
      const plan = (ref.current?.plans ?? []).find((p) => p.id === input.planId);
      const now = Date.now();
      const org: Organization = {
        ...input.org,
        id,
        status: input.org.status ?? (input.trialDays > 0 ? "trial" : "active"),
        createdAt: now,
      };
      const sub: Subscription = {
        id: pid("sub"),
        orgId: id,
        planId: input.planId,
        status: input.trialDays > 0 ? "trial" : "active",
        cycle: input.cycle,
        startedAt: now,
        trialEndsAt: input.trialDays > 0 ? now + input.trialDays * 86_400_000 : undefined,
        renewsAt:
          now + (input.trialDays > 0 ? input.trialDays : input.cycle === "annual" ? 365 : 30) * 86_400_000,
        limitOverrides: input.limitOverrides,
        featureOverrides: input.featureOverrides,
        creditBalance: 0,
        onLimitReached: "block",
      };
      mutate((s) =>
        record(
          {
            ...s,
            organizations: [org, ...s.organizations],
            subscriptions: [sub, ...s.subscriptions],
          },
          {
            orgId: id,
            action: "client.create",
            target: org.name,
            newValue: `${plan?.name ?? input.planId} (${input.cycle})`,
            detail: `Onboarded with admin ${input.admin.name} <${input.admin.email}>`,
            ...(input.actor
              ? { actorId: input.actor.id, actorName: input.actor.name }
              : {}),
          },
        ),
      );
      return org;
    },
    [mutate, record],
  );

  const updateOrg = useCallback<PlatformApi["updateOrg"]>(
    (orgId, patch) =>
      mutate((s) => {
        const before = s.organizations.find((o) => o.id === orgId);
        return record(
          {
            ...s,
            organizations: s.organizations.map((o) => (o.id === orgId ? { ...o, ...patch } : o)),
          },
          {
            orgId,
            action: "client.update",
            target: before?.name ?? orgId,
            detail: `Updated ${Object.keys(patch).join(", ")}`,
          },
        );
      }),
    [mutate, record],
  );

  const updateBilling = useCallback<PlatformApi["updateBilling"]>(
    (orgId, patch) =>
      mutate((s) => {
        const before = s.organizations.find((o) => o.id === orgId);
        return record(
          {
            ...s,
            organizations: s.organizations.map((o) =>
              o.id === orgId ? { ...o, billing: { ...o.billing, ...patch } } : o,
            ),
          },
          {
            orgId,
            action: "billing.update",
            target: before?.name ?? orgId,
            detail: `Updated billing ${Object.keys(patch).join(", ")}`,
          },
        );
      }),
    [mutate, record],
  );

  const setOrgStatus = useCallback<PlatformApi["setOrgStatus"]>(
    (orgId, status, reason) =>
      mutate((s) => {
        const before = s.organizations.find((o) => o.id === orgId);
        const subStatus: Subscription["status"] | null =
          status === "suspended" ? "suspended" : status === "active" ? "active" : null;
        return record(
          {
            ...s,
            organizations: s.organizations.map((o) =>
              o.id === orgId ? { ...o, status, suspendedReason: status === "suspended" ? reason : undefined } : o,
            ),
            subscriptions: subStatus
              ? s.subscriptions.map((x) => (x.orgId === orgId ? { ...x, status: subStatus } : x))
              : s.subscriptions,
          },
          {
            orgId,
            action: status === "suspended" ? "client.suspend" : "client.status_change",
            target: before?.name ?? orgId,
            previousValue: before?.status,
            newValue: status,
            detail: reason,
          },
        );
      }),
    [mutate, record],
  );

  /* ------------------------------------------------------ subscriptions */

  const savePlan = useCallback<PlatformApi["savePlan"]>(
    (patch, id) => {
      let saved!: Plan;
      mutate((s) => {
        if (id) {
          const before = s.plans.find((p) => p.id === id);
          const plans = s.plans.map((p) => {
            if (p.id !== id) return p;
            saved = { ...p, ...patch, id };
            return saved;
          });
          return record({ ...s, plans }, {
            action: "plan.update",
            target: saved?.name ?? id,
            previousValue: before ? `${before.monthlyPrice}/mo` : undefined,
            newValue: `${saved?.monthlyPrice}/mo`,
          });
        }
        saved = {
          id: pid("plan"),
          name: patch.name,
          description: patch.description ?? "",
          monthlyPrice: patch.monthlyPrice ?? 0,
          annualPrice: patch.annualPrice ?? 0,
          currency: patch.currency ?? "INR",
          trialDays: patch.trialDays ?? 14,
          limits: patch.limits ?? {
            employees: 50,
            managers: 2,
            projects: 5,
            storageGb: 25,
            routeRetentionDays: 30,
            apiCallsPerMonth: 0,
          },
          features: patch.features ?? {
            attendance: true,
            geofencing: true,
            liveTracking: true,
            routePlayback: false,
            workUpdates: false,
            performance: false,
            advancedReports: false,
            dataExport: false,
            apiAccess: false,
            customBranding: false,
            customDomain: false,
            prioritySupport: false,
          },
          supportLevel: patch.supportLevel ?? "standard",
          archived: false,
          createdAt: Date.now(),
        };
        return record({ ...s, plans: [...s.plans, saved] }, {
          action: "plan.create",
          target: saved.name,
          newValue: `${saved.monthlyPrice}/mo`,
        });
      });
      return saved;
    },
    [mutate, record],
  );

  const archivePlan = useCallback<PlatformApi["archivePlan"]>(
    (planId, archived) =>
      mutate((s) =>
        record(
          { ...s, plans: s.plans.map((p) => (p.id === planId ? { ...p, archived } : p)) },
          {
            action: archived ? "plan.archive" : "plan.restore",
            target: s.plans.find((p) => p.id === planId)?.name ?? planId,
          },
        ),
      ),
    [mutate, record],
  );

  const changePlan = useCallback<PlatformApi["changePlan"]>(
    (orgId, planId) =>
      mutate((s) => {
        const sub = s.subscriptions.find((x) => x.orgId === orgId);
        const from = s.plans.find((p) => p.id === sub?.planId);
        const to = s.plans.find((p) => p.id === planId);
        return record(
          {
            ...s,
            subscriptions: s.subscriptions.map((x) =>
              x.orgId === orgId ? { ...x, planId } : x,
            ),
          },
          {
            orgId,
            action: "subscription.change_plan",
            target: s.organizations.find((o) => o.id === orgId)?.name ?? orgId,
            previousValue: from?.name,
            newValue: to?.name,
          },
        );
      }),
    [mutate, record],
  );

  const updateSubscription = useCallback<PlatformApi["updateSubscription"]>(
    (orgId, patch) =>
      mutate((s) =>
        record(
          {
            ...s,
            subscriptions: s.subscriptions.map((x) =>
              x.orgId === orgId ? { ...x, ...patch } : x,
            ),
          },
          {
            orgId,
            action: "subscription.update",
            target: s.organizations.find((o) => o.id === orgId)?.name ?? orgId,
            detail: `Changed ${Object.keys(patch).join(", ")}`,
            newValue: patch.status,
          },
        ),
      ),
    [mutate, record],
  );

  const overrideLimit = useCallback<PlatformApi["overrideLimit"]>(
    (orgId, key, value) =>
      mutate((s) => {
        const sub = s.subscriptions.find((x) => x.orgId === orgId);
        const plan = s.plans.find((p) => p.id === sub?.planId);
        const prev = sub?.limitOverrides[key] ?? plan?.limits[key];
        return record(
          {
            ...s,
            subscriptions: s.subscriptions.map((x) => {
              if (x.orgId !== orgId) return x;
              const next = { ...x.limitOverrides };
              if (value === undefined) delete next[key];
              else (next[key] as number | null) = value;
              return { ...x, limitOverrides: next };
            }),
          },
          {
            orgId,
            action: "subscription.limit_override",
            target: s.organizations.find((o) => o.id === orgId)?.name ?? orgId,
            previousValue: `${key}: ${prev ?? "∞"}`,
            newValue: value === undefined ? `${key}: reset to plan` : `${key}: ${value ?? "∞"}`,
          },
        );
      }),
    [mutate, record],
  );

  const overrideFeature = useCallback<PlatformApi["overrideFeature"]>(
    (orgId, key, value) =>
      mutate((s) => {
        const sub = s.subscriptions.find((x) => x.orgId === orgId);
        const plan = s.plans.find((p) => p.id === sub?.planId);
        const prev = sub?.featureOverrides[key] ?? plan?.features[key];
        return record(
          {
            ...s,
            subscriptions: s.subscriptions.map((x) => {
              if (x.orgId !== orgId) return x;
              const next = { ...x.featureOverrides };
              if (value === undefined) delete next[key];
              else next[key] = value;
              return { ...x, featureOverrides: next };
            }),
          },
          {
            orgId,
            action: "subscription.feature_override",
            target: s.organizations.find((o) => o.id === orgId)?.name ?? orgId,
            previousValue: `${key}: ${prev}`,
            newValue: value === undefined ? `${key}: reset to plan` : `${key}: ${value}`,
          },
        );
      }),
    [mutate, record],
  );

  const extendTrial = useCallback<PlatformApi["extendTrial"]>(
    (orgId, days) =>
      mutate((s) =>
        record(
          {
            ...s,
            subscriptions: s.subscriptions.map((x) =>
              x.orgId === orgId
                ? {
                    ...x,
                    trialEndsAt: (x.trialEndsAt ?? Date.now()) + days * 86_400_000,
                    renewsAt: (x.trialEndsAt ?? Date.now()) + days * 86_400_000,
                  }
                : x,
            ),
          },
          {
            orgId,
            action: "subscription.extend_trial",
            target: s.organizations.find((o) => o.id === orgId)?.name ?? orgId,
            newValue: `+${days} days`,
          },
        ),
      ),
    [mutate, record],
  );

  const convertTrial = useCallback<PlatformApi["convertTrial"]>(
    (orgId) =>
      mutate((s) =>
        record(
          {
            ...s,
            organizations: s.organizations.map((o) =>
              o.id === orgId ? { ...o, status: "active" } : o,
            ),
            subscriptions: s.subscriptions.map((x) =>
              x.orgId === orgId
                ? { ...x, status: "active", trialEndsAt: undefined, renewsAt: Date.now() + 30 * 86_400_000 }
                : x,
            ),
          },
          {
            orgId,
            action: "subscription.convert_trial",
            target: s.organizations.find((o) => o.id === orgId)?.name ?? orgId,
            previousValue: "trial",
            newValue: "active",
          },
        ),
      ),
    [mutate, record],
  );

  /* ------------------------------------------------------------ billing */

  const setInvoiceStatus = useCallback<PlatformApi["setInvoiceStatus"]>(
    (invoiceId, status) =>
      mutate((s) => {
        const inv = s.invoices.find((i) => i.id === invoiceId);
        return record(
          {
            ...s,
            invoices: s.invoices.map((i) =>
              i.id === invoiceId
                ? { ...i, status, paidAt: status === "paid" ? Date.now() : i.paidAt }
                : i,
            ),
          },
          {
            orgId: inv?.orgId,
            action: `invoice.${status}`,
            target: inv?.number ?? invoiceId,
            previousValue: inv?.status,
            newValue: status,
          },
        );
      }),
    [mutate, record],
  );

  /* ------------------------------------------------------------ support */

  const setTicketStatus = useCallback<PlatformApi["setTicketStatus"]>(
    (ticketId, status) =>
      mutate((s) => ({
        ...s,
        tickets: s.tickets.map((t) =>
          t.id === ticketId ? { ...t, status, updatedAt: Date.now() } : t,
        ),
      })),
    [mutate],
  );

  /* ----------------------------------------------------------- platform */

  const updatePlatformSettings = useCallback<PlatformApi["updatePlatformSettings"]>(
    (patch) =>
      mutate((s) =>
        record(
          { ...s, platformSettings: { ...s.platformSettings, ...patch } },
          {
            action: "platform.settings",
            target: "Platform settings",
            detail: `Changed ${Object.keys(patch).join(", ")}`,
          },
        ),
      ),
    [mutate, record],
  );

  const startImpersonation = useCallback<PlatformApi["startImpersonation"]>(
    (orgId, asUserId, reason) =>
      mutate((s) =>
        record(
          { ...s, impersonating: { orgId, asUserId, startedAt: Date.now(), reason } },
          {
            orgId,
            action: "client.impersonate",
            target: s.organizations.find((o) => o.id === orgId)?.name ?? orgId,
            detail: reason,
          },
        ),
      ),
    [mutate, record],
  );

  const stopImpersonation = useCallback<PlatformApi["stopImpersonation"]>(
    () =>
      mutate((s) =>
        s.impersonating
          ? record(
              { ...s, impersonating: null },
              {
                orgId: s.impersonating.orgId,
                action: "client.impersonate_end",
                target: s.organizations.find((o) => o.id === s.impersonating!.orgId)?.name ?? "",
              },
            )
          : s,
      ),
    [mutate, record],
  );

  const resetPlatform = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setPlatform(seedPlatform());
  }, []);

  const api = useMemo<PlatformApi | null>(
    () =>
      platform
        ? {
            platform,
            hydrated: true,
            onboardClient,
            updateOrg,
            updateBilling,
            setOrgStatus,
            savePlan,
            archivePlan,
            changePlan,
            updateSubscription,
            overrideLimit,
            overrideFeature,
            extendTrial,
            convertTrial,
            setInvoiceStatus,
            setTicketStatus,
            updatePlatformSettings,
            startImpersonation,
            stopImpersonation,
            resetPlatform,
          }
        : null,
    [
      platform, onboardClient, updateOrg, updateBilling, setOrgStatus, savePlan,
      archivePlan, changePlan, updateSubscription, overrideLimit, overrideFeature,
      extendTrial, convertTrial, setInvoiceStatus, setTicketStatus,
      updatePlatformSettings, startImpersonation, stopImpersonation, resetPlatform,
    ],
  );

  if (!api) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-[var(--wf-muted)]">
        Loading platform…
      </div>
    );
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Unused-import guard for types referenced only in the API surface. */
export type { Invoice, SupportTicket };
