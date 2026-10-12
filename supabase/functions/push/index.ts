/**
 * Push — every notification, to every device that asked for it.
 *
 *   GET   → { publicKey,    The web-push signing key's public half, which a
 *             native }     browser subscribes with. The key pair is made here
 *                          on the first request and kept in the database
 *                          (private.push_config); the private half never
 *                          leaves this function and the database. `native`
 *                          says whether Android and iOS pushes can be sent,
 *                          so a phone knows whether to leave its alerts to
 *                          the push or post them itself.
 *
 *   POST  { id }           Deliver notification `id`. Called by the database
 *                          itself — the trigger on public.notifications, via
 *                          pg_net — and accepted only with the shared secret
 *                          that trigger sends. Who receives it, and on which
 *                          devices, is decided in SQL (push_recipients): the
 *                          same audience rule as the app's feed, and each
 *                          person's own preference for that kind of event.
 *
 * Deployed with verify_jwt off because its caller is the database, which has
 * no user token; the POST is authenticated by the secret instead, and the GET
 * returns nothing that is not public.
 *
 * Web push always works. Android (FCM) and iOS (APNs) switch themselves on
 * when their secrets are set — see native.ts.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { generateVapidKeys, sendWebPush, type SendOutcome, type VapidKeys } from "./webpush.ts";
import { apnsConfigured, fcmConfigured, sendApns, sendFcm, type PushMessage } from "./native.ts";

// x-workfence-company rides on every request the app makes (its Supabase
// client adds it), so a preflight that does not allow it fails in the browser.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-workfence-company",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/** Who the push services contact if this server misbehaves. */
const SUBJECT = Deno.env.get("PUSH_SUBJECT") ?? "mailto:push@workfence.app";

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

interface Config {
  vapid_public: string | null;
  vapid_private: string | null;
  trigger_secret: string;
}

/** The stored keys, made on first use. Two first requests race safely: the
 *  save keeps whichever pair landed first and returns it to both. */
async function vapidKeys(db: ReturnType<typeof admin>): Promise<VapidKeys> {
  const { data, error } = await db.rpc("push_service_config");
  if (error) throw error;
  const cfg = (data as Config[] | Config | null);
  const row = Array.isArray(cfg) ? cfg[0] : cfg;
  if (row?.vapid_public && row.vapid_private) {
    return { publicKey: row.vapid_public, privateJwk: row.vapid_private };
  }
  const fresh = await generateVapidKeys();
  const { data: saved, error: saveError } = await db.rpc("push_service_save_vapid", {
    p_public: fresh.publicKey,
    p_private: fresh.privateJwk,
  });
  if (saveError) throw saveError;
  const s = (Array.isArray(saved) ? saved[0] : saved) as Config;
  return { publicKey: s.vapid_public!, privateJwk: s.vapid_private! };
}

/** Constant-time, so the secret cannot be guessed a character at a time. */
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

interface Recipient {
  subscription_id: string;
  platform: "web" | "fcm" | "apns";
  endpoint: string;
  p256dh: string | null;
  auth_secret: string | null;
  notification_id: string;
  title: string;
  body: string;
  link: string | null;
  severity: string;
  kind: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();

  if (req.method === "GET") {
    try {
      const keys = await vapidKeys(db);
      const native = { fcm: fcmConfigured() !== null, apns: apnsConfigured() !== null };
      return json({ publicKey: keys.publicKey, native }, 200, {
        ...cors,
        "Cache-Control": "public, max-age=600",
      });
    } catch (e) {
      console.error("[push] key", e);
      return json({ error: "push is not available" }, 503, cors);
    }
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const { data: cfgData, error: cfgError } = await db.rpc("push_service_config");
  const cfg = (Array.isArray(cfgData) ? cfgData[0] : cfgData) as Config | null;
  if (cfgError || !cfg) return json({ error: "not configured" }, 503);
  if (!same(req.headers.get("x-push-secret") ?? "", cfg.trigger_secret)) {
    return json({ error: "forbidden" }, 403);
  }

  let id: string;
  try {
    id = String(((await req.json()) as { id?: unknown }).id ?? "");
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad request" }, 400);

  const { data: rows, error } = await db.rpc("push_recipients", { p_notification: id });
  if (error) {
    console.error("[push] recipients", error);
    return json({ error: "lookup failed" }, 500);
  }
  const recipients = (rows ?? []) as Recipient[];
  if (recipients.length === 0) return json({ sent: 0, failed: 0, gone: 0 });

  const keys = recipients.some((r) => r.platform === "web") ? await vapidKeys(db) : null;
  const fcm = fcmConfigured();
  const apns = apnsConfigured();

  const outcomes = await Promise.all(
    recipients.map(async (r): Promise<[string, SendOutcome | "skipped"]> => {
      const message: PushMessage = {
        id: r.notification_id,
        title: r.title,
        body: r.body,
        link: r.link,
        severity: r.severity,
        kind: r.kind,
      };
      try {
        if (r.platform === "web" && keys && r.p256dh && r.auth_secret) {
          const { outcome } = await sendWebPush(
            { endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth_secret },
            message,
            keys,
            SUBJECT,
            r.severity === "critical" || r.severity === "warning" ? "high" : "normal",
          );
          return [r.subscription_id, outcome];
        }
        if (r.platform === "fcm") {
          return [r.subscription_id, fcm ? await sendFcm(fcm, r.endpoint, message) : "skipped"];
        }
        if (r.platform === "apns") {
          return [r.subscription_id, apns ? await sendApns(apns, r.endpoint, message) : "skipped"];
        }
        return [r.subscription_id, "skipped"];
      } catch (e) {
        console.warn("[push] send", r.platform, e);
        return [r.subscription_id, "failed"];
      }
    }),
  );

  const gone = outcomes.filter(([, o]) => o === "gone").map(([sid]) => sid);
  if (gone.length) {
    const { error: goneError } = await db.rpc("push_subscriptions_gone", { p_ids: gone });
    if (goneError) console.warn("[push] cleanup", goneError);
  }
  return json({
    sent: outcomes.filter(([, o]) => o === "sent").length,
    failed: outcomes.filter(([, o]) => o === "failed").length,
    skipped: outcomes.filter(([, o]) => o === "skipped").length,
    gone: gone.length,
  });
});
