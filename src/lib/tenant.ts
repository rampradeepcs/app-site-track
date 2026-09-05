"use client";

/**
 * A client's own address under ours.
 *
 * Every company has a slug — magnolia — and, once a domain with a wildcard
 * points at this deployment, magnolia.<that domain> opens the app branded
 * for them. Nothing here is a domain the client owns; that is a different
 * feature, and not a wired one. This is the subdomain.
 *
 * The base domain comes from NEXT_PUBLIC_TENANT_BASE_DOMAIN. Until it is
 * set nothing resolves: a Vercel project address cannot carry subdomains,
 * and guessing a base from the hostname would brand a preview deployment
 * as a client.
 */

import { fetchTenantBranding } from "./supabase/repository";
import { useEffect, useState } from "react";

export const TENANT_BASE_DOMAIN = (process.env.NEXT_PUBLIC_TENANT_BASE_DOMAIN ?? "")
  .trim()
  .toLowerCase();

const RESERVED = new Set([
  "www", "app", "api", "admin", "platform", "mail", "static", "assets", "cdn", "auth", "login",
]);

/** "Born Creative Construction" -> "born-creative-construction". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/.test(slug) && !RESERVED.has(slug);
}

/** The address a slug will open, for showing next to the field. */
export function tenantUrl(slug: string): string {
  return `${slug || "…"}.${TENANT_BASE_DOMAIN || "<your domain>"}`;
}

/** The slug named by a hostname, or null when this host is nobody's. */
export function tenantSlugFromHost(hostname: string): string | null {
  const host = hostname.toLowerCase().split(":")[0];
  if (!TENANT_BASE_DOMAIN || !host.endsWith(`.${TENANT_BASE_DOMAIN}`)) return null;
  const sub = host.slice(0, -(TENANT_BASE_DOMAIN.length + 1));
  if (!sub || sub.includes(".") || RESERVED.has(sub)) return null;
  return sub;
}

export interface TenantBranding {
  slug: string;
  name: string;
  appName: string;
  accent?: string;
  logoText?: string;
  status: string;
}

let pending: Promise<TenantBranding | null> | null = null;

/** Who this hostname belongs to, looked up once per page load. */
export function loadTenant(): Promise<TenantBranding | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!pending) {
    const slug = tenantSlugFromHost(window.location.hostname);
    pending = slug
      ? fetchTenantBranding(slug).catch(() => null)
      : Promise.resolve(null);
  }
  return pending;
}

/** undefined while looking, null for nobody's host, else the company. */
export function useTenant(): TenantBranding | null | undefined {
  const [tenant, setTenant] = useState<TenantBranding | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void loadTenant().then((t) => {
      if (!cancelled) setTenant(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return tenant;
}
