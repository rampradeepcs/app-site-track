"use client";

/**
 * Supabase client + backend-mode switch.
 *
 * Workfence runs in one of two modes:
 *   • local  — no credentials configured; the localStorage store drives
 *              everything, so the product is fully explorable with no backend.
 *   • live   — NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are set; reads and writes go
 *              to Postgres, and row-level security enforces tenant isolation.
 *
 * Keeping both is deliberate: local mode is a working product with no server
 * to run, and live mode is how it runs for a company. Nothing in the UI layer
 * needs to know which is active.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when real credentials are present. */
export const isLiveBackend = Boolean(URL && ANON);

let cached: SupabaseClient<Database> | null = null;

/**
 * The browser client, or null in local mode. Callers must handle null rather
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

/** Throws in local mode — use at call sites that require a backend. */
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
