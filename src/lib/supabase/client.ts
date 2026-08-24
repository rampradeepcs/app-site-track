"use client";

/**
 * Supabase client + backend-mode switch.
 *
 * SiteTrack runs in one of two modes:
 *   • demo   — no credentials configured; the seeded localStorage store drives
 *              everything, so the product is fully explorable with no backend.
 *   • live   — NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are set; reads and writes go
 *              to Postgres, and row-level security enforces tenant isolation.
 *
 * Keeping both is deliberate: the demo is how the app is shown, and the live
 * path is how it runs. Nothing in the UI layer needs to know which is active.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when real credentials are present. */
export const isLiveBackend = Boolean(URL && ANON);

let cached: SupabaseClient<Database> | null = null;

/**
 * The browser client, or null in demo mode. Callers must handle null rather
 * than assume a backend — that is what keeps the demo path honest.
 */
export function supabase(): SupabaseClient<Database> | null {
  if (!isLiveBackend) return null;
  if (!cached) {
    cached = createClient<Database>(URL!, ANON!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return cached;
}

/** Throws when called in demo mode — use at call sites that require a backend. */
export function requireSupabase(): SupabaseClient<Database> {
  const c = supabase();
  if (!c) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY to run against a real backend.",
    );
  }
  return c;
}
