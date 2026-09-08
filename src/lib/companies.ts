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
  if (!isLiveBackend) return Promise.resolve([]);
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
 * One company: open it. A remembered choice among several: open that —
 * it is the same company as last time on this device, so nothing has
 * switched under them. Several and no memory: ask. None: pending
 * invitations if there are any, otherwise the empty state that says so.
 */
export async function resolveSignInDestination(): Promise<SignInDestination> {
  const companies = await loadMyCompanies(true);
  const live = companies.filter((c) => c.status !== "revoked");
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
  let invitations: CompanyInvitation[] = [];
  try {
    invitations = await fetchMyInvitations();
  } catch {
    /* an invitation list that fails to load is an empty one, for routing */
  }
  return invitations.length ? { kind: "invitations" } : { kind: "none" };
}

export const ROUTE_FOR: Record<Exclude<SignInDestination["kind"], "enter">, string> = {
  choose: "/companies",
  invitations: "/invitations",
  none: "/companies",
};
