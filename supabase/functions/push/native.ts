/**
 * Phone push, for when the app is closed: Firebase Cloud Messaging for
 * Android, Apple Push Notification service for iOS.
 *
 * Both are off until their credentials are set as function secrets, and
 * each says so rather than failing: a project that has not set up Firebase
 * still gets web push and live delivery, and its phones still get the tray
 * while the app is open.
 *
 *   FCM_SERVICE_ACCOUNT  the Firebase service-account JSON, whole
 *   APNS_KEY             the .p8 key's contents (-----BEGIN PRIVATE KEY-----…)
 *   APNS_KEY_ID          its ten-character key id
 *   APNS_TEAM_ID         the Apple developer team id
 *   APNS_BUNDLE_ID       the app's bundle id (app.workfence.workforce)
 *   APNS_ENV             "production" for App Store/TestFlight builds,
 *                        "development" for builds run from Xcode
 */

import { b64url, PUSH_TTL_SECONDS } from "./webpush.ts";
import type { SendOutcome } from "./webpush.ts";

const te = new TextEncoder();

export interface PushMessage {
  id: string;
  title: string;
  body: string;
  link: string | null;
  severity: string;
  kind: string;
}

function pemBody(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signJwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  key: CryptoKey,
  alg: AlgorithmIdentifier | EcdsaParams,
): Promise<string> {
  const h = b64url(te.encode(JSON.stringify(header)));
  const c = b64url(te.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign(alg, key, te.encode(`${h}.${c}`)));
  return `${h}.${c}.${b64url(sig)}`;
}

/* ------------------------------------------------------------- Android -- */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

/*
 * Both tokens are cached as promises, not values: the sends for one
 * notification go out together, and on a fresh worker each would otherwise
 * mint its own — several OAuth exchanges for Google, and for Apple several
 * provider tokens at once, which it answers with TooManyProviderTokenUpdates.
 */
let fcmToken: { value: Promise<string>; until: number } | null = null;

export async function fcmAssertion(sa: ServiceAccount, now: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBody(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    key,
    { name: "RSASSA-PKCS1-v1_5" },
  );
}

function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (fcmToken && fcmToken.until > now + 60) return fcmToken.value;
  // Google's tokens last an hour; reuse for fifty minutes.
  const entry = {
    until: now + 50 * 60,
    value: (async () => {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: await fcmAssertion(sa, now),
        }),
      });
      if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status}`);
      return ((await res.json()) as { access_token: string }).access_token;
    })(),
  };
  fcmToken = entry;
  entry.value.catch(() => {
    if (fcmToken === entry) fcmToken = null;
  });
  return entry.value;
}

export function fcmConfigured(): ServiceAccount | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.client_email && sa.private_key && sa.project_id ? sa : null;
  } catch {
    return null;
  }
}

export async function sendFcm(
  sa: ServiceAccount,
  token: string,
  m: PushMessage,
): Promise<SendOutcome> {
  const access = await fcmAccessToken(sa);
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: m.title, body: m.body },
          // Read by the app when a push lands while it is open; FCM data
          // values must be strings.
          data: { id: m.id, link: m.link ?? "", kind: m.kind, severity: m.severity },
          android: {
            priority: m.severity === "critical" || m.severity === "warning" ? "HIGH" : "NORMAL",
            // A phone that was off overnight should not wake to yesterday's
            // check-ins: what is not delivered in fifteen minutes is dropped,
            // the same window the server sends in.
            ttl: `${PUSH_TTL_SECONDS}s`,
            notification: {
              // The same channels and the same tag as the in-app mirror
              // (src/lib/notify.ts), so the two never show twice.
              channel_id:
                m.severity === "warning" || m.severity === "critical" ? "wf-alerts" : "wf-attendance",
              tag: m.id,
            },
          },
        },
      }),
    },
  );
  if (res.ok) return "sent";
  const text = await res.text();
  if (
    res.status === 404 ||
    /UNREGISTERED|registration-token-not-registered|not a valid FCM registration token/i.test(text)
  ) {
    return "gone";
  }
  console.warn("[push] fcm", res.status, text.slice(0, 300));
  return "failed";
}

/* ----------------------------------------------------------------- iOS -- */

interface ApnsConfig {
  key: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  host: string;
}

let apnsJwt: { value: Promise<string>; until: number } | null = null;

export function apnsConfigured(): ApnsConfig | null {
  const key = Deno.env.get("APNS_KEY");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const bundleId = Deno.env.get("APNS_BUNDLE_ID") ?? "app.workfence.workforce";
  if (!key || !keyId || !teamId) return null;
  const host =
    Deno.env.get("APNS_ENV") === "development"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";
  return { key, keyId, teamId, bundleId, host };
}

export async function apnsToken(c: ApnsConfig, now: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBody(c.key),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return signJwt({ alg: "ES256", kid: c.keyId }, { iss: c.teamId, iat: now }, key, {
    name: "ECDSA",
    hash: "SHA-256",
  });
}

export async function sendApns(c: ApnsConfig, token: string, m: PushMessage): Promise<SendOutcome> {
  const now = Math.floor(Date.now() / 1000);
  // Apple wants the same token reused for up to an hour, not one per send.
  if (!apnsJwt || apnsJwt.until < now) {
    const entry = { value: apnsToken(c, now), until: now + 45 * 60 };
    apnsJwt = entry;
    entry.value.catch(() => {
      if (apnsJwt === entry) apnsJwt = null;
    });
  }
  const bearer = await apnsJwt.value;
  const res = await fetch(`${c.host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${bearer}`,
      "apns-topic": c.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": m.id.slice(0, 64),
      // Dropped if not delivered within the window, as on Android.
      "apns-expiration": String(now + PUSH_TTL_SECONDS),
    },
    body: JSON.stringify({
      aps: { alert: { title: m.title, body: m.body }, sound: "default" },
      id: m.id,
      link: m.link,
      kind: m.kind,
      severity: m.severity,
    }),
  });
  if (res.ok) return "sent";
  const text = await res.text();
  // 410 is an app that was removed. BadDeviceToken is not treated the same:
  // it is also what a sandbox token gets from production (APNS_ENV set
  // wrong), and deleting every iPhone's registration over a setting would be
  // worse than a failed send.
  if (res.status === 410 || /Unregistered/i.test(text)) return "gone";
  if (res.status === 403 && /ExpiredProviderToken|InvalidProviderToken/i.test(text)) apnsJwt = null;
  console.warn("[push] apns", res.status, text.slice(0, 300));
  return "failed";
}
