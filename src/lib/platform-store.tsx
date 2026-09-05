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
import { BootMark } from "@/components/Brand";
import { demoActive, platformKey } from "./demo/mode";
import { buildDemoData } from "./demo/seed";
import { isLiveBackend } from "./supabase/client";
import { onAuthChange } from "./supabase/auth";
import { fetchPlatform } from "./supabase/repository";
import { syncPlatformChanges } from "./supabase/platform-sync";
import { showToast } from "./toast";
import { describeError } from "./errors";
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
  TicketKind,
  TicketStatus,
} from "./saas-types";

import { SEED_VERSION } from "./seed";

// Tied to the same shape version as the workforce store: the two are seeded
// together and a stale half is worse than no cache at all.
const KEY = `workfence.platform.v${SEED_VERSION}`;
let n = 0;
/* Real ids: every platform table keys on a uuid, and a row minted here is
   written there. The readable form remains for the demo and for a runtime
   without crypto, where nothing is written anywhere. */
const pid = (p: string) =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${p}_${Date.now().toString(36)}_${(n++).toString(36)}`;

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
  /**
   * Raise a ticket from the client side.
   *
   * The one thing a company admin may write on the billing tables — RLS lets
   * their org insert a ticket and nothing else — so it is how a plan change
   * is asked for rather than taken.
   */
  raiseTicket: (input: {
    orgId: string;
    subject: string;
    body: string;
    kind?: TicketKind;
    priority?: SupportTicket["priority"];
    raisedBy?: string;
  }) => SupportTicket;

  /* platform */
  updatePlatformSettings: (patch: Partial<PlatformSettings>) => void;
  /** Read the commercial state again from the server, after a change made there. */
  reloadPlatform: () => Promise<void>;
  /** Record something done from a platform screen that the store did not do itself. */
  noteAudit: (
    e: Omit<PlatformAuditEntry, "id" | "at" | "actorId" | "actorName">,
  ) => void;
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

  /*
   * The state as the server last gave it, and the state as last seen by the
   * write-through below. A state that arrived from the server is not ours to
   * write back; everything that differs from the last seen state after that
   * is, and goes to Postgres.
   */
  const baselineRef = useRef<PlatformState | null>(null);
  const lastSeenRef = useRef<PlatformState | null>(null);

  /**
   * Live mode: commercial state comes from Postgres. RLS decides what this
   * caller may see, so a client admin gets only their own organisation here
   * while the platform owner gets every tenant — from the same query.
   *
   * Never let an empty result overwrite: "no organisations" reads as a
   * broken product when the real cause is an unauthorised read.
   */
  const hydrateFromBackend = useCallback(async () => {
    if (!isLiveBackend || demoActive()) return;
    try {
      const live = await fetchPlatform();
      if (live.organizations.length === 0) {
        console.warn(
          "[Workfence] Supabase returned no visible organisations — not signed in, " +
            "or this identity has no tenant. Keeping local state.",
        );
        return;
      }
      const prev = ref.current;
      if (!prev) return;
      const next: PlatformState = {
        ...prev,
        organizations: live.organizations,
        plans: live.plans,
        subscriptions: live.subscriptions,
        invoices: live.invoices,
        usage: live.usage,
        tickets: live.tickets,
        platformAudit: live.platformAudit,
        platformSettings: live.platformSettings
          ? { ...prev.platformSettings, ...live.platformSettings }
          : prev.platformSettings,
      };
      baselineRef.current = next;
      setPlatform(next);
    } catch (err) {
      console.error("[Workfence] Supabase platform hydration failed; staying local.", err);
    }
  }, []);

  /* hydrate */
  useEffect(() => {
    const seed = demoActive() ? buildDemoData().platform : seedPlatform();
    let next = seed;
    try {
      const raw = localStorage.getItem(platformKey());
      if (raw) {
        const parsed = JSON.parse(raw) as PlatformState & { v?: number };
        if (parsed.organizations?.length && parsed.plans?.length) {
          // Feature keys added after a plan was persisted: fill from the
          // shipped plan of the same id (or false), so a stored blob never
          // hides a capability the product has since grown.
          next = {
            ...parsed,
            plans: parsed.plans.map((plan) => {
              const shipped = seed.plans.find((p) => p.id === plan.id);
              return {
                ...plan,
                features: { ...(shipped?.features ?? {}), ...plan.features },
              };
            }),
          };
        }
      }
    } catch {
      /* corrupt or unavailable storage → fall back to a fresh seed */
    }
    setPlatform(next);

    // Re-read on sign-in as well as on mount, because RLS answers an
    // unauthenticated caller with nothing.
    if (isLiveBackend && !demoActive()) {
      // The first render has to have happened before there is a state to
      // lay the server's rows over; a macrotask is enough.
      const t = window.setTimeout(() => void hydrateFromBackend(), 0);
      const off = onAuthChange((signedIn) => {
        if (signedIn) void hydrateFromBackend();
      });
      return () => {
        window.clearTimeout(t);
        off();
      };
    }
    // Mount-only; hydrateFromBackend is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Write-through. Whatever a mutation changed goes to Postgres, keyed on
   * identity (see platform-sync). Three states are not ours to write: the
   * first one loaded, the one the server just gave us, and anything while
   * the demonstration is on.
   *
   * A write that fails is not forgotten. The last-seen mark goes back to
   * where it was, so the change is still "unsent" and rides along with the
   * next attempt — the next mutation, or the connection coming back. On a
   * phone with no signal that is the difference between an edit that lands
   * a minute later and one that is silently gone.
   */
  const noticeAtRef = useRef(0);
  const flush = useCallback((prev: PlatformState, next: PlatformState) => {
    syncPlatformChanges(prev, next).catch((err) => {
      console.error("[Workfence] A platform change did not reach the server.", describeError(err));
      if (lastSeenRef.current === next) lastSeenRef.current = prev;
      // One notice per burst: a form's worth of fields failing in the same
      // outage is one piece of news, not one toast per field.
      const now = Date.now();
      if (now - noticeAtRef.current < 8000) return;
      noticeAtRef.current = now;
      const msg = describeError(err);
      showToast(
        /failed to fetch|networkerror|load failed|network request failed/i.test(msg)
          ? "No connection — the change is kept here and will be saved when you're back online."
          : `Not saved to the server: ${msg}`,
        "danger",
      );
    });
  }, []);

  useEffect(() => {
    if (!platform) return;
    const prev = lastSeenRef.current;
    lastSeenRef.current = platform;
    if (!prev || platform === baselineRef.current) return;
    if (!isLiveBackend || demoActive()) return;
    flush(prev, platform);
  }, [platform, flush]);

  /* Back online: send whatever is still unsent. */
  useEffect(() => {
    if (!isLiveBackend) return;
    const retry = () => {
      const prev = lastSeenRef.current;
      const next = ref.current;
      if (!prev || !next || prev === next || demoActive()) return;
      flush(prev, next);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [flush]);

  /* persist */
  useEffect(() => {
    if (!platform) return;
    try {
      localStorage.setItem(platformKey(), JSON.stringify(platform));
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

  const raiseTicket = useCallback<PlatformApi["raiseTicket"]>(
    (input) => {
      const now = Date.now();
      const ticket: SupportTicket = {
        id: pid("tkt"),
        orgId: input.orgId,
        subject: input.subject,
        body: input.body,
        kind: input.kind ?? "subscription",
        status: "open",
        priority: input.priority ?? "normal",
        openedAt: now,
        updatedAt: now,
        raisedBy: input.raisedBy ?? "",
      };
      mutate((s) => ({ ...s, tickets: [ticket, ...s.tickets] }));
      return ticket;
    },
    [mutate],
  );

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

  const noteAudit = useCallback<PlatformApi["noteAudit"]>(
    (e) => mutate((s) => record(s, e)),
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
      localStorage.removeItem(platformKey());
    } catch {
      /* ignore */
    }
    // A fresh seed is not ours to write back either; against a backend the
    // real state follows straight after it.
    const fresh = seedPlatform();
    baselineRef.current = fresh;
    setPlatform(fresh);
    void hydrateFromBackend();
  }, [hydrateFromBackend]);

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
            raiseTicket,
            setTicketStatus,
            updatePlatformSettings,
            reloadPlatform: hydrateFromBackend,
            noteAudit,
            startImpersonation,
            stopImpersonation,
            resetPlatform,
          }
        : null,
    [
      platform, onboardClient, updateOrg, updateBilling, setOrgStatus, savePlan,
      archivePlan, changePlan, updateSubscription, overrideLimit, overrideFeature,
      extendTrial, convertTrial, setInvoiceStatus, raiseTicket, setTicketStatus,
      updatePlatformSettings, hydrateFromBackend, noteAudit, startImpersonation, stopImpersonation, resetPlatform,
    ],
  );

  if (!api) {
    // The native splash is the mark on black; so is this, in the same
    // place, so the hand-over from one to the other is nothing happening
    // rather than a line of text flashing up and going away.
    return <BootMark />;
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Unused-import guard for types referenced only in the API surface. */
export type { Invoice, SupportTicket };
