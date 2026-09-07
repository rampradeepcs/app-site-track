/**
 * Configuration, read once and checked at boot.
 *
 * A server that starts without a database URL and fails on its first request
 * has moved the error from the deploy log, where somebody is looking, to a
 * user's screen, where nobody can act on it.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Copy server/.env.example to server/.env and fill it in.`,
    );
  }
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  supabaseUrl: required("SUPABASE_URL").replace(/\/+$/, ""),
  jwtAudience: process.env.JWT_AUDIENCE?.trim() || "authenticated",
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST?.trim() || "0.0.0.0",
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 240),
} as const;

export const jwksUrl = `${env.supabaseUrl}/auth/v1/.well-known/jwks.json`;
