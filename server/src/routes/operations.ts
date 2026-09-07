/**
 * Shifts, pay and what the two produce together.
 *
 * A payroll month is the one place in this product where a record is closed
 * rather than edited: once locked, a correction is an adjustment appended to
 * the run, not a number quietly changed. That is why adjustments are their
 * own endpoint and append server-side — two managers correcting the same
 * month must both be recorded, and a read-modify-write from a phone would
 * lose one of them.
 */

import type { FastifyInstance } from "fastify";
import { asCaller, HttpError, one, readMany, requireCaller } from "./_shared.js";

interface AdjustmentBody {
  employeeId: string;
  amount: number;
  note: string;
}

export async function operationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Everything the shift and payroll screens need, at one instant.
   *
   * Row-level security answers parts of this with nothing for somebody who
   * may not read pay, and that is an empty list rather than a refusal.
   */
  app.get("/v1/operations", async (req) => {
    const data = await readMany(req, {
      shifts: { sql: "select * from shifts order by start_minute" },
      shiftAssignments: { sql: "select * from shift_assignments" },
      compensation: { sql: "select * from compensation order by effective_from desc" },
      payPolicies: { sql: "select * from pay_policies" },
      payrollRuns: { sql: "select * from payroll_runs order by month desc" },
    });
    return { data };
  });

  /** One month, with its adjustments. */
  app.get<{ Params: { month: string }; Querystring: { org_id?: string } }>(
    "/v1/payroll/:month",
    async (req) => {
      requireCaller(req);
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(
          `select * from payroll_runs where month = $1
             ${req.query.org_id ? "and org_id = $2" : ""} limit 1`,
          req.query.org_id ? [req.params.month, req.query.org_id] : [req.params.month],
        );
        return { data: rows[0] ?? null };
      });
    },
  );

  /**
   * Correct a month.
   *
   * Appended in the database, so a run corrected twice at once keeps both.
   * The run is created if the month has never been opened, because the first
   * correction should not require somebody to have pressed a button first.
   */
  app.post<{ Params: { month: string }; Body: AdjustmentBody & { orgId?: string } }>(
    "/v1/payroll/:month/adjustments",
    async (req, reply) => {
      const caller = requireCaller(req);
      const b = req.body;
      if (!b?.employeeId || typeof b.amount !== "number") {
        throw new HttpError(400, "employeeId and a numeric amount are required.");
      }
      const data = await asCaller(req.caller, async (run) => {
        const { rows: me } = await run<{ id: string; org_id: string }>(
          "select id, org_id from users where auth_id = $1 limit 1",
          [caller.sub],
        );
        const orgId = b.orgId ?? one(me, "You belong to no company.").org_id;
        const adjustment = {
          id: crypto.randomUUID(),
          employeeId: b.employeeId,
          amount: b.amount,
          note: b.note ?? "",
          by: me[0]?.id ?? null,
          at: Date.now(),
        };
        const { rows } = await run(
          `insert into payroll_runs (org_id, month, status, adjustments)
                values ($1, $2, 'draft', $3::jsonb)
           on conflict (org_id, month) do update
                set adjustments = coalesce(payroll_runs.adjustments, '[]'::jsonb)
                                  || excluded.adjustments
           returning *`,
          [orgId, req.params.month, JSON.stringify([adjustment])],
        );
        return rows[0];
      });
      reply.code(201);
      return { data };
    },
  );

  /** Move a month along: draft, calculated, review, approved, locked. */
  app.post<{ Params: { month: string }; Body: { status: string; orgId?: string } }>(
    "/v1/payroll/:month/status",
    async (req) => {
      const caller = requireCaller(req);
      const status = req.body?.status;
      const allowed = ["draft", "calculated", "review", "approved", "locked"];
      if (!status || !allowed.includes(status)) {
        throw new HttpError(400, `status must be one of ${allowed.join(", ")}.`);
      }
      return asCaller(req.caller, async (run) => {
        const { rows: me } = await run<{ id: string; org_id: string }>(
          "select id, org_id from users where auth_id = $1 limit 1",
          [caller.sub],
        );
        const orgId = req.body.orgId ?? one(me, "You belong to no company.").org_id;
        const { rows } = await run(
          `update payroll_runs
              set status = $1,
                  approved_by = case when $1 in ('approved','locked') then $2 else approved_by end,
                  approved_at = case when $1 in ('approved','locked') then now() else approved_at end,
                  locked_at   = case when $1 = 'locked' then now() else locked_at end
            where month = $3 and org_id = $4
            returning *`,
          [status, me[0]?.id ?? null, req.params.month, orgId],
        );
        return { data: one(rows, "That month has not been opened.") };
      });
    },
  );

  /* ---------------------------------------------------- travel & pay --- */

  /** Trips, and the rules that price them. */
  app.get("/v1/travel", async (req) => {
    const data = await readMany(req, {
      sessions: { sql: "select * from travel_sessions order by date desc limit 1000" },
      petrolRules: { sql: "select * from petrol_rules" },
      foodRules: { sql: "select * from food_rules" },
      decisions: { sql: "select * from allowance_decisions order by at desc limit 1000" },
    });
    return { data };
  });

  /**
   * Approve or refuse a trip.
   *
   * The approved distance is recorded separately from the measured one: a
   * manager who trims a claim has said something different from the GPS, and
   * both are worth keeping.
   */
  app.post<{
    Params: { id: string };
    Body: { status: "approved" | "rejected"; approvedMeters?: number; note?: string };
  }>("/v1/travel/:id/decision", async (req) => {
    const caller = requireCaller(req);
    const status = req.body?.status;
    if (status !== "approved" && status !== "rejected") {
      throw new HttpError(400, "status must be approved or rejected.");
    }
    return asCaller(req.caller, async (run) => {
      const { rows: me } = await run<{ id: string }>(
        "select id from users where auth_id = $1 limit 1",
        [caller.sub],
      );
      const { rows } = await run(
        `update travel_sessions
            set status = $1,
                approved_meters = coalesce($2, approved_meters, distance_meters),
                decided_by = $3,
                decided_at = now(),
                decision_note = $4
          where id = $5
          returning *`,
        [status, req.body.approvedMeters ?? null, me[0]?.id ?? null, req.body.note ?? null, req.params.id],
      );
      return { data: one(rows, "No such trip.") };
    });
  });
}
