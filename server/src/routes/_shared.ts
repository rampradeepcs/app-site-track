/**
 * Small pieces every module route uses.
 *
 * Each module's read is one transaction and one round trip: a client that
 * needs shifts, assignments, pay policy and payroll runs to draw a screen
 * should ask once, not four times, and should see them as they were at the
 * same instant rather than as four reads that drifted apart.
 */

import type { FastifyRequest } from "fastify";
import { asCaller } from "../db.js";
import { HttpError } from "../errors.js";

export function requireCaller(req: FastifyRequest) {
  if (!req.caller) throw new HttpError(401, "Sign in first.");
  return req.caller;
}

type Runner = Parameters<Parameters<typeof asCaller>[1]>[0];

/**
 * Read several tables at once, under the caller's policies.
 *
 * Row-level security may legitimately answer part of this with nothing — a
 * manager who may not read salary — and that is an empty list, not a failure.
 */
export async function readMany(
  req: FastifyRequest,
  spec: Record<string, { sql: string; values?: unknown[] }>,
): Promise<Record<string, unknown[]>> {
  requireCaller(req);
  return asCaller(req.caller, async (run: Runner) => {
    const out: Record<string, unknown[]> = {};
    for (const [key, q] of Object.entries(spec)) {
      const { rows } = await run(q.sql, q.values ?? []);
      out[key] = rows;
    }
    return out;
  });
}

/** One row, or a 404 that does not say whether it exists. */
export function one<T>(rows: T[], what = "Not found."): T {
  const row = rows[0];
  if (!row) throw new HttpError(404, what);
  return row;
}

export { asCaller, HttpError };
