"use client";

/**
 * Which company this device is working in.
 *
 * One person, one sign-in, several companies: the token says who, and this
 * says which. It travels on every request as a header, and the database
 * decides whether to honour it — a company named here is used only when the
 * caller holds a live membership in it, so the value is a preference, never
 * an authority. Remove someone from a company and the header they still
 * send stops meaning anything on the next request.
 *
 * Kept per device on purpose. A manager at a desk in one company and on a
 * phone at another's site is two contexts, not one.
 */

export const COMPANY_HEADER = "x-workfence-company";
const KEY = "workfence.company";

let current: string | null | undefined;
const listeners = new Set<() => void>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function read(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v && UUID.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** The active company's id, or null when none has been chosen. */
export function activeCompanyId(): string | null {
  if (current === undefined) current = read();
  return current;
}

export function setActiveCompany(orgId: string | null): void {
  current = orgId && UUID.test(orgId) ? orgId : null;
  try {
    if (current) window.localStorage.setItem(KEY, current);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lives for this page only */
  }
  for (const l of listeners) l();
}

export function subscribeActiveCompany(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The header every request carries, when a company is chosen. */
export function companyHeaders(): Record<string, string> {
  const id = activeCompanyId();
  return id ? { [COMPANY_HEADER]: id } : {};
}
