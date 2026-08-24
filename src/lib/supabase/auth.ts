"use client";

/**
 * Authentication for live mode.
 *
 * This matters more than it looks: every RLS policy resolves through
 * `auth.uid()`, so without a real Supabase session the database correctly
 * returns nothing. Data hydration and auth are not independent features —
 * live mode needs both or it silently shows empty screens.
 *
 * The demo path keeps its mock OTP (any 4 digits) so the product stays
 * explorable with no backend; these functions are only reached when
 * credentials are configured.
 */

import { requireSupabase, supabase } from "./client";
import type { User } from "../types";
import { toUser } from "./repository";
import type { UserRow } from "./types";

export interface AuthResult {
  ok: boolean;
  error?: string;
}

/**
 * Send a one-time code. Phone is the primary channel — site workers are far
 * more likely to have a number than a work email — with email as fallback.
 */
export async function sendOtp(identifier: string): Promise<AuthResult> {
  const sb = requireSupabase();
  const isEmail = identifier.includes("@");
  const { error } = isEmail
    ? await sb.auth.signInWithOtp({ email: identifier })
    : await sb.auth.signInWithOtp({ phone: normalisePhone(identifier) });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function verifyOtp(
  identifier: string,
  token: string,
): Promise<AuthResult> {
  const sb = requireSupabase();
  const isEmail = identifier.includes("@");
  const { error } = await sb.auth.verifyOtp(
    isEmail
      ? { email: identifier, token, type: "email" }
      : { phone: normalisePhone(identifier), token, type: "sms" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  const sb = supabase();
  if (sb) await sb.auth.signOut();
}

/**
 * Resolve the signed-in auth identity to this product's user record.
 *
 * Returns null when authenticated but unlinked — a real state worth handling
 * explicitly: someone with valid credentials who has not been added to any
 * organisation should be told so, not shown an empty app.
 */
export async function currentAppUser(): Promise<User | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data: session } = await sb.auth.getUser();
  if (!session.user) return null;
  const { data, error } = await sb
    .from("users")
    .select("*")
    .eq("auth_id", session.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return toUser(data as UserRow);
}

/** Fires on sign-in, sign-out and token refresh. */
export function onAuthChange(cb: (signedIn: boolean) => void): () => void {
  const sb = supabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((event) => {
    cb(event === "SIGNED_IN" || event === "TOKEN_REFRESHED");
  });
  return () => data.subscription.unsubscribe();
}

/** Defaults to India's country code, matching the seeded workforce. */
function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}
