/**
 * The business behind the product: clients, what they pay for, what they owe.
 *
 * Every read here is answered by the same policies the console relies on, so
 * the platform owner sees every tenant and a client's administrator sees
 * their own row and nothing else — from the identical query. There is no
 * "am I the owner" check in this file, deliberately: that question is
 * already answered, once, in the database.
 */

import type { FastifyInstance } from "fastify";
import { asCaller, HttpError, one, readMany, requireCaller } from "./_shared.js";

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  /** The whole commercial picture, at one instant. */
  app.get("/v1/platform", async (req) => {
    const data = await readMany(req, {
      organizations: { sql: "select * from organizations order by created_at desc" },
      plans: { sql: "select * from plans order by monthly_price" },
      subscriptions: { sql: "select * from subscriptions" },
      invoices: { sql: "select * from invoices order by issued_at desc limit 500" },
      usage: { sql: "select * from usage_live order by month desc" },
      tickets: { sql: "select * from support_tickets order by opened_at desc limit 500" },
      audit: { sql: "select * from platform_audit order by at desc limit 500" },
    });
    return { data };
  });

  /** One client, with everything that hangs off them. */
  app.get<{ Params: { id: string } }>("/v1/platform/clients/:id", async (req) => {
    requireCaller(req);
    return asCaller(req.caller, async (run) => {
      const { rows: orgs } = await run("select * from organizations where id = $1", [
        req.params.id,
      ]);
      const org = one(orgs, "No such client.");
      // Sequential, not Promise.all: these share one connection, and a
      // client cannot run two statements at once — pg deprecates it and the
      // results can interleave. They are inside one transaction either way,
      // so this is still a single consistent view.
      const sub = await run("select * from subscriptions where org_id = $1 limit 1", [req.params.id]);
      const invoices = await run("select * from invoices where org_id = $1 order by issued_at desc", [req.params.id]);
      const usage = await run("select * from usage_live where org_id = $1 order by month desc", [req.params.id]);
      const people = await run("select * from users where org_id = $1 order by employee_code", [req.params.id]);
      const tickets = await run("select * from support_tickets where org_id = $1 order by opened_at desc", [req.params.id]);
      return {
        data: {
          organization: org,
          subscription: sub.rows[0] ?? null,
          invoices: invoices.rows,
          usage: usage.rows,
          people: people.rows,
          tickets: tickets.rows,
        },
      };
    });
  });

  /**
   * Tailor one client's deal.
   *
   * Limits and features are overrides on top of the plan rather than a
   * bespoke plan per client, so a price change to a plan still reaches
   * everybody who did not negotiate their way off it.
   */
  app.patch<{ Params: { orgId: string }; Body: Record<string, unknown> }>(
    "/v1/platform/subscriptions/:orgId",
    async (req) => {
      requireCaller(req);
      const allowed: Record<string, string> = {
        planId: "plan_id",
        status: "status",
        cycle: "cycle",
        trialEndsAt: "trial_ends_at",
        renewsAt: "renews_at",
        cancelledAt: "cancelled_at",
        limitOverrides: "limit_overrides",
        featureOverrides: "feature_overrides",
        customPrice: "custom_price",
        discountPercent: "discount_percent",
        creditBalance: "credit_balance",
        onLimitReached: "on_limit_reached",
        notes: "notes",
      };
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [key, value] of Object.entries(req.body ?? {})) {
        const column = allowed[key];
        if (!column) throw new HttpError(400, `Cannot set ${key}.`);
        values.push(
          column.endsWith("_overrides") ? JSON.stringify(value ?? {}) : value,
        );
        sets.push(`${column} = $${values.length}${column.endsWith("_overrides") ? "::jsonb" : ""}`);
      }
      if (!sets.length) throw new HttpError(400, "Nothing to change.");
      values.push(req.params.orgId);
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(
          `update subscriptions set ${sets.join(", ")} where org_id = $${values.length} returning *`,
          values,
        );
        return { data: one(rows, "That client has no subscription.") };
      });
    },
  );

  /** Suspend, restore, or otherwise change where a client stands. */
  app.post<{ Params: { id: string }; Body: { status: string; reason?: string } }>(
    "/v1/platform/clients/:id/status",
    async (req) => {
      requireCaller(req);
      const allowed = ["active", "trial", "suspended", "payment-hold", "cancelled"];
      const status = req.body?.status;
      if (!status || !allowed.includes(status)) {
        throw new HttpError(400, `status must be one of ${allowed.join(", ")}.`);
      }
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(
          `update organizations
              set status = $1::org_status,
                  suspended_reason = case when $1 = 'suspended' then $2 else null end
            where id = $3 returning *`,
          [status, req.body.reason ?? null, req.params.id],
        );
        const org = one(rows, "No such client.");
        // A suspended company's subscription is suspended with it; anything
        // else would keep billing somebody who cannot use the product.
        if (status === "suspended" || status === "active") {
          await run("update subscriptions set status = $1::sub_status where org_id = $2", [
            status,
            req.params.id,
          ]);
        }
        return { data: org };
      });
    },
  );

  /** Mark an invoice paid, failed, refunded. */
  app.post<{ Params: { id: string }; Body: { status: string } }>(
    "/v1/platform/invoices/:id/status",
    async (req) => {
      requireCaller(req);
      const allowed = [
        "draft", "issued", "paid", "pending", "overdue", "failed", "refunded", "cancelled",
      ];
      const status = req.body?.status;
      if (!status || !allowed.includes(status)) {
        throw new HttpError(400, `status must be one of ${allowed.join(", ")}.`);
      }
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(
          `update invoices
              set status = $1::invoice_status,
                  paid_at = case when $1 = 'paid' then coalesce(paid_at, now()) else paid_at end
            where id = $2 returning *`,
          [status, req.params.id],
        );
        return { data: one(rows, "No such invoice.") };
      });
    },
  );

  /**
   * Ask for something.
   *
   * The one thing a client's administrator may write on these tables — their
   * own policy allows an insert scoped to their company and nothing else —
   * so a plan change is requested here rather than taken.
   */
  app.post<{
    Body: { orgId: string; subject: string; body: string; kind?: string; priority?: string };
  }>("/v1/platform/tickets", async (req, reply) => {
    const caller = requireCaller(req);
    const b = req.body;
    if (!b?.orgId || !b.subject) throw new HttpError(400, "orgId and subject are required.");
    const data = await asCaller(req.caller, async (run) => {
      const { rows } = await run(
        `insert into support_tickets
           (org_id, subject, body, kind, status, priority, raised_by, opened_at, updated_at)
         values ($1, $2, $3, $4::ticket_kind, 'open', $5, $6, now(), now())
         returning *`,
        [
          b.orgId, b.subject, b.body ?? "", b.kind ?? "subscription",
          b.priority ?? "normal", caller.email ?? "",
        ],
      );
      return rows[0];
    });
    reply.code(201);
    return { data };
  });

  app.post<{ Params: { id: string }; Body: { status: string } }>(
    "/v1/platform/tickets/:id/status",
    async (req) => {
      requireCaller(req);
      const allowed = ["open", "in-progress", "waiting", "resolved"];
      const status = req.body?.status;
      if (!status || !allowed.includes(status)) {
        throw new HttpError(400, `status must be one of ${allowed.join(", ")}.`);
      }
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(
          `update support_tickets set status = $1::ticket_status, updated_at = now()
            where id = $2 returning *`,
          [status, req.params.id],
        );
        return { data: one(rows, "No such ticket.") };
      });
    },
  );

  /** Platform-wide defaults: the plan a signup lands on, trial length, and so on. */
  app.get("/v1/platform/settings", async (req) => {
    requireCaller(req);
    return asCaller(req.caller, async (run) => {
      const { rows } = await run("select settings from platform_settings where id = 1");
      return { data: rows[0]?.settings ?? null };
    });
  });

  app.patch<{ Body: Record<string, unknown> }>("/v1/platform/settings", async (req) => {
    requireCaller(req);
    if (!req.body || typeof req.body !== "object") throw new HttpError(400, "Send an object.");
    return asCaller(req.caller, async (run) => {
      const { rows } = await run(
        `insert into platform_settings (id, settings) values (1, $1::jsonb)
         on conflict (id) do update set settings = platform_settings.settings || excluded.settings
         returning settings`,
        [JSON.stringify(req.body)],
      );
      return { data: rows[0]?.settings ?? null };
    });
  });
}
