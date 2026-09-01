"use client";

/**
 * Authentication for live mode.
 *
 * This matters more than it looks: every RLS policy resolves through
 * `auth.uid()`, so without a real Supabase session the database correctly
 * returns nothing. Data hydration and auth are not independent features —
 * live mode needs both or it silently shows empty screens.
 *
 * The local gate keeps a mock code (any 4 digits) so the product works with
 * no backend at all; these functions are only reached when credentials are
 * configured.
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
 * Send a one-time code to an email address.
 *
 * Email only, because email is the identity: a code sent to a number would
 * authenticate someone the app can no longer look up.
 */
export async function sendOtp(identifier: string): Promise<AuthResult> {
  try {
    const sb = requireSupabase();
    const { error } = await sb.auth.signInWithOtp({
      email: identifier.trim().toLowerCase(),
    });
    return error ? { ok: false, error: describe(error) } : { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export async function verifyOtp(
  identifier: string,
  token: string,
): Promise<AuthResult> {
  try {
    const sb = requireSupabase();
    const { error } = await sb.auth.verifyOtp({
      email: identifier.trim().toLowerCase(),
      token,
      type: "email",
    });
    return error ? { ok: false, error: describe(error) } : { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
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

/**
 * Turn a thrown failure into something a person on a site can act on.
 *
 * A network-layer failure surfaces as a bare "Failed to fetch" — no signal,
 * blocked host, misconfigured project URL all look identical — which reads to
 * a user as though the app is broken. Naming the likely cause is the
 * difference between "try again on better signal" and a support call. Note
 * this handles both shapes: Supabase returns such failures as an `error`
 * value, and only a missing client actually throws.
 */
function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return msg;
}


/* ------------------------------------------------------------- SSO ------ */

/**
 * Single sign-on providers offered at onboarding.
 *
 * "azure" is Supabase's name for the Microsoft identity platform, which is
 * what an Outlook or Microsoft 365 account signs in with — the label says
 * Outlook because that is what the person clicking it calls their account.
 */
export type SsoProvider = "google" | "azure";

export const SSO_PROVIDERS: Array<{ id: SsoProvider; label: string }> = [
  { id: "google", label: "Continue with Google" },
  { id: "azure", label: "Continue with Outlook" },
];

/** True inside the Capacitor shell, where OAuth cannot use the WebView. */
function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
}

/** The address the provider sends the browser back to when it is done. */
function redirectTarget(): string {
  // A custom scheme on device, because there is no http origin to return to
  // that the system browser could hand back to this app.
  return isNative()
    ? "app.workfence.workforce://auth-callback"
    : `${window.location.origin}/`;
}

/**
 * Start a single sign-on.
 *
 * On the web this is an ordinary redirect and the session is picked up on
 * return. On a device it is deliberately *not*: Google refuses OAuth inside
 * an embedded WebView — the error is `disallowed_useragent` and there is no
 * way around it, by design, because an app that renders the sign-in page can
 * read the password out of it. So the URL is opened in the system browser
 * and the answer arrives back through a deep link.
 */
export async function signInWithProvider(
  provider: SsoProvider,
): Promise<AuthResult> {
  try {
    const sb = requireSupabase();
    const { data, error } = await sb.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectTarget(),
        skipBrowserRedirect: isNative(),
      },
    });
    if (error) return { ok: false, error: describe(error) };
    if (isNative() && data?.url) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url, presentationStyle: "popover" });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/**
 * Finish a native sign-in from the deep link the browser returned to.
 *
 * Accepts both shapes a provider may send back: a PKCE `code` in the query,
 * and the implicit `access_token` pair in the fragment, because which one
 * arrives depends on how the Supabase project is configured and being wrong
 * about it would strand the user on a blank screen.
 */
export async function completeOAuthRedirect(url: string): Promise<AuthResult> {
  try {
    const sb = requireSupabase();
    const parsed = new URL(url);
    const code = parsed.searchParams.get("code");
    if (code) {
      /*
       * The flow id has to be handed over explicitly.
       *
       * supabase-js keeps a PKCE verifier per concurrent flow, under
       * `<key>-flow-<id>-code-verifier`. Given no flow id it looks for one in
       * `window.location.href` — which on the web is the callback URL and on
       * a device is `https://localhost/`, the WebView's own address. The id
       * is in the deep link, which that never sees, so the lookup fell
       * through to the legacy fixed key, found nothing, and every device
       * sign-in failed with "PKCE code verifier not found in storage" while
       * the real verifier sat in storage one key away.
       */
      const flowId = parsed.searchParams.get("sb_flow_id");
      const { error } = await sb.auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      );
      return error ? { ok: false, error: describe(error) } : { ok: true };
    }
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (access_token && refresh_token) {
      const { error } = await sb.auth.setSession({ access_token, refresh_token });
      return error ? { ok: false, error: describe(error) } : { ok: true };
    }
    /* Providers put a refusal in either half of the URL depending on the
       response mode, so look in both before giving up — the difference
       between naming the reason and shrugging. */
    const denied =
      parsed.searchParams.get("error_description") ??
      parsed.searchParams.get("error") ??
      hash.get("error_description") ??
      hash.get("error");
    return { ok: false, error: denied ?? "Sign-in did not complete." };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/**
 * The address the current session is authenticated as.
 *
 * Needed because a single sign-on never passes through the form: after a
 * Google or Outlook return there is a valid session and an email, but the
 * screen has no idea what was typed — nothing was. This is how it finds out
 * who just arrived, and therefore whether they are new.
 */
export async function currentAuthEmail(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.email ?? null;
}
