/**
 * Gangs, the register taken for them, and what gets written down on site.
 *
 * A site does not think in individuals, it thinks in teams: the plumbing
 * gang turned up, the mason gang is on Level 3. Group attendance is one
 * capture that produces a register row per person, which is why it is an
 * operation here and not a row a client assembles.
 */

import type { FastifyInstance } from "fastify";
import { asCaller, HttpError, one, readMany, requireCaller } from "./_shared.js";

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  /** Teams, their members, recent captures, and the site's notes. */
  app.get("/v1/teams", async (req) => {
    const data = await readMany(req, {
      teams: { sql: "select * from labour_teams order by name" },
      members: { sql: "select * from labour_team_members" },
      captures: { sql: "select * from group_attendance order by captured_at desc limit 500" },
      captureMembers: { sql: "select * from group_attendance_members limit 5000" },
      notes: { sql: "select * from project_notes order by created_at desc limit 500" },
      attachments: { sql: "select * from project_note_attachments limit 2000" },
    });
    return { data };
  });

  /** Who is in this gang. */
  app.get<{ Params: { id: string } }>("/v1/teams/:id/members", async (req) => {
    requireCaller(req);
    return asCaller(req.caller, async (run) => {
      // The join column is employee_id: a team's members are employees, and
      // the table says so.
      const { rows } = await run(
        `select m.*, u.name, u.employee_code, u.designation
           from labour_team_members m
           join users u on u.id = m.employee_id
          where m.team_id = $1 and m.left_at is null
          order by u.employee_code`,
        [req.params.id],
      );
      return { data: rows };
    });
  });

  app.post<{ Params: { id: string }; Body: { employeeIds: string[] } }>(
    "/v1/teams/:id/members",
    async (req, reply) => {
      requireCaller(req);
      const ids = req.body?.employeeIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new HttpError(400, "employeeIds must be a non-empty array.");
      }
      const added = await asCaller(req.caller, async (run) => {
        const { rows } = await run<{ org_id: string }>(
          "select org_id from labour_teams where id = $1",
          [req.params.id],
        );
        const team = one(rows, "No such team.");
        const values: unknown[] = [req.params.id, team.org_id];
        const tuples = ids.map((_, i) => `($1, $${i + 3}, $2, 'active', now())`);
        const { rowCount } = await run(
          `insert into labour_team_members (team_id, employee_id, org_id, status, joined_at)
           values ${tuples.join(", ")} on conflict do nothing`,
          [...values, ...ids],
        );
        return rowCount ?? 0;
      });
      reply.code(201);
      return { data: { teamId: req.params.id, added } };
    },
  );

  /**
   * Take somebody off a gang.
   *
   * Marked as left rather than deleted: a capture from last week names the
   * people who were in the team then, and removing the row would make that
   * record unreadable.
   */
  app.delete<{ Params: { id: string; employeeId: string } }>(
    "/v1/teams/:id/members/:employeeId",
    async (req, reply) => {
      requireCaller(req);
      await asCaller(req.caller, async (run) => {
        const { rowCount } = await run(
          `update labour_team_members
              set status = 'inactive', left_at = now()
            where team_id = $1 and employee_id = $2 and left_at is null`,
          [req.params.id, req.params.employeeId],
        );
        if (!rowCount) throw new HttpError(404, "They are not in that team.");
      });
      reply.code(204);
      return null;
    },
  );

  /** The site's written record: what happened, who must act, by when. */
  app.get<{ Querystring: { project_id?: string; status?: string } }>(
    "/v1/notes",
    async (req) => {
      requireCaller(req);
      const where: string[] = [];
      const values: unknown[] = [];
      if (req.query.project_id) {
        values.push(req.query.project_id);
        where.push(`project_id = $${values.length}`);
      }
      if (req.query.status) {
        values.push(req.query.status);
        where.push(`status = $${values.length}`);
      }
      return asCaller(req.caller, async (run) => {
        const { rows } = await run(
          `select * from project_notes ${where.length ? `where ${where.join(" and ")}` : ""}
             order by pinned desc, created_at desc limit 500`,
          values,
        );
        return { data: rows };
      });
    },
  );
}
