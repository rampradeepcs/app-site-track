/**
 * Read and write any table the database exposes, under the caller's own
 * policies.
 *
 * One set of handlers rather than thirty near-identical ones. The table and
 * its columns are checked against what was introspected at boot, so an
 * unknown name is a 404 and an unknown field is a 400 before Postgres is
 * troubled; everything past that — may this person see this row, may they
 * write it, does this value satisfy the constraints — is answered by the
 * database, which is where those answers already live.
 *
 * Filtering follows PostgREST's shape, because the clients that will call
 * this already speak it:  ?status=eq.active&date=gte.2026-09-01
 */

import type { FastifyInstance } from "fastify";
import { asCaller, type Caller } from "../db.js";
import { HttpError, toHttpError } from "../errors.js";
import { tableInfo, tableNames } from "../schema.js";

const OPERATORS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "like",
  ilike: "ilike",
};

const RESERVED = new Set(["select", "order", "limit", "offset"]);
const MAX_LIMIT = 1000;

/** A column name that survived the introspected set is safe to quote. */
const q = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function must(table: string) {
  const info = tableInfo(table);
  if (!info) throw new HttpError(404, `No such resource: ${table}`);
  return info;
}

function columnList(info: ReturnType<typeof must>, select?: string): string {
  if (!select || select === "*") return "*";
  const cols = select.split(",").map((c) => c.trim()).filter(Boolean);
  for (const c of cols) {
    if (!info.columns.has(c)) throw new HttpError(400, `Unknown field: ${c}`);
  }
  return cols.map(q).join(", ");
}

function buildWhere(
  info: ReturnType<typeof must>,
  query: Record<string, unknown>,
  values: unknown[],
): string {
  const clauses: string[] = [];
  for (const [key, raw] of Object.entries(query)) {
    if (RESERVED.has(key)) continue;
    if (!info.columns.has(key)) throw new HttpError(400, `Unknown field: ${key}`);
    const text = String(raw);
    const [maybeOp, ...rest] = text.split(".");
    const op = maybeOp && OPERATORS[maybeOp] ? OPERATORS[maybeOp] : null;
    const value = op ? rest.join(".") : text;

    if (!op && text.startsWith("in.")) {
      const items = text.slice(3).split(",").map((s) => s.trim()).filter(Boolean);
      if (items.length === 0) throw new HttpError(400, `Empty list for ${key}`);
      values.push(items);
      clauses.push(`${q(key)} = any($${values.length})`);
      continue;
    }
    if (!op && (text === "is.null" || text === "null")) {
      clauses.push(`${q(key)} is null`);
      continue;
    }
    values.push(value);
    clauses.push(`${q(key)} ${op ?? "="} $${values.length}`);
  }
  return clauses.length ? `where ${clauses.join(" and ")}` : "";
}

function buildOrder(info: ReturnType<typeof must>, order?: string): string {
  if (!order) return "";
  const parts = order.split(",").map((p) => p.trim()).filter(Boolean);
  const sql = parts.map((p) => {
    const [col, dir] = p.split(".");
    if (!col || !info.columns.has(col)) throw new HttpError(400, `Cannot order by ${p}`);
    return `${q(col)} ${dir === "desc" ? "desc" : "asc"}`;
  });
  return sql.length ? `order by ${sql.join(", ")}` : "";
}

function writable(info: ReturnType<typeof must>, body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Send a JSON object.");
  }
  const row = body as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!info.columns.has(key)) throw new HttpError(400, `Unknown field: ${key}`);
  }
  if (Object.keys(row).length === 0) throw new HttpError(400, "Nothing to write.");
  return row;
}

export async function resourceRoutes(app: FastifyInstance): Promise<void> {
  /** Every table this API will answer for — useful when wiring a client. */
  app.get("/v1/resources", async () => ({ resources: tableNames() }));

  app.get<{ Params: { table: string }; Querystring: Record<string, string> }>(
    "/v1/:table",
    async (req) => {
      const info = must(req.params.table);
      const { select, order, limit, offset, ...filters } = req.query;
      const values: unknown[] = [];
      const where = buildWhere(info, filters, values);
      const take = Math.min(Number(limit ?? 200) || 200, MAX_LIMIT);
      const skip = Math.max(Number(offset ?? 0) || 0, 0);
      const sql =
        `select ${columnList(info, select)} from ${q(info.name)} ${where} ` +
        `${buildOrder(info, order)} limit ${take} offset ${skip}`;
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(sql, values);
        return { data: rows, limit: take, offset: skip };
      });
    },
  );

  app.get<{ Params: { table: string; id: string }; Querystring: { select?: string } }>(
    "/v1/:table/:id",
    async (req) => {
      const info = must(req.params.table);
      if (!info.hasId) throw new HttpError(400, `${info.name} is not addressed by id.`);
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(
          `select ${columnList(info, req.query.select)} from ${q(info.name)} where "id" = $1`,
          [req.params.id],
        );
        // Not found and not allowed are the same answer on purpose: telling
        // somebody a row exists but is not theirs is itself a disclosure.
        if (rows.length === 0) throw new HttpError(404, "Not found.");
        return { data: rows[0] };
      });
    },
  );

  app.post<{ Params: { table: string }; Body: unknown }>(
    "/v1/:table",
    async (req, reply) => {
      const info = must(req.params.table);
      const row = writable(info, req.body);
      const cols = Object.keys(row);
      const values = cols.map((c) => row[c]);
      const sql =
        `insert into ${q(info.name)} (${cols.map(q).join(", ")}) ` +
        `values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
      const data = await asCaller(req.caller, async (run) => {
        const { rows } = await run(sql, values);
        return rows[0];
      });
      reply.code(201);
      return { data };
    },
  );

  app.patch<{ Params: { table: string; id: string }; Body: unknown }>(
    "/v1/:table/:id",
    async (req) => {
      const info = must(req.params.table);
      if (!info.hasId) throw new HttpError(400, `${info.name} is not addressed by id.`);
      const row = writable(info, req.body);
      const cols = Object.keys(row);
      const values = cols.map((c) => row[c]);
      values.push(req.params.id);
      const sql =
        `update ${q(info.name)} set ${cols.map((c, i) => `${q(c)} = $${i + 1}`).join(", ")} ` +
        `where "id" = $${values.length} returning *`;
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(sql, values);
        if (rows.length === 0) throw new HttpError(404, "Not found.");
        return { data: rows[0] };
      });
    },
  );

  app.delete<{ Params: { table: string; id: string } }>(
    "/v1/:table/:id",
    async (req, reply) => {
      const info = must(req.params.table);
      if (!info.hasId) throw new HttpError(400, `${info.name} is not addressed by id.`);
      await asCaller(req.caller, async (run) => {
        const { rowCount } = await run(`delete from ${q(info.name)} where "id" = $1`, [
          req.params.id,
        ]);
        if (!rowCount) throw new HttpError(404, "Not found.");
      });
      reply.code(204);
      return null;
    },
  );
}

export { toHttpError, type Caller };
