/**
 * People and the premises they work on.
 *
 * The roster is a join table, so putting somebody on a site and taking them
 * off it are their own operations rather than something a client assembles
 * out of row writes and hopes lands consistently.
 */

import type { FastifyInstance } from "fastify";
import { asCaller, HttpError, one, readMany, requireCaller } from "./_shared.js";

export async function workforceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Everything the workforce screens need, at one instant.
   *
   * Mirrors what the app reads on sign-in: people, premises, who is on which
   * premise, the recent register and the recent updates.
   */
  app.get("/v1/workforce", async (req) => {
    const data = await readMany(req, {
      users: { sql: "select * from users order by employee_code" },
      projects: { sql: "select * from projects order by created_at" },
      members: { sql: "select project_id, user_id from project_members" },
      attendance: {
        sql: "select * from attendance order by date desc limit 2000",
      },
      updates: { sql: "select * from work_updates order by at desc limit 500" },
    });
    return { data };
  });

  /** Who is on this premise. */
  app.get<{ Params: { id: string } }>("/v1/projects/:id/members", async (req) => {
    requireCaller(req);
    return asCaller(req.caller, async (run) => {
      const { rows } = await run(
        `select u.* from users u
           join project_members m on m.user_id = u.id
          where m.project_id = $1
          order by u.employee_code`,
        [req.params.id],
      );
      return { data: rows };
    });
  });

  /**
   * Set the whole roster in one go.
   *
   * Replace rather than add-and-remove: the caller says who is on the site,
   * and two clients doing that at once end with one of their answers rather
   * than an interleaving of both.
   */
  app.put<{ Params: { id: string }; Body: { userIds: string[] } }>(
    "/v1/projects/:id/members",
    async (req) => {
      requireCaller(req);
      const ids = req.body?.userIds;
      if (!Array.isArray(ids)) throw new HttpError(400, "userIds must be an array.");
      return asCaller(req.caller, async (run) => {
        const { rows } = await run<{ org_id: string }>(
          "select org_id from projects where id = $1",
          [req.params.id],
        );
        const orgId = one(rows, "No such premise.").org_id;
        await run("delete from project_members where project_id = $1", [req.params.id]);
        if (ids.length) {
          const values: unknown[] = [req.params.id, orgId];
          const tuples = ids.map((_, i) => `($1, $${i + 3}, $2)`);
          await run(
            `insert into project_members (project_id, user_id, org_id)
             values ${tuples.join(", ")} on conflict do nothing`,
            [...values, ...ids],
          );
        }
        return { data: { projectId: req.params.id, members: ids.length } };
      });
    },
  );

  /** Add somebody to a premise without disturbing the rest of the roster. */
  app.post<{ Params: { id: string }; Body: { userId: string } }>(
    "/v1/projects/:id/members",
    async (req, reply) => {
      requireCaller(req);
      const userId = req.body?.userId;
      if (!userId) throw new HttpError(400, "userId is required.");
      await asCaller(req.caller, async (run) => {
        const { rows } = await run<{ org_id: string }>(
          "select org_id from projects where id = $1",
          [req.params.id],
        );
        const orgId = one(rows, "No such premise.").org_id;
        await run(
          `insert into project_members (project_id, user_id, org_id)
           values ($1, $2, $3) on conflict do nothing`,
          [req.params.id, userId, orgId],
        );
      });
      reply.code(201);
      return { data: { projectId: req.params.id, userId } };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/v1/projects/:id/members/:userId",
    async (req, reply) => {
      requireCaller(req);
      await asCaller(req.caller, async (run) => {
        const { rowCount } = await run(
          "delete from project_members where project_id = $1 and user_id = $2",
          [req.params.id, req.params.userId],
        );
        if (!rowCount) throw new HttpError(404, "They are not on that premise.");
      });
      reply.code(204);
      return null;
    },
  );

  /** The day's work, as the site reported it. */
  app.get<{ Querystring: { project_id?: string; date?: string; limit?: string } }>(
    "/v1/work-updates",
    async (req) => {
      requireCaller(req);
      const where: string[] = [];
      const values: unknown[] = [];
      if (req.query.project_id) {
        values.push(req.query.project_id);
        where.push(`project_id = $${values.length}`);
      }
      if (req.query.date) {
        values.push(req.query.date);
        where.push(`date = $${values.length}`);
      }
      const limit = Math.min(Number(req.query.limit ?? 200) || 200, 1000);
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(
          `select * from work_updates ${where.length ? `where ${where.join(" and ")}` : ""}
             order by at desc limit ${limit}`,
          values,
        );
        return { data: rows };
      });
    },
  );
}
