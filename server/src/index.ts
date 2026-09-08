/**
 * Workfence API.
 *
 * An HTTP tier over the same Postgres the app already uses, and — this is the
 * point — under the same row-level security. Every request is verified,
 * turned into a database session for that person, and answered by policies
 * that were already written and already tested. Nothing here decides who may
 * see what; it decides only what a request means.
 *
 * What it buys, given the app can reach Postgres directly: a place to put
 * work that must not run on a phone (webhooks, scheduled jobs, exports,
 * anything holding a secret), a stable surface for callers that are not this
 * app, and one throat to throttle.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "./env.js";
import { callerFrom } from "./auth.js";
import { closePool, pool, type Caller } from "./db.js";
import { loadSchema, tableNames } from "./schema.js";
import { toHttpError } from "./errors.js";
import { resourceRoutes } from "./routes/resources.js";
import { domainRoutes } from "./routes/domain.js";
import { workforceRoutes } from "./routes/workforce.js";
import { operationsRoutes } from "./routes/operations.js";
import { teamRoutes } from "./routes/teams.js";
import { platformRoutes } from "./routes/platform.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Whoever the bearer token names, or null for an anonymous request. */
    caller: Caller | null;
  }
}

export async function build() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // A token in a log is a token in a backup. Strip them at the source.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: env.corsOrigins.length ? env.corsOrigins : false,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: env.rateLimitPerMinute,
    timeWindow: "1 minute",
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Workfence API",
        version: "1.0.0",
        description:
          "Reads and writes run as the caller, under the database's own " +
          "row-level security. Send a Supabase access token as a bearer token.",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.decorateRequest("caller", null);
  app.addHook("onRequest", async (req) => {
    req.caller = await callerFrom(req.headers.authorization);
    const company = req.headers["x-workfence-company"];
    if (req.caller && typeof company === "string" && /^[0-9a-f-]{36}$/i.test(company)) {
      req.caller.companyId = company;
    }
  });

  app.setErrorHandler((error, req, reply) => {
    const http = toHttpError(error);
    if (http.status >= 500) req.log.error({ err: error }, "request failed");
    else req.log.info({ status: http.status, msg: http.message }, "request refused");
    reply.code(http.status).send({
      error: http.message,
      // The database's own words help a developer and tell an attacker
      // nothing they could not learn by reading the schema they already have.
      detail: http.detail,
    });
  });

  app.get("/healthz", async () => {
    const started = Date.now();
    await pool.query("select 1");
    return { ok: true, dbLatencyMs: Date.now() - started, resources: tableNames().length };
  });

  // Module routes first: each is a purposeful endpoint, and the generic
  // table routes below are the fallback for everything nobody has needed a
  // shape for yet.
  await app.register(domainRoutes);
  await app.register(workforceRoutes);
  await app.register(operationsRoutes);
  await app.register(teamRoutes);
  await app.register(platformRoutes);
  await app.register(resourceRoutes);

  return app;
}

async function main() {
  const app = await build();
  await loadSchema();
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`Workfence API on ${env.host}:${env.port} — docs at /docs`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void (async () => {
        app.log.info(`${signal} — draining`);
        await app.close();
        await closePool();
        process.exit(0);
      })();
    });
  }
}

// Started directly rather than imported by a test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
