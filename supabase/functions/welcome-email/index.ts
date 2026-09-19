import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { welcomeHtml, welcomeSubject, welcomeText } from "./email.ts";

/**
 * Welcome somebody to the company they just created.
 *
 * Sent once, from here rather than from the app, for the same reason the
 * invitations are: the app is a static bundle handed to every user, and a
 * mail provider's key in it is a key given away.
 *
 * Everything the letter says is read from the database, not from the
 * request. The caller says which company; this checks they administer it and
 * then looks up its name, its site, its trial and how many people are still
 * waiting to accept. A request cannot make this address a stranger or lie
 * about who they are joining.
 *
 * Idempotent: the send is recorded in the company's audit trail, and a
 * second call finds that record and does nothing. Signing up is a moment
 * somebody may retry — a slow network, a tapped button twice — and none of
 * those should put two letters in an inbox.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("Authorization") ?? "";

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) return json({ error: "Sign in first." }, 401);

  let body: { orgId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }
  const orgId = body.orgId?.trim();
  if (!orgId) return json({ error: "orgId is required." }, 400);

  // Do they administer this company? Asked of the database as them, so the
  // answer is the one every other screen would get.
  const { data: me } = await asCaller
    .from("users")
    .select("id, name, email, org_id, role")
    .eq("auth_id", who.user.id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!me || me.role !== "admin") {
    return json({ error: "You do not administer that company." }, 403);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Already sent? The audit trail is the record, so this survives a restart
  // and needs no table of its own.
  const { data: already } = await admin
    .from("audit_log")
    .select("id")
    .eq("org_id", orgId)
    .eq("action", "company.welcome")
    .limit(1);
  if (already?.length) return json({ sent: false, reason: "already sent" });

  const [{ data: org }, { data: site }, { data: sub }, { count: waiting }] = await Promise.all([
    admin.from("organizations").select("name, slug, status").eq("id", orgId).maybeSingle(),
    admin.from("projects").select("name").eq("org_id", orgId).order("created_at").limit(1).maybeSingle(),
    admin.from("subscriptions").select("trial_ends_at").eq("org_id", orgId).maybeSingle(),
    admin
      .from("company_invitations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
  ]);
  if (!org) return json({ error: "No such company." }, 404);

  const to = (me.email ?? "").trim().toLowerCase();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return json({ sent: false, reason: "no address on the administrator" });
  }

  const appUrl = Deno.env.get("APP_URL") ?? "https://live.workfence.app";
  const base = Deno.env.get("TENANT_BASE_DOMAIN");
  const trialDays = sub?.trial_ends_at
    ? Math.max(
        0,
        Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86_400_000),
      )
    : undefined;

  // Absolute, because mail cannot fetch a relative path, and served from the
  // app rather than the marketing domain so it is there whatever that domain
  // currently points at. Set either to "" to drop it.
  const logoRaw = Deno.env.get("LOGO_URL");
  const logoUrl = logoRaw === "" ? undefined : (logoRaw ?? `${appUrl}/brand/workfence-mark.png`);
  const siteRaw = Deno.env.get("SITE_URL");
  const siteUrl = siteRaw === "" ? undefined : (siteRaw ?? "www.workfence.app");

  const input = {
    name: (me.name || to.split("@")[0]).trim(),
    company: org.name,
    appUrl,
    tenantUrl: org.slug
      ? base
        ? `https://${org.slug}.${base}`
        : `${appUrl}/t/${org.slug}`
      : undefined,
    crewInvited: waiting ?? 0,
    siteName: site?.name ?? undefined,
    trialDays: trialDays && trialDays > 0 ? trialDays : undefined,
    logoUrl,
    siteUrl,
  };

  /*
   * The provider. Resend is one HTTP call and needs no connection to hold
   * open, which suits a function that runs for a second and stops.
   *
   * Without a key nothing is sent and the caller is told so plainly, rather
   * than being handed a success for a letter that never left. The company is
   * already created either way — a welcome that cannot be sent is not a
   * reason to fail a signup.
   */
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return json({
      sent: false,
      reason:
        "no email provider configured — set RESEND_API_KEY on this function to send welcome mail",
    });
  }

  const from = Deno.env.get("MAIL_FROM") ?? "Workfence <onboarding@resend.dev>";
  const reply = Deno.env.get("MAIL_REPLY_TO");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: welcomeSubject(input),
      html: welcomeHtml(input),
      text: welcomeText(input),
      ...(reply ? { reply_to: reply } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return json({ sent: false, reason: `the provider refused: ${detail.slice(0, 300)}` }, 502);
  }

  // Recorded only on a send that actually happened, so a failure can be
  // retried and a success never repeats.
  await admin.from("audit_log").insert({
    org_id: orgId,
    actor_id: me.id,
    action: "company.welcome",
    target: to,
    detail: `Welcome email sent to ${to}`,
  });

  return json({ sent: true, to });
});
