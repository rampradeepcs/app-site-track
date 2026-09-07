/**
 * Who is calling.
 *
 * Supabase signs its tokens with ES256 and publishes the public half at a
 * JWKS endpoint, so this verifies every request locally: no shared secret to
 * leak, and no round trip to the auth service on the hot path. The key set is
 * fetched once and re-fetched when a token names a key we have not seen,
 * which is what makes key rotation a non-event.
 *
 * A token that fails verification is not merely untrusted, it is absent: the
 * request continues as an anonymous caller, and the database decides what an
 * anonymous caller may see. That is one rule instead of two.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { env, jwksUrl } from "./env.js";
import type { Caller } from "./db.js";

const jwks = createRemoteJWKSet(new URL(jwksUrl), {
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
});

export async function callerFrom(authorization?: string): Promise<Caller | null> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      audience: env.jwtAudience,
      // GoTrue issues from <project>/auth/v1.
      issuer: `${env.supabaseUrl}/auth/v1`,
    });
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      claims: payload as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
