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
import { describeError } from "../errors";
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
 *
 * Throws when it could not find out. That is a different answer, and it used
 * to be the same one: a dropped connection on a site, an RPC that failed, a
 * read that matched two rows — each came back null, every caller reads null
 * as "nobody here yet", and an existing member was sent to found a company
 * and, once there, could found a second one. "I don't know" now says so, and
 * the screens offer to try again rather than to start over.
 */
export async function currentAppUser(): Promise<User | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data: session, error: sessionError } = await sb.auth.getUser();
  // No session is an answer; anything else — the network, the server — is not.
  if (sessionError && sessionError.name !== "AuthSessionMissingError") throw sessionError;
  if (!session.user) return null;

  /*
   * An account with no confirmed address cannot be matched to anybody — the
   * address is the identity, and an unproven one is not evidence. Microsoft
   * can produce exactly this, depending on how the app is registered. It is
   * not "a new person" either, so it does not go to found a company: it is
   * told what to do instead.
   */
  const u = session.user;
  if (!u.email || !(u.email_confirmed_at || u.confirmed_at)) {
    throw new Error(
      "This sign-in didn't come with a confirmed email address, so it can't be matched to your company. Sign in with the emailed code instead.",
    );
  }

  /*
   * One call links, refreshes and reads.
   *
   * sync_my_profile claims an unclaimed record bearing the confirmed address,
   * brings it up to date with what Google or Outlook just said about the
   * person — name and phone where the record had none, the photograph, which
   * provider vouched and when — and hands the row back. The database does
   * the same on its own at every sign-in, whichever control was used; asking
   * here as well covers the one moment that trigger cannot see: right after
   * provision_company, when the founder's record is younger than their
   * sign-in.
   */
  const { data: synced, error: syncError } = await sb.rpc("sync_my_profile");
  if (!syncError) {
    /* A removed membership is not a way in. The list includes them so the
       caller can tell "removed" from "never added", but a person who still
       belongs somewhere must land there, not on the company that let them
       go. */
    const rows = (synced ?? []) as UserRow[];
    const row = rows.find((r) => r.status !== "revoked") ?? rows[0];
    return row ? toUser(row) : null;
  }
  if (!isMissingFunction(syncError)) throw syncError;

  /*
   * A backend that predates the sync answers "function not found". Fall back
   * to the older two steps — read, then claim by address — so an app in the
   * field keeps signing people in against a database that has not caught up.
   * Ordered and limited rather than maybeSingle: a person in two companies
   * has two rows, and "more than one" is not "none".
   */
  const read = async (): Promise<User | null> => {
    const { data, error } = await sb
      .from("users")
      .select("*")
      .eq("auth_id", session.user!.id)
      .order("joined_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    const row = (data ?? [])[0];
    return row ? toUser(row as UserRow) : null;
  };
  const linked = await read();
  if (linked) return linked;
  const { error: claimError } = await sb.rpc("claim_user_record");
  if (claimError) throw claimError;
  return read();
}

/** PostgREST's "no such function", and Postgres's — the old-backend case. */
function isMissingFunction(e: { code?: string } | null): boolean {
  return e?.code === "PGRST202" || e?.code === "42883";
}

/**
 * What just happened to the session.
 *
 * This used to collapse every event to a boolean, and both listeners then
 * ignored the false case — so a refresh token that expired, was revoked, or
 * belonged to a deleted account ended the real session and left the app
 * looking signed in, on stale cached data, with every write failing quietly.
 * Naming the two outcomes is what makes the second one impossible to drop.
 */
export type AuthChange = "signed-in" | "signed-out";

export function onAuthChange(cb: (event: AuthChange) => void): () => void {
  const sb = supabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") cb("signed-in");
    else if (event === "SIGNED_OUT") cb("signed-out");
    // INITIAL_SESSION, USER_UPDATED and PASSWORD_RECOVERY say nothing about
    // whether there is still a session, so they say nothing here either.
  });
  return () => data.subscription.unsubscribe();
}

/**
 * Is there still a session stored on this device?
 *
 * Deliberately a local read. A worker at a site gate with no signal must not
 * be signed out for it, and supabase-js agrees: a refresh that fails on the
 * network keeps the stored session, and only a refusal the server actually
 * gave — an expired or revoked refresh token — clears it. So "nothing
 * stored" means the session really ended, not that the phone is offline.
 */
export async function hasStoredSession(): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { data } = await sb.auth.getSession();
  return !!data.session;
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
  const msg = describeError(e);
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
 * What to ask each provider for.
 *
 * Google returns the address by default; Microsoft does not. Its default is
 * a bare `openid`, which proves somebody signed in and says nothing about
 * who they are — and this app has no second way to find out. A person is
 * matched to their company by email address and by nothing else, so an
 * Outlook sign-in that comes back without one arrives authenticated and
 * unplaceable, which looks like a different bug entirely.
 *
 * It is asked for here because it cannot be asked for anywhere else: the
 * Supabase dashboard has no scopes field for Azure.
 */
const SCOPES: Record<SsoProvider, string> = {
  google: "email profile",
  azure: "openid email profile",
};

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
        scopes: SCOPES[provider],
        skipBrowserRedirect: isNative(),
      },
    });
    if (error) return { ok: false, error: describe(error) };
    if (isNative() && data?.url) {
      markNativeSignInPending();
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url, presentationStyle: "popover" });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/* --------------------------------------- a sign-in this device started -- */

const NATIVE_PENDING_KEY = "workfence.sso.pending";
/** Long enough to finish a sign-in in the browser, short enough to expire. */
const NATIVE_PENDING_MS = 15 * 60_000;

function markNativeSignInPending(): void {
  try {
    localStorage.setItem(NATIVE_PENDING_KEY, String(Date.now()));
  } catch {
    /* without storage the return is refused, which is the safe direction */
  }
}

/**
 * Whether a sign-in callback arriving now is one this device asked for —
 * and forget the request either way.
 *
 * The app's URL scheme can be opened by any web page, not only by the
 * browser finishing a sign-in. A link nobody here started is not a sign-in
 * to complete: answered, it would at best show a stranger's error text and
 * at worst swap whose account the phone is signed in to.
 */
export function consumeNativeSignInPending(): boolean {
  try {
    const at = Number(localStorage.getItem(NATIVE_PENDING_KEY) ?? "");
    localStorage.removeItem(NATIVE_PENDING_KEY);
    return Number.isFinite(at) && at > 0 && Date.now() - at < NATIVE_PENDING_MS;
  } catch {
    return false;
  }
}

/**
 * Why Google or Microsoft refused, in words a person can act on.
 *
 * Only fixed sentences: the raw text arrives in a URL anybody can write, and
 * shown under this product's name it would be a ready-made phishing line.
 * The raw value goes to the console for support, never to the screen.
 */
export function explainProviderRefusal(raw: string): string {
  const msg = raw.replace(/\+/g, " ");
  console.warn("[sso] provider refusal:", msg.slice(0, 300));
  if (/unverified email/i.test(msg)) {
    return "Microsoft didn't confirm this email address, so it can't be used to sign in here. Sign in with the emailed code instead, or ask your administrator to verify the address in Microsoft.";
  }
  if (/error getting user email/i.test(msg)) {
    return "This account didn't share an email address, so it can't be matched to your company. Sign in with the emailed code instead.";
  }
  if (/multiple accounts with the same email/i.test(msg)) {
    return "This email address belongs to more than one sign-in account. Sign in with the emailed code, and ask support to merge them.";
  }
  if (/access_denied|cancel/i.test(msg)) return "Sign-in was cancelled.";
  return "Sign-in with Google or Microsoft didn't complete. Try again, or use the emailed code.";
}

/**
 * Finish a native sign-in from the deep link the browser returned to.
 *
 * The PKCE `code` only. This used to accept an `access_token` pair in the
 * fragment too, "in case" the project were configured for the implicit
 * flow — it is not, and that branch would set whatever session a link
 * carried: any page could open the app's scheme with its own tokens and
 * sign the phone in as somebody else, with their check-ins, photos and
 * route recorded under that account from then on. A code is safe in the
 * same position because it is useless without this device's verifier.
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
    /* Providers put a refusal in either half of the URL depending on the
       response mode, so look in both before giving up — the difference
       between naming the reason and shrugging. Said in our words, not
       theirs: see explainProviderRefusal. */
    const denied =
      parsed.searchParams.get("error_description") ??
      parsed.searchParams.get("error") ??
      hash.get("error_description") ??
      hash.get("error");
    return {
      ok: false,
      error: denied ? explainProviderRefusal(denied) : "Sign-in did not complete.",
    };
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
/**
 * The signed-in address, read from the stored session.
 *
 * currentAuthEmail asks the server, which is the right answer when the
 * question is "is this token still good". It is the wrong one for "who is
 * already signed in on this device": it costs a round trip, it is unanswerable
 * offline, and a single blip makes it indistinguishable from nobody being
 * signed in — which on the onboarding screen meant emailing a code to an
 * address the user had just proved through Google.
 */
export type SessionIdentity = { email: string; name: string | null };

/**
 * Who is signed in on this device, and what the provider called them.
 *
 * Google and Outlook both hand over a display name with the address. Asking
 * someone to type a name their identity provider just supplied is a form to
 * fill in for no reason, so onboarding starts from this.
 */
export async function sessionIdentity(): Promise<SessionIdentity | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user?.email) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  /* Providers disagree on the key: Google sends full_name, Azure tends to
     send name. Take the first that is actually a name. */
  const named = ["full_name", "name", "display_name", "preferred_username"]
    .map((k) => meta[k])
    .find((v): v is string => typeof v === "string" && v.trim().length > 0);
  return { email: user.email, name: named?.trim() ?? null };
}

export async function sessionEmail(): Promise<string | null> {
  return (await sessionIdentity())?.email ?? null;
}

export async function currentAuthEmail(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.email ?? null;
}
