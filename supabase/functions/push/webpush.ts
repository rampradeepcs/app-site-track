/**
 * Web Push, by the standards and nothing else.
 *
 * RFC 8291 (message encryption, aes128gcm) and RFC 8292 (VAPID) on plain
 * WebCrypto, so the same file runs in the edge runtime, in Node for its
 * tests, and anywhere else with crypto.subtle. No library: the popular one
 * leans on Node's crypto module, and an edge runtime's emulation of that is
 * one more thing to break on the day it matters.
 *
 * The browser's push service — Google's for Chrome, Mozilla's for Firefox,
 * Apple's for Safari — only ever sees ciphertext. It knows who to deliver to
 * and that this server signed the request, not what the notification says.
 */

const te = new TextEncoder();

/** Bytes over a plain ArrayBuffer — what WebCrypto and fetch accept. */
type Bytes = Uint8Array<ArrayBuffer>;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Bytes {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/* ------------------------------------------------------------ the keys -- */

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url — what browsers subscribe with. */
  publicKey: string;
  /** The private key as a JWK, JSON-encoded. */
  privateJwk: string;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64url(raw), privateJwk: JSON.stringify(jwk) };
}

/* -------------------------------------------------- RFC 8292, the VAPID -- */

/**
 * The Authorization header that proves this server is the one the browser
 * subscribed to. Scoped to the push service's origin, valid for twelve
 * hours — the standard's ceiling is twenty-four.
 */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64url(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    te.encode(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: subject }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(keys.privateJwk),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto's ECDSA signature is already the r||s pair JWS wants.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${header}.${claims}`)),
  );
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

/* ------------------------------------------ RFC 8291, the encryption -- */

/**
 * Encrypt one message for one subscription: a single aes128gcm record,
 * header and all, ready to be the request body.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  authSecret: string,
  salt: Bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16))),
): Promise<Bytes> {
  const uaPublic = fromB64url(p256dh);
  const auth = fromB64url(authSecret);

  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256),
  );

  // IKM = HKDF(auth, ecdh, "WebPush: info" || 0 || ua_public || as_public, 32)
  const prkKey = await hmac(auth, ecdhSecret);
  const keyInfo = concat(te.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = (await hmac(prkKey, keyInfo)).slice(0, 32);

  // CEK and nonce from (salt, IKM)
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  // One record, so the padding delimiter is 0x02 ("last record").
  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aes,
      concat(plaintext, new Uint8Array([2])),
    ),
  );

  // Header: salt(16) || record size(4, big-endian) || keyid length(1) || keyid
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendOutcome = "sent" | "gone" | "failed";

/**
 * How long a push service may hold a message for a device that is off or
 * offline. The server only sends what happened in the last fifteen minutes,
 * and the same window applies on the way: a laptop opened in the morning
 * should not show the whole of last evening, one notification at a time.
 */
export const PUSH_TTL_SECONDS = 900;

/**
 * Deliver one message. "gone" means the browser has unsubscribed or the
 * subscription expired — the caller deletes it, or every later
 * notification pays for a request that cannot succeed.
 */
export async function sendWebPush(
  target: WebPushTarget,
  payload: unknown,
  keys: VapidKeys,
  subject: string,
  urgency: "normal" | "high" = "normal",
): Promise<{ outcome: SendOutcome; status: number }> {
  const body = await encryptPayload(te.encode(JSON.stringify(payload)), target.p256dh, target.auth);
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(PUSH_TTL_SECONDS),
      Urgency: urgency,
    },
    body,
  });
  await res.body?.cancel();
  if (res.status === 404 || res.status === 410) return { outcome: "gone", status: res.status };
  return { outcome: res.ok ? "sent" : "failed", status: res.status };
}
