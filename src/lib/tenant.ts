"use client";

/**
 * A client's own address under ours.
 *
 * Every company has a slug — magnolia — and two ways to be reached by it:
 *
 *   /t/magnolia                a path, which works on any host, today
 *   magnolia.<base domain>     a subdomain, once a domain we own points here
 *
 * The path came first because the subdomain cannot: a wildcard on Vercel has
 * to be verified by nameservers, vercel.app belongs to Vercel, and its names
 * are projects rather than hosts — so *.<project>.vercel.app is not a thing
 * that can be configured, only a thing that can be bought a domain for. The
 * path costs nothing and needs no DNS.
 *
 * The subdomain switches itself on when NEXT_PUBLIC_TENANT_BASE_DOMAIN is
 * set. Until then a hostname names nobody, deliberately: guessing a base
 * domain would brand a preview deployment as a client.
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

/** Where a slug is reached from: /t/magnolia. */
export const TENANT_PATH_PREFIX = "/t";

export function tenantPath(slug: string): string {
  return `${TENANT_PATH_PREFIX}/${slug}`;
}

/**
 * The address to show beside the field and hand to a client.
 *
 * The subdomain once there is a domain to hang it on, the path until then —
 * so what the console shows is always somewhere that actually opens, rather
 * than an aspiration with a placeholder in it.
 */
export function tenantUrl(slug: string): string {
  const name = slug || "…";
  if (TENANT_BASE_DOMAIN) return `${name}.${TENANT_BASE_DOMAIN}`;
  const origin =
    typeof window === "undefined"
      ? ""
      : window.location.host + (process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  return `${origin}${tenantPath(name)}`;
}

/** The slug named by a hostname, or null when this host is nobody's. */
export function tenantSlugFromHost(hostname: string): string | null {
  const host = hostname.toLowerCase().split(":")[0];
  if (!TENANT_BASE_DOMAIN || !host.endsWith(`.${TENANT_BASE_DOMAIN}`)) return null;
  const sub = host.slice(0, -(TENANT_BASE_DOMAIN.length + 1));
  if (!sub || sub.includes(".") || RESERVED.has(sub)) return null;
  return sub;
}

/** The slug named by a path: /t/magnolia, with or without a trailing slash. */
export function tenantSlugFromPath(pathname: string): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const path = (base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname)
    .replace(/\/+$/, "");
  if (!path.startsWith(`${TENANT_PATH_PREFIX}/`)) return null;
  const sub = path.slice(TENANT_PATH_PREFIX.length + 1).toLowerCase();
  if (!sub || sub.includes("/") || !isValidSlug(sub)) return null;
  return sub;
}

/** Whichever of the two named a company, path first — it is the explicit one. */
export function tenantSlugFromLocation(loc: {
  hostname: string;
  pathname: string;
}): string | null {
  return tenantSlugFromPath(loc.pathname) ?? tenantSlugFromHost(loc.hostname);
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
    const slug = tenantSlugFromLocation(window.location);
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
