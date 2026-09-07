/**
 * The things that are not a table.
 *
 * A shift opening, a company being founded, a client being taken on: each is
 * several rows that must land together or not at all, and the database
 * already knows how in a SECURITY DEFINER function. These routes call those
 * functions rather than reimplementing them, so the app, this API and any
 * future client all provision a company the same way — and there is one
 * place to change when the rules do.
 */

import type { FastifyInstance } from "fastify";
import { asCaller } from "../db.js";
import { HttpError } from "../errors.js";

interface CheckInBody {
  id: string;
  orgId: string;
  employeeId: string;
  projectId: string;
  date: string;
  mark: unknown;
  status?: string;
  shiftId?: string | null;
}

interface CheckOutBody {
  mark: unknown;
  workedMinutes: number;
  distanceMeters: number;
  status: string;
  breaks?: unknown;
  overtime?: unknown;
  voiceNote?: unknown;
}

interface PointsBody {
  points: Array<{
    orgId: string;
    employeeId: string;
    projectId: string;
    lat: number;
    lng: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
    at: string;
    offline?: boolean;
    segmentStart?: boolean;
    travelSessionId?: string | null;
  }>;
}

function requireCaller(caller: unknown): asserts caller {
  if (!caller) throw new HttpError(401, "Sign in first.");
}

export async function domainRoutes(app: FastifyInstance): Promise<void> {
  /* --------------------------------------------------------------- me --- */

  /**
   * The caller's own record, refreshed from their identity provider first.
   *
   * Empty rather than 404 for somebody who belongs to no company: that is a
   * real state — signed in, not yet a member — and the client sends them to
   * found one.
   */
  app.get("/v1/me", async (req) => {
    requireCaller(req.caller);
    return asCaller(req.caller, async (run) => {
      const { rows } = await run("select * from public.sync_my_profile()");
      return { data: rows[0] ?? null };
    });
  });

  app.post("/v1/me/sync", async (req) => {
    requireCaller(req.caller);
    return asCaller(req.caller, async (run) => {
      const { rows } = await run("select * from public.sync_my_profile()");
      return { data: rows[0] ?? null };
    });
  });

  /* -------------------------------------------------------- companies --- */

  /** Self-serve signup: organisation, subscription, admin, premises, crew. */
  app.post<{ Body: unknown }>("/v1/companies", async (req, reply) => {
    requireCaller(req.caller);
    const data = await asCaller(req.caller, async (run) => {
      const { rows } = await run("select public.provision_company($1::jsonb) as result", [
        JSON.stringify(req.body ?? {}),
      ]);
      return rows[0]?.result;
    });
    reply.code(201);
    return { data };
  });

  /** Platform owner takes on a client: organisation, subscription, admin. */
  app.post<{ Body: unknown }>("/v1/platform/clients", async (req, reply) => {
    requireCaller(req.caller);
    const data = await asCaller(req.caller, async (run) => {
      const { rows } = await run("select public.provision_client($1::jsonb) as result", [
        JSON.stringify(req.body ?? {}),
      ]);
      return rows[0]?.result;
    });
    reply.code(201);
    return { data };
  });

  /* ----------------------------------------------------------- tenant --- */

  /**
   * The company at a subdomain, for a sign-in page that has to brand itself
   * before anyone has signed in. Deliberately anonymous, and the function
   * behind it returns a name and a logo and nothing else.
   */
  app.get<{ Params: { slug: string } }>("/v1/tenants/:slug", async (req) => {
    return asCaller(null, async (run) => {
      const { rows } = await run("select public.tenant_branding($1) as result", [
        req.params.slug,
      ]);
      const data = rows[0]?.result ?? null;
      if (!data) throw new HttpError(404, "No company at that address.");
      return { data };
    });
  });

  /* ------------------------------------------------------- attendance --- */

  /**
   * Open a shift.
   *
   * An upsert, not an insert: a phone that captured the shift offline and
   * flushes twice must not create a second row, and the table's uniqueness
   * would otherwise reject the retry as an error the worker cannot act on.
   */
  app.post<{ Body: CheckInBody }>("/v1/attendance/check-in", async (req, reply) => {
    requireCaller(req.caller);
    const b = req.body;
    if (!b?.id || !b.orgId || !b.employeeId || !b.projectId || !b.date || !b.mark) {
      throw new HttpError(400, "id, orgId, employeeId, projectId, date and mark are required.");
    }
    const data = await asCaller(req.caller, async (run) => {
      const { rows } = await run(
        `insert into attendance
           (id, org_id, employee_id, project_id, date, check_in, status, shift_id)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         on conflict (id) do update
           set check_in = excluded.check_in, status = excluded.status
         returning *`,
        [
          b.id, b.orgId, b.employeeId, b.projectId, b.date,
          JSON.stringify(b.mark), b.status ?? "present", b.shiftId ?? null,
        ],
      );
      return rows[0];
    });
    reply.code(201);
    return { data };
  });

  /** Close it. */
  app.post<{ Params: { id: string }; Body: CheckOutBody }>(
    "/v1/attendance/:id/check-out",
    async (req) => {
      requireCaller(req.caller);
      const b = req.body;
      if (!b?.mark) throw new HttpError(400, "mark is required.");
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(
          `update attendance
              set check_out = $1::jsonb,
                  worked_minutes = $2,
                  distance_meters = $3,
                  status = $4,
                  breaks = coalesce($5::jsonb, breaks),
                  overtime = coalesce($6::jsonb, overtime),
                  voice_note = coalesce($7::jsonb, voice_note)
            where id = $8
            returning *`,
          [
            JSON.stringify(b.mark), b.workedMinutes ?? 0, b.distanceMeters ?? 0,
            b.status ?? "present",
            b.breaks ? JSON.stringify(b.breaks) : null,
            b.overtime ? JSON.stringify(b.overtime) : null,
            b.voiceNote ? JSON.stringify(b.voiceNote) : null,
            req.params.id,
          ],
        );
        if (rows.length === 0) throw new HttpError(404, "No such shift.");
        return { data: rows[0] };
      });
    },
  );

  /**
   * The day's route, in batches.
   *
   * A phone that lost signal for an hour flushes hundreds of fixes at once,
   * so this takes them in one statement rather than one request each.
   */
  app.post<{ Params: { id: string }; Body: PointsBody }>(
    "/v1/attendance/:id/points",
    async (req, reply) => {
      requireCaller(req.caller);
      const points = req.body?.points;
      if (!Array.isArray(points) || points.length === 0) {
        throw new HttpError(400, "Send at least one point.");
      }
      if (points.length > 2000) throw new HttpError(413, "Too many points in one batch.");
      const written = await asCaller(req.caller, async (run) => {
        const values: unknown[] = [];
        const tuples = points.map((p, i) => {
          const base = i * 12;
          values.push(
            req.params.id, p.orgId, p.employeeId, p.projectId, p.lat, p.lng,
            p.accuracy ?? null, p.speed ?? null, p.heading ?? null, p.at,
            p.offline ?? false, p.segmentStart ?? false,
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
                 `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, ` +
                 `$${base + 11}, $${base + 12})`;
        });
        const { rowCount } = await run(
          `insert into location_points
             (attendance_id, org_id, employee_id, project_id, lat, lng,
              accuracy, speed, heading, at, offline, segment_start)
           values ${tuples.join(", ")}`,
          values,
        );
        return rowCount ?? 0;
      });
      reply.code(201);
      return { written };
    },
  );

  /** One shift's route, which is the heaviest read in the product. */
  app.get<{ Params: { id: string } }>("/v1/attendance/:id/points", async (req) => {
    requireCaller(req.caller);
    return asCaller(req.caller, async (run) => {
      const { rows } = await run(
        `select * from location_points where attendance_id = $1 order by at asc limit 20000`,
        [req.params.id],
      );
      return { data: rows };
    });
  });

  /* ------------------------------------------------------------ usage --- */

  /**
   * Measured usage per company per month, counted from the operational
   * tables when asked rather than read from a snapshot nothing writes.
   */
  app.get<{ Querystring: { org_id?: string; month?: string } }>("/v1/usage", async (req) => {
    requireCaller(req.caller);
    const where: string[] = [];
    const values: unknown[] = [];
    if (req.query.org_id) {
      values.push(req.query.org_id);
      where.push(`org_id = $${values.length}`);
    }
    if (req.query.month) {
      values.push(req.query.month);
      where.push(`month = $${values.length}`);
    }
    return asCaller(req.caller, async (run) => {
      const { rows } = await run(
        `select * from usage_live ${where.length ? `where ${where.join(" and ")}` : ""} ` +
          `order by month desc`,
        values,
      );
      return { data: rows };
    });
  });
}
