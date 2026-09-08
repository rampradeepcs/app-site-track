import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Tell a crew they have been added.
 *
 * Somebody sets up a company, types six colleagues into the wizard, and the
 * six get nothing: their records exist, their addresses are right, and not
 * one of them knows the app is waiting for them. This sends the mail.
 *
 * It has to run here rather than in the app because inviting is a service
 * role act, and the app is a static bundle handed to every user — a key in
 * it is a key given away. So the caller proves who they are with their own
 * token, this checks they administer the company they name, and only then
 * does the privileged part happen.
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
    .select("id, org_id, role")
    .eq("auth_id", who.user.id)
    .maybeSingle();
  if (meError) return json({ error: meError.message }, 400);
  if (!me || me.org_id !== orgId || !["admin", "manager"].includes(me.role)) {
    return json({ error: "You do not administer that company." }, 403);
  }

  // Who to write to. Taken from the company's own records rather than from
  // the request, so a caller cannot use this to mail arbitrary strangers:
  // the most they can do is invite people already on their own crew.
  let crew = asCaller
    .from("users")
    .select("id, name, email, auth_id")
    .eq("org_id", orgId)
    .is("auth_id", null);
  if (Array.isArray(body.emails) && body.emails.length) {
    crew = crew.in("email", body.emails.map((e) => e.toLowerCase().trim()));
  }
  const { data: people, error: crewError } = await crew;
  if (crewError) return json({ error: crewError.message }, 400);
  if (!people?.length) return json({ invited: 0, results: [] });

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const redirectTo = Deno.env.get("INVITE_REDIRECT_URL") ?? undefined;

  const results: Array<{ email: string; status: string; detail?: string }> = [];
  for (const person of people) {
    const email = (person.email ?? "").trim().toLowerCase();
    if (!email || email.endsWith("@placeholder.workfence.app")) {
      results.push({ email, status: "skipped", detail: "no real address" });
      continue;
    }
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: person.name, invited_to: orgId },
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (!error) {
      results.push({ email, status: "invited" });
    } else if (/already been registered|already registered|already exists/i.test(error.message)) {
      // They have an account; the record links itself on their next sign-in.
      results.push({ email, status: "already has an account" });
    } else {
      results.push({ email, status: "failed", detail: error.message });
    }
  }

  return json({
    invited: results.filter((r) => r.status === "invited").length,
    existing: results.filter((r) => r.status === "already has an account").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
});
