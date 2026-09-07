# Workfence API

An HTTP tier over the same Postgres the app already uses, and — this is the
point — under the same row-level security.

## Why it exists, given the app can reach Postgres directly

The mobile and web clients talk to Supabase's own data API, and that keeps
working. This service is for the work a phone should not do:

* jobs on a clock — invoicing, usage rollups, retention purges;
* anything holding a secret — payment providers, mail, webhooks from them;
* callers that are not this app — a client's ERP, an export, a partner;
* one place to rate-limit, log and version a public surface.

## The one design decision worth reading

Every request runs as the person who made it.

The service holds a privileged connection pool and never uses that privilege
to read data. Each request opens a transaction, switches to the `authenticated`
role, installs the caller's own JWT claims, and only then runs the query — so
`auth.uid()`, `private.is_org_admin()` and every policy resolve against them
exactly as they do when the app talks to Supabase directly.

The usual alternative is a service-role backend that bypasses row-level
security and re-implements every tenant rule in JavaScript. The first rule
anyone forgets there leaks one client's site data to another. Here that cannot
happen, because this layer never had the power to break the rules.

`SET LOCAL` is what makes it safe on a pooled connection: the role and claims
end with the transaction, so the next request on the same socket cannot
inherit the last one's identity.

Verified against the live database:

| caller | organisations | users | audit trail |
|---|---|---|---|
| platform owner | 2 | 9 | 1 |
| a client's admin | 1 | 5 | 0 |
| a client's employee | 1 | 5 | 0 |
| anonymous | 0 | 0 | 0 |

…and an employee inserting a user into another company is refused by the
database, not by this code.

## Running it

```bash
cd server
cp .env.example .env      # fill in DATABASE_URL and SUPABASE_URL
npm install
npm run dev               # http://localhost:4000, docs at /docs
```

For production: `npm run build && npm start`, with the environment supplied by
the platform rather than a file.

Use the pooler host in `DATABASE_URL` (port 5432, the session pooler) so many
short-lived connections do not exhaust Postgres.

## Authentication

Send a Supabase access token as `Authorization: Bearer <token>`. The service
verifies it locally against the project's public JWKS — ES256, no shared
secret, no round trip — and re-fetches the key set when it sees an unknown key
id, so rotation is a non-event.

A token that fails verification is treated as absent rather than rejected: the
request continues anonymously and the database decides what an anonymous
caller may see. One rule instead of two.

## Endpoints

`GET /healthz` · `GET /docs` (OpenAPI) · `GET /v1/resources`

### Anything the database exposes

```
GET    /v1/:table          list, filter, order, page
GET    /v1/:table/:id      one row
POST   /v1/:table          create
PATCH  /v1/:table/:id      update
DELETE /v1/:table/:id      delete
```

Tables and their columns are introspected at boot, so a migration that adds a
column exposes it on the next restart and there is no list to keep in step.
Filters follow PostgREST's shape, which the existing clients already speak:

```
GET /v1/attendance?project_id=eq.<uuid>&date=gte.2026-09-01&order=date.desc&limit=50
GET /v1/users?role=in.admin,manager&select=id,name,email
```

Operators: `eq neq gt gte lt lte like ilike in is.null`.

### The things that are not a table

Each is several rows that must land together, so each calls the database
function that already knows how — the same one the app calls.

```
GET  /v1/me                          the caller's record, refreshed from their provider
POST /v1/me/sync                     force that refresh
POST /v1/companies                   self-serve signup: org, subscription, admin, premises, crew
POST /v1/platform/clients            platform owner takes on a client
GET  /v1/tenants/:slug               public: the company at a subdomain, for branding a sign-in page
POST /v1/attendance/check-in         open a shift (idempotent — an offline phone may flush twice)
POST /v1/attendance/:id/check-out    close it
POST /v1/attendance/:id/points       the day's route, in batches of up to 2000
GET  /v1/attendance/:id/points       one shift's route
GET  /v1/usage                       measured usage per company per month
```

## Errors

Postgres refusals are translated rather than re-checked, because row-level
security is the authorisation layer and it speaks SQLSTATE.

| SQLSTATE | HTTP | means |
|---|---|---|
| 42501 | 403 | a policy said no |
| 28000 | 401 | not signed in |
| 23505 | 409 | already exists |
| 23503 | 409 | refers to something absent |
| 23502 / 23514 / 22P02 / 22023 | 400 | the value is wrong |
| 57014 | 504 | the query took too long |

A row that exists but is not yours returns 404, not 403: saying "this exists,
you may not see it" is itself a disclosure.
