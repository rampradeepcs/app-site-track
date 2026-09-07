/**
 * Postgres, entered as the person who called.
 *
 * The API holds one privileged connection pool, and never uses that privilege
 * to read data. Every request runs inside a transaction that first switches to
 * the `authenticated` role and installs the caller's own JWT claims, so every
 * row-level security policy in the database resolves against them exactly as
 * it does when the app talks to PostgREST directly.
 *
 * That is deliberate, and it is the difference between this service and the
 * usual service-role backend. A service-role API bypasses RLS and has to
 * re-implement every tenant rule in JavaScript; the first rule anyone forgets
 * leaks one client's site data to another. Here the rules cannot be forgotten,
 * because this layer never had the power to break them.
 *
 * `SET LOCAL` is what makes it safe on a pooled connection: the role and the
 * claims are scoped to the transaction and are gone when it ends, so the next
 * request on the same socket cannot inherit the last one's identity.
 */

import pg from "pg";
import { env } from "./env.js";

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  // Supabase terminates TLS with a certificate the pooler presents for the
  // project host; verifying the chain against the system store fails there,
  // which is why the platform's own clients connect this way.
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // No single request should be able to hold a connection open forever.
  statement_timeout: 15_000,
});

pool.on("error", (err) => {
  console.error("[db] idle client error", err);
});

export interface Caller {
  /** auth.users.id — what auth.uid() returns inside the transaction. */
  sub: string;
  email?: string;
  /** Everything else the token carried, passed through untouched. */
  claims: Record<string, unknown>;
}

type Runner = <R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<pg.QueryResult<R>>;

/**
 * Run `fn` as `caller`, or anonymously when there is none.
 *
 * Committed on success, rolled back on any throw — so a handler that writes
 * three rows and then fails validation leaves none of them behind.
 */
export async function asCaller<T>(
  caller: Caller | null,
  fn: (query: Runner) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (caller) {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ ...caller.claims, sub: caller.sub, role: "authenticated" }),
      ]);
    } else {
      await client.query("set local role anon");
    }
    const result = await fn((text, values) => client.query(text, values));
    await client.query("commit");
    return result;
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      /* the connection is already gone; the transaction died with it */
    }
    throw e;
  } finally {
    // Belt and braces: SET LOCAL ends with the transaction, and this ends it
    // again for the case where the transaction never opened.
    try {
      await client.query("reset role");
    } catch {
      /* nothing to reset */
    }
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
