/**
 * Every endpoint, over HTTP, as three real people.
 *
 * The API verifies tokens against a JWKS it fetches from SUPABASE_URL, so the
 * test serves its own JWKS and signs its own ES256 tokens. Everything else is
 * the real thing: the real routes, the real database, the real policies. The
 * one substituted part is which public key verifies a signature.
 *
 * Writes go into a client created for the test and deleted at the end, so the
 * live tenants are read but never touched.
 */
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const ISSUER_PORT = Number(process.env.TEST_ISSUER_PORT ?? 4555);
const API_PORT = Number(process.env.TEST_API_PORT ?? 4610);
const API = `http://127.0.0.1:${API_PORT}`;

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), alg: "ES256", use: "sig", kid: "test-key" };

const jwks = createServer((req, res) => {
  if (req.url?.endsWith("/jwks.json")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  } else { res.writeHead(404); res.end("{}"); }
});
await new Promise<void>((r) => jwks.listen(ISSUER_PORT, "127.0.0.1", r));

/*
 * The API is started here rather than beside the test.
 *
 * It has to be imported after the issuer is up and after the environment
 * names it, because the configuration is read once when the module loads —
 * so the import is dynamic and comes last. One command runs everything.
 */
process.env.SUPABASE_URL = `http://127.0.0.1:${ISSUER_PORT}`;
process.env.PORT = String(API_PORT);
process.env.HOST = "127.0.0.1";
process.env.JWT_AUDIENCE = "authenticated";
process.env.RATE_LIMIT_PER_MINUTE = "5000";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.test.example to .env and fill it in.");
  process.exit(1);
}
const { build } = await import("../src/index.js");
const { loadSchema } = await import("../src/schema.js");
const { closePool } = await import("../src/db.js");
const app = await build();
await loadSchema();
await app.listen({ port: API_PORT, host: "127.0.0.1" });

const token = (sub: string, email: string) =>
  new SignJWT({ email, role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer(`http://127.0.0.1:${ISSUER_PORT}/auth/v1`)
    .setAudience("authenticated")
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

const WHO = {
  owner: await token("5d98e4bb-90db-411b-b766-39291d7228b2", "hello@borncreative.in"),
  admin: await token("c782ed3f-11d0-42db-8a57-24e289343160", "rajesh@borncreative.in"),
  employee: await token("ead41517-e414-44df-8b26-5249dc044074", "arun@borncreative.in"),
  anon: "",
  tenant: "",
};

let pass = 0, fail = 0;
const failures: string[] = [];

async function call(
  method: string, path: string, as: keyof typeof WHO = "anon", body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(WHO[as] ? { authorization: `Bearer ${WHO[as]}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
}

async function expectStatus(name: string, method: string, path: string, as: keyof typeof WHO, want: number, body?: unknown) {
  const r = await call(method, path, as, body);
  check(`${name} [${want}]`, r.status === want, `got ${r.status} ${JSON.stringify(r.json).slice(0, 110)}`);
  return r;
}

console.log("\n── open ─────────────────────────────────────────────");
await expectStatus("healthz", "GET", "/healthz", "anon", 200);
await expectStatus("resource list", "GET", "/v1/resources", "anon", 200);
await expectStatus("openapi", "GET", "/docs/json", "anon", 200);
const branding = await expectStatus("tenant branding, anonymous", "GET", "/v1/tenants/magnolia", "anon", 200);
check("branding names the company", branding.json?.data?.name === "MAGNOLIA", JSON.stringify(branding.json).slice(0, 80));
await expectStatus("unknown tenant", "GET", "/v1/tenants/nobody-here", "anon", 404);

console.log("\n── authentication ───────────────────────────────────");
await expectStatus("no token on a protected route", "GET", "/v1/me", "anon", 401);
const bad = await fetch(`${API}/v1/me`, { headers: { authorization: "Bearer not.a.token" } });
check("garbage token is treated as absent [401]", bad.status === 401, `got ${bad.status}`);
const me = await expectStatus("me, as the owner", "GET", "/v1/me", "owner", 200);
check("me returns the owner's record", me.json?.data?.role === "superadmin", JSON.stringify(me.json?.data).slice(0, 90));
const meAdmin = await call("GET", "/v1/me", "admin");
check("me returns the admin's record", meAdmin.json?.data?.role === "admin", JSON.stringify(meAdmin.json?.data).slice(0, 90));
await expectStatus("me/sync", "POST", "/v1/me/sync", "employee", 200);

console.log("\n── module reads, and what each role sees ────────────");
for (const m of ["/v1/workforce", "/v1/operations", "/v1/travel", "/v1/teams", "/v1/platform"]) {
  await expectStatus(`${m} as owner`, "GET", m, "owner", 200);
  await expectStatus(`${m} without a token`, "GET", m, "anon", 401);
}
const wOwner = await call("GET", "/v1/workforce", "owner");
const wAdmin = await call("GET", "/v1/workforce", "admin");
const wEmp = await call("GET", "/v1/workforce", "employee");
check("owner sees more people than a client admin",
  wOwner.json.data.users.length > wAdmin.json.data.users.length,
  `owner ${wOwner.json.data.users.length} vs admin ${wAdmin.json.data.users.length}`);
check("admin and employee see the same tenant",
  wAdmin.json.data.users.length === wEmp.json.data.users.length,
  `${wAdmin.json.data.users.length} vs ${wEmp.json.data.users.length}`);
const pOwner = await call("GET", "/v1/platform", "owner");
const pAdmin = await call("GET", "/v1/platform", "admin");
check("owner sees every client", pOwner.json.data.organizations.length >= 2, `${pOwner.json.data.organizations.length}`);
check("a client admin sees only their own", pAdmin.json.data.organizations.length === 1, `${pAdmin.json.data.organizations.length}`);
check("the audit trail is the owner's alone",
  pOwner.json.data.audit.length > 0 && pAdmin.json.data.audit.length === 0,
  `owner ${pOwner.json.data.audit.length}, admin ${pAdmin.json.data.audit.length}`);
await expectStatus("usage", "GET", "/v1/usage", "owner", 200);
await expectStatus("notes", "GET", "/v1/notes", "admin", 200);
await expectStatus("work updates", "GET", "/v1/work-updates", "admin", 200);
await expectStatus("platform settings", "GET", "/v1/platform/settings", "owner", 200);

console.log("\n── generic table routes ─────────────────────────────");
await expectStatus("list a table", "GET", "/v1/users?limit=3", "admin", 200);
await expectStatus("filter with an operator", "GET", "/v1/users?role=eq.admin", "admin", 200);
await expectStatus("filter with in.", "GET", "/v1/users?role=in.admin,manager", "admin", 200);
await expectStatus("order and select", "GET", "/v1/users?select=id,name&order=name.asc", "admin", 200);
await expectStatus("unknown table", "GET", "/v1/wombats", "admin", 404);
await expectStatus("unknown field", "GET", "/v1/users?nosuch=eq.1", "admin", 400);
await expectStatus("unknown order column", "GET", "/v1/users?order=nosuch.asc", "admin", 400);
await expectStatus("row that is not yours", "GET", "/v1/organizations/453eac2e-0000-0000-0000-000000000000", "admin", 404);

console.log("\n── writes, in a client made for the test ────────────");
const stamp = Date.now().toString(36);
const created = await expectStatus("create a client", "POST", "/v1/platform/clients", "owner", 201, {
  name: `API Test ${stamp}`,
  slug: `api-test-${stamp}`,
  planId: "plan_starter",
  cycle: "monthly",
  trialDays: 14,
  admin: { name: "Test Admin", email: `admin-${stamp}@apitest.invalid`, phone: "" },
});
const orgId = created.json?.data?.orgId;
check("the new client has an id and a subdomain", !!orgId && !!created.json?.data?.slug, JSON.stringify(created.json).slice(0, 120));
await expectStatus("a client admin cannot create clients", "POST", "/v1/platform/clients", "admin", 403, {
  name: "Nope", planId: "plan_starter", admin: { name: "N", email: "n@x.invalid" },
});

let projectId = "", userId = "", teamId = "", noteId = "";
let tenantAdmin = "";
if (orgId) {
  /*
   * Operational tables are written by a company's own people: every policy
   * on them reads org_id = auth_org_id(), and the platform owner belongs to
   * no company, so their writes are refused — correctly. To exercise those
   * routes the test needs a real administrator of the disposable client, so
   * it links that client's admin row to a spare auth account (one of the
   * sign-ins that never joined a company) and signs as them.
   */
  const SPARE_AUTH = "26f73577-35dc-4b36-b704-89aa745fee42";
  const adminUserId: string = created.json?.data?.userId;
  const linked = await call("PATCH", `/v1/users/${adminUserId}`, "owner", { auth_id: SPARE_AUTH });
  check("link the test client's admin to an auth account [200]", linked.status === 200, `got ${linked.status}`);
  tenantAdmin = await token(SPARE_AUTH, `admin-${stamp}@apitest.invalid`);
  (WHO as Record<string, string>).tenant = tenantAdmin;
  const proj = await expectStatus("create a premise", "POST", "/v1/projects", "tenant", 201, {
    org_id: orgId, name: "Test Site", code: `T-${stamp}`, location: { lat: 11, lng: 77 },
    geofence: { radius: 120 }, status: "active",
  });
  projectId = proj.json?.data?.id ?? "";
  const usr = await expectStatus("create an employee", "POST", "/v1/users", "tenant", 201, {
    org_id: orgId, name: "Test Worker", email: `worker-${stamp}@apitest.invalid`,
    employee_code: `T-${stamp}-1`, role: "employee", status: "active",
  });
  userId = usr.json?.data?.id ?? "";

  if (projectId && userId) {
    await expectStatus("replace the roster", "PUT", `/v1/projects/${projectId}/members`, "tenant", 200, { userIds: [userId] });
    const roster = await expectStatus("read the roster", "GET", `/v1/projects/${projectId}/members`, "tenant", 200);
    check("the roster has the worker on it", roster.json?.data?.length === 1, `${roster.json?.data?.length}`);
    await expectStatus("remove from the roster", "DELETE", `/v1/projects/${projectId}/members/${userId}`, "tenant", 204);
    await expectStatus("removing twice is a 404", "DELETE", `/v1/projects/${projectId}/members/${userId}`, "tenant", 404);
    await expectStatus("add one to the roster", "POST", `/v1/projects/${projectId}/members`, "tenant", 201, { userId });

    const team = await expectStatus("create a gang", "POST", "/v1/labour_teams", "tenant", 201, {
      org_id: orgId, project_id: projectId, name: "Test Gang", type: "Plumbing", code: `TG-${stamp}`, status: "active",
    });
    teamId = team.json?.data?.id ?? "";
    if (teamId) {
      await expectStatus("add to the gang", "POST", `/v1/teams/${teamId}/members`, "tenant", 201, { employeeIds: [userId] });
      const tm = await expectStatus("read the gang", "GET", `/v1/teams/${teamId}/members`, "tenant", 200);
      check("the gang has the worker in it", tm.json?.data?.length === 1, `${tm.json?.data?.length}`);
      await expectStatus("mark them as left", "DELETE", `/v1/teams/${teamId}/members/${userId}`, "tenant", 204);
      await expectStatus("leaving twice is a 404", "DELETE", `/v1/teams/${teamId}/members/${userId}`, "tenant", 404);
    }

    const note = await expectStatus("write a site note", "POST", "/v1/project_notes", "tenant", 201, {
      org_id: orgId, project_id: projectId, author_id: adminUserId, title: "Test note", body: "b",
      category: "general", priority: "normal", visibility: "project-team", status: "open",
    });
    await expectStatus("a note cannot be filed under somebody else's name", "POST", "/v1/project_notes", "tenant", 403, {
      org_id: orgId, project_id: projectId, author_id: userId, title: "Forged", body: "b",
      category: "general", priority: "normal", visibility: "project-team", status: "open",
    });
    noteId = note.json?.data?.id ?? "";

    const att = await expectStatus("open a shift", "POST", "/v1/attendance/check-in", "tenant", 201, {
      id: crypto.randomUUID(), orgId, employeeId: adminUserId, projectId,
      date: new Date().toISOString().slice(0, 10),
      mark: { at: Date.now(), coords: { lat: 11, lng: 77 }, insideGeofence: true },
      status: "present",
    });
    const attId = att.json?.data?.id;
    if (attId) {
      await expectStatus("send the route", "POST", `/v1/attendance/${attId}/points`, "tenant", 201, {
        points: [
          { orgId, employeeId: adminUserId, projectId, lat: 11.0001, lng: 77.0001, at: new Date().toISOString() },
          { orgId, employeeId: adminUserId, projectId, lat: 11.0002, lng: 77.0002, at: new Date().toISOString() },
        ],
      });
      await expectStatus("nobody may post another person's location", "POST", `/v1/attendance/${attId}/points`, "tenant", 403, {
        points: [{ orgId, employeeId: userId, projectId, lat: 11.5, lng: 77.5, at: new Date().toISOString() }],
      });
      const pts = await expectStatus("read the route", "GET", `/v1/attendance/${attId}/points`, "tenant", 200);
      check("both fixes were stored", pts.json?.data?.length === 2, `${pts.json?.data?.length}`);
      await expectStatus("close the shift", "POST", `/v1/attendance/${attId}/check-out`, "tenant", 200, {
        mark: { at: Date.now(), coords: { lat: 11, lng: 77 }, insideGeofence: true },
        workedMinutes: 480, distanceMeters: 120, status: "present",
      });
      await expectStatus("empty point batch refused", "POST", `/v1/attendance/${attId}/points`, "tenant", 400, { points: [] });
    }
    await expectStatus("check-in without required fields", "POST", "/v1/attendance/check-in", "tenant", 400, { id: crypto.randomUUID() });
  }

  const month = new Date().toISOString().slice(0, 7);
  await expectStatus("first payroll adjustment", "POST", `/v1/payroll/${month}/adjustments`, "tenant", 201,
    { orgId, employeeId: userId, amount: 500, note: "one" });
  const twice = await expectStatus("second adjustment on the same month", "POST", `/v1/payroll/${month}/adjustments`, "tenant", 201,
    { orgId, employeeId: userId, amount: -200, note: "two" });
  check("both adjustments were kept", (twice.json?.data?.adjustments ?? []).length === 2,
    `${(twice.json?.data?.adjustments ?? []).length}`);
  await expectStatus("read the month", "GET", `/v1/payroll/${month}?org_id=${orgId}`, "tenant", 200);
  await expectStatus("advance the month", "POST", `/v1/payroll/${month}/status`, "tenant", 200, { status: "approved", orgId });
  await expectStatus("a status that does not exist", "POST", `/v1/payroll/${month}/status`, "tenant", 400, { status: "banana", orgId });
  await expectStatus("adjustment without an amount", "POST", `/v1/payroll/${month}/adjustments`, "tenant", 400, { employeeId: userId });

  await expectStatus("tailor the subscription", "PATCH", `/v1/platform/subscriptions/${orgId}`, "owner", 200,
    { customPrice: 4999, discountPercent: 10, limitOverrides: { employees: 75 }, notes: "test" });
  await expectStatus("a field that may not be set", "PATCH", `/v1/platform/subscriptions/${orgId}`, "owner", 400, { orgId: "x" });
  await expectStatus("suspend the client", "POST", `/v1/platform/clients/${orgId}/status`, "owner", 200,
    { status: "suspended", reason: "test" });
  await expectStatus("restore the client", "POST", `/v1/platform/clients/${orgId}/status`, "owner", 200, { status: "active" });
  await expectStatus("an unknown client status", "POST", `/v1/platform/clients/${orgId}/status`, "owner", 400, { status: "nope" });
  const detail = await expectStatus("one client in full", "GET", `/v1/platform/clients/${orgId}`, "owner", 200);
  check("the client detail carries its subscription and people",
    !!detail.json?.data?.subscription && detail.json?.data?.people?.length >= 1,
    JSON.stringify(Object.keys(detail.json?.data ?? {})));

  const ticket = await expectStatus("raise a ticket", "POST", "/v1/platform/tickets", "owner", 201,
    { orgId, subject: "Test ticket", body: "b", kind: "subscription", priority: "normal" });
  const ticketId = ticket.json?.data?.id;
  if (ticketId) {
    await expectStatus("answer the ticket", "POST", `/v1/platform/tickets/${ticketId}/status`, "owner", 200, { status: "resolved" });
    await expectStatus("an unknown ticket status", "POST", `/v1/platform/tickets/${ticketId}/status`, "owner", 400, { status: "nope" });
  }

  console.log("\n── the owner is not a member of anybody's company ────");
  const ownerWrite = await call("POST", "/v1/labour_teams", "owner", {
    org_id: orgId, project_id: projectId, name: "Owner Gang", type: "Plumbing", code: `OG-${stamp}`, status: "active",
  });
  check("the platform owner cannot write a client's operational rows [403]",
    ownerWrite.status === 403, `got ${ownerWrite.status}`);

  console.log("\n── tenant isolation, from outside ───────────────────");
  const seen = await call("GET", `/v1/organizations/${orgId}`, "admin");
  check("a client admin cannot read another client [404]", seen.status === 404, `got ${seen.status}`);
  const wrote = await call("PATCH", `/v1/organizations/${orgId}`, "admin", { name: "Hijacked" });
  check("a client admin cannot rename another client [404]", wrote.status === 404, `got ${wrote.status}`);
  const promoted = await call("PATCH", `/v1/users/ead41517-e414-44df-8b26-5249dc044074`, "employee", { role: "admin" });
  check("an employee cannot promote themselves [403/404]", promoted.status === 403 || promoted.status === 404, `got ${promoted.status}`);
  const stole = await call("POST", "/v1/users", "employee", {
    org_id: orgId, name: "Injected", email: `x-${stamp}@apitest.invalid`, employee_code: "X-1", role: "admin", status: "active",
  });
  check("an employee cannot add a user to another client [403]", stole.status === 403, `got ${stole.status}`);

  console.log("\n── clean up ─────────────────────────────────────────");
  const gone = await call("DELETE", `/v1/organizations/${orgId}`, "owner");
  check("the test client is deleted [204]", gone.status === 204, `got ${gone.status}`);
  const after = await call("GET", `/v1/organizations/${orgId}`, "owner");
  check("and is gone [404]", after.status === 404, `got ${after.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log("failed:", failures.join(" | "));
await app.close();
await closePool();
jwks.close();
process.exit(fail === 0 ? 0 : 1);
