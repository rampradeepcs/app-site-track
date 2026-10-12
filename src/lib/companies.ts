"use client";

/**
 * The companies a person belongs to, and where to send them after sign-in.
 *
 * Fetched once and shared, because the switcher in the header, the list on
 * the More screen and the chooser after sign-in all want the same answer,
 * and asking three times would be three round trips to say one thing.
 * Refreshed on anything that could change it: joining, leaving, founding.
 */

import { useEffect, useState } from "react";
import { activeCompanyId, setActiveCompany, subscribeActiveCompany } from "./company";
import { demoActive, demoDataInMemory } from "./demo/mode";
import { isLiveBackend } from "./supabase/client";
import {
  fetchMyCompanies,
  fetchMyInvitations,
  type CompanyInvitation,
  type CompanyMembership,
} from "./supabase/repository";

let pending: Promise<CompanyMembership[]> | null = null;
let cachedList: CompanyMembership[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function loadMyCompanies(force = false): Promise<CompanyMembership[]> {
  // A demonstration has no memberships to ask about, and asking sends a real
  // request to a real database from a session that is not supposed to reach
  // it. isLiveBackend alone does not cover that: a demo runs with a backend
  // configured and simply never talks to it — the same two conditions
  // persist() and reloadFromBackend() already use.
  if (!isLiveBackend || demoActive() || demoDataInMemory()) return Promise.resolve([]);
  if (!pending || force) {
    pending = fetchMyCompanies()
      .then((list) => {
        cachedList = list;
        notify();
        return list;
      })
      .catch((e) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}

/** Forget what was known, so the next ask goes to the server. */
export function refreshMyCompanies(): Promise<CompanyMembership[]> {
  return loadMyCompanies(true);
}

export function clearCompaniesCache(): void {
  pending = null;
  cachedList = null;
  notify();
}

/** The cached list (null until first load), re-rendering when it changes. */
export function useMyCompanies(): {
  companies: CompanyMembership[] | null;
  active: CompanyMembership | null;
} {
  const [, bump] = useState(0);
  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    listeners.add(rerender);
    const off = subscribeActiveCompany(rerender);
    if (isLiveBackend && !cachedList) void loadMyCompanies().catch(() => {});
    return () => {
      listeners.delete(rerender);
      off();
    };
  }, []);
  const id = activeCompanyId();
  return {
    companies: cachedList,
    active: cachedList?.find((c) => c.orgId === id) ?? null,
  };
}

/** Where a freshly signed-in person should go. */
export type SignInDestination =
  | { kind: "enter"; orgId: string }
  | { kind: "choose" }
  | { kind: "invitations" }
  | { kind: "none" };

/**
 * Decide, after sign-in, which company to open.
 *
 * Pending invitations first, for everybody. A company that added this
 * address — by invitation, or by typing it into its roster, which the
 * database now turns into one — is asked about once, before going in,
 * rather than left for someone to find. "Not now" on that screen snoozes
 * them on this device (see snoozeInvitations), so being asked once does not
 * become being asked at every launch.
 *
 * Then: one company, open it. A remembered choice among several: open that
 * — it is the same company as last time on this device, so nothing has
 * switched under them. Several and no memory: ask. None: the empty state
 * that says so.
 */
export async function resolveSignInDestination(
  opts: {
    /** For "Not now": decide where to go as if no invitation were waiting,
     *  so the answer can never be the screen it was asked from. */
    skipInvitations?: boolean;
  } = {},
): Promise<SignInDestination> {
  /* Asked alongside the companies rather than after them: every path needs
     both, and a member on a weak signal should not wait one more round trip
     to be told what they already would have been. A failure is "none". */
  const invitationsP: Promise<CompanyInvitation[]> = opts.skipInvitations
    ? Promise.resolve([])
    : fetchMyInvitations().catch(() => []);
  const companies = await loadMyCompanies(true);
  const live = companies.filter((c) => c.status !== "revoked");
  if (live.length > 0) {
    /* Bounded: a member's company is already known, and a slow invitation
       list must not hold them on the splash. Nothing is snoozed when this
       gives up, so a skipped invitation is still asked about next time. */
    const invitations = await Promise.race([
      invitationsP,
      new Promise<CompanyInvitation[]>((resolve) => setTimeout(() => resolve([]), 2000)),
    ]);
    const snoozed = new Set(snoozedInvitations());
    if (invitations.some((i) => !snoozed.has(i.id))) return { kind: "invitations" };
  }
  if (live.length === 1) {
    setActiveCompany(live[0]!.orgId);
    return { kind: "enter", orgId: live[0]!.orgId };
  }
  if (live.length > 1) {
    const remembered = activeCompanyId();
    if (remembered && live.some((c) => c.orgId === remembered)) {
      return { kind: "enter", orgId: remembered };
    }
    return { kind: "choose" };
  }
  setActiveCompany(null);
  const invitations = await invitationsP;
  return invitations.length ? { kind: "invitations" } : { kind: "none" };
}

/**
 * Where somebody signed in but on no company goes: invitations waiting for
 * them, or founding a company. Shared by every way in — the gate, the
 * native sign-on return — so that none of them sends an invited person to
 * found a company behind the invitation they were sent. An invitation list
 * that fails to load counts as empty: the wizard is the safe wrong answer,
 * a blank screen is not.
 */
export async function onboardingDestination(): Promise<"/invitations" | "/start"> {
  try {
    return (await fetchMyInvitations()).length ? "/invitations" : "/start";
  } catch {
    return "/start";
  }
}

/* ------------------------------------------------------ "not now" memory */

const SNOOZE_KEY = "workfence.invitations.snoozed";
/* Held in memory too, so "Not now" still holds for this session when
   storage refuses the write (a private window, a full disk). */
const snoozedThisSession = new Set<string>();

/** Invitations this device was told to stop raising at sign-in. */
export function snoozedInvitations(): string[] {
  let stored: string[] = [];
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "[]");
    stored = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    /* unreadable: the in-memory set still answers */
  }
  return [...new Set([...stored, ...snoozedThisSession])];
}

/**
 * "Not now" for these invitations, on this device. They stay pending and
 * stay listed under Invitations; they just stop interrupting sign-in. A new
 * invitation has a new id, so it is still asked about.
 */
export function snoozeInvitations(ids: string[]): void {
  for (const id of ids) snoozedThisSession.add(id);
  try {
    const next = snoozedInvitations().slice(-100);
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: held in memory for this session */
  }
}

export const ROUTE_FOR: Record<Exclude<SignInDestination["kind"], "enter">, string> = {
  choose: "/companies",
  invitations: "/invitations",
  none: "/companies",
};
