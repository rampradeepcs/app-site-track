import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { inviteHtml, inviteSubject, inviteText } from "./email.ts";

/**
 * Tell somebody they have been added to a company, and give them both ways in.
 *
 * Somebody sets up a company, types six colleagues into the wizard, and the
 * six get nothing: their records exist, their addresses are right, and not
 * one of them knows the app is waiting for them. This sends the mail.
 *
 * It covers every way a person is invited in this app, because there are two
 * and they used to behave differently:
 *
 *   - the onboarding wizard writes `users` rows with no auth account yet;
 *   - Team & Roles writes a row in `company_invitations`.
 *
 * The second sent nothing at all — it recorded "Invitation sent" in the audit
 * trail and notified the other administrators, while the person invited heard
 * nothing. Both are gathered here and both get the same letter.
 *
 * The letter carries the web address and a link to the Android build. The app
 * is linked and never attached: a release is ~38 MB, which is 51 MB once
 * base64-encoded into a message — past Resend's 40 MB ceiling and twice
 * Gmail's 25 MB — and every major provider strips an .apk attachment as
 * malware whatever its size. A link is the only form of it that arrives.
 *
 * It has to run here rather than in the app because inviting is a service
 * role act, and the app is a static bundle handed to every user — a key in it
 * is a key given away. So the caller proves who they are with their own
 * token, this checks they administer the company they name, and only then
 * does the privileged part happen. Who to write to is read from the company's
 * own records, never from the request, so the most a caller can do is mail
 * their own crew.
 *
 * Idempotent by nature: somebody who already has an account is reported as
 * such rather than treated as a failure, because re-running an invite for a
 * crew of ten where two have signed in should not look broken.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/** Where the Android build lives. A release asset, under a name that does not
 *  change between builds, so this link keeps working after the next one. */
const DEFAULT_APK_URL =
  "https://github.com/rampradeepcs/app-site-track/releases/download/android-latest/workfence.apk";

const isRealAddress = (e: string) =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !e.endsWith("@placeholder.workfence.app");

interface Recipient {
  email: string;
  name: string;
  role?: string;
  /** Set when they came from company_invitations, for the audit line. */
  invitationId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authorization = req.headers.get("Authorization") ?? "";

  // The caller, as themselves. Every policy resolves against them, so this
  // client can only see what they can see.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) return json({ error: "Sign in first." }, 401);

  let body: { orgId?: string; emails?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }
  const orgId = body.orgId?.trim();
  if (!orgId) return json({ error: "orgId is required." }, 400);

  // May this person invite for this company? Asked of the database as the
  // caller, so the answer is the same one every other screen gets.
  const { data: me, error: meError } = await asCaller
    .from("users")
    .select("id, name, org_id, role")
    .eq("auth_id", who.user.id)
    .maybeSingle();
  if (meError) return json({ error: meError.message }, 400);
  if (!me || me.org_id !== orgId || !["admin", "manager"].includes(me.role)) {
    return json({ error: "You do not administer that company." }, 403);
  }

  const wanted = Array.isArray(body.emails) && body.emails.length
    ? new Set(body.emails.map((e) => e.toLowerCase().trim()))
    : null;

  /*
   * Who to write to, from both halves of the app.
   *
   * Read as the caller so row-level security still decides what they may
   * see, and merged by address: a person can be in `users` and have a
   * pending invitation at the same time, and they should get one letter.
   */
  const [crewRes, invitesRes] = await Promise.all([
    asCaller
      .from("users")
      .select("id, name, email, role, auth_id")
      .eq("org_id", orgId)
      .is("auth_id", null),
    asCaller
      .from("company_invitations")
      .select("id, name, email, role, status")
      .eq("org_id", orgId)
      .eq("status", "pending"),
  ]);
  if (crewRes.error) return json({ error: crewRes.error.message }, 400);

  const byEmail = new Map<string, Recipient>();
  for (const p of crewRes.data ?? []) {
    const email = (p.email ?? "").trim().toLowerCase();
    if (!email) continue;
    if (wanted && !wanted.has(email)) continue;
    byEmail.set(email, { email, name: (p.name ?? "").trim(), role: p.role ?? undefined });
  }
  // Invitations win on name and role: they are the more recent statement of
  // who this person is meant to be.
  for (const inv of invitesRes.data ?? []) {
    const email = (inv.email ?? "").trim().toLowerCase();
    if (!email) continue;
    if (wanted && !wanted.has(email)) continue;
    byEmail.set(email, {
      email,
      name: (inv.name ?? byEmail.get(email)?.name ?? "").trim(),
      role: inv.role ?? byEmail.get(email)?.role,
      invitationId: inv.id,
    });
  }

  const people = [...byEmail.values()];
  if (!people.length) return json({ invited: 0, results: [] });

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The company's own details, so the letter names them rather than the app.
  const [{ data: org }, { data: site }] = await Promise.all([
    admin.from("organizations").select("name, slug").eq("id", orgId).maybeSingle(),
    admin.from("projects").select("name").eq("org_id", orgId).order("created_at").limit(1).maybeSingle(),
  ]);
  if (!org) return json({ error: "No such company." }, 404);

  const appUrl = Deno.env.get("APP_URL") ?? "https://app-site-track.vercel.app";
  const base = Deno.env.get("TENANT_BASE_DOMAIN");
  const tenantUrl = org.slug ? (base ? `https://${org.slug}.${base}` : `${appUrl}/t/${org.slug}`) : undefined;
  // Set APK_URL to "" to leave the Android block out of the letter entirely.
  const apkRaw = Deno.env.get("APK_URL");
  const apkUrl = apkRaw === "" ? undefined : (apkRaw ?? DEFAULT_APK_URL);
  const redirectTo = Deno.env.get("INVITE_REDIRECT_URL") ?? tenantUrl ?? appUrl;

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") ?? "Workfence <onboarding@resend.dev>";
  const reply = Deno.env.get("MAIL_REPLY_TO");

  const results: Array<{ email: string; status: string; detail?: string }> = [];

  for (const person of people) {
    const email = person.email;
    if (!isRealAddress(email)) {
      results.push({ email, status: "skipped", detail: "no real address" });
      continue;
    }

    /*
     * Without a mail provider this falls back to Supabase's own invitation
     * mail. It says far less — no web address of their own, no app — but an
     * invite that is plain is better than an invite that never goes, and it
     * is what this function did before it could write its own letters.
     */
    if (!resendKey) {
      const { error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: person.name, invited_to: orgId },
        ...(redirectTo ? { redirectTo } : {}),
      });
      if (!error) results.push({ email, status: "invited", detail: "provider default mail" });
      else if (/already been registered|already registered|already exists/i.test(error.message)) {
        results.push({ email, status: "already has an account" });
      } else results.push({ email, status: "failed", detail: error.message });
      continue;
    }

    /*
     * A link that signs them in and lands them in the app. Generated rather
     * than sent, because the letter around it is ours: generateLink hands
     * back the URL without mailing anything.
     *
     * An address that already has an account cannot be invited again, so it
     * gets a magic link instead — same door, different key.
     */
    let actionUrl: string | undefined;
    let existing = false;
    const invited = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { full_name: person.name, invited_to: orgId }, redirectTo },
    });
    if (invited.data?.properties?.action_link) {
      actionUrl = invited.data.properties.action_link;
    } else if (
      invited.error &&
      /already been registered|already registered|already exists/i.test(invited.error.message)
    ) {
      existing = true;
      const magic = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });
      actionUrl = magic.data?.properties?.action_link ?? undefined;
    } else if (invited.error) {
      results.push({ email, status: "failed", detail: invited.error.message });
      continue;
    }

    const input = {
      name: person.name || email.split("@")[0],
      company: org.name,
      invitedBy: (me.name ?? "").trim() || undefined,
      role: person.role,
      siteName: site?.name ?? undefined,
      appUrl,
      tenantUrl,
      actionUrl,
      apkUrl,
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: inviteSubject(input),
        html: inviteHtml(input),
        text: inviteText(input),
        ...(reply ? { reply_to: reply } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      results.push({ email, status: "failed", detail: `the provider refused: ${detail.slice(0, 200)}` });
      continue;
    }

    results.push({ email, status: existing ? "already has an account" : "invited" });

    // Recorded per person, on a send that actually happened, so a partial
    // run can be retried and read afterwards.
    await admin.from("audit_log").insert({
      org_id: orgId,
      actor_id: me.id,
      action: "member.invite.sent",
      target: email,
      detail: `Invitation email sent to ${email}${apkUrl ? " with the web address and the Android app" : " with the web address"}`,
    });
  }

  return json({
    invited: results.filter((r) => r.status === "invited").length,
    existing: results.filter((r) => r.status === "already has an account").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
});
