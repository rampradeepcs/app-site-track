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

## Testing it

```bash
npm test
```

91 checks over every endpoint, against a real database. It signs its own
ES256 tokens and serves its own JWKS, because the tokens the app uses are
signed by a key only Supabase holds; everything else is the real thing — the
real routes, the real policies, the real Postgres.

Writes go into a client the test creates and deletes at the end, so the live
tenants are read and never touched. To exercise the tenant-scoped routes it
links that client's administrator to a spare auth account and signs as them,
because the platform owner belongs to no company and is correctly refused
those writes.

It asserts what each role may see and do, not just that routes answer: the
owner sees every client and the audit trail, a client's administrator sees
only their own, an employee cannot promote themselves or write into another
company, a note cannot be filed under somebody else's name, and nobody may
post another person's location.

It starts the API itself, on a port of its own, and stops it at the end — so
`npm test` is the whole command. All it needs from you is `DATABASE_URL` in
`.env`.

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

### Modules

One request per screen, answered in a single transaction — so a client that
needs shifts, assignments, pay policy and payroll runs sees them as they were
at the same instant, rather than as four reads that drifted apart. Row-level
security may legitimately answer part of any of these with nothing (a manager
who may not read pay), which is an empty list, not a refusal.

```
GET  /v1/workforce                       people, premises, roster, register, updates
GET  /v1/operations                      shifts, assignments, compensation, policies, payroll
GET  /v1/travel                          trips, petrol and food rules, decisions
GET  /v1/teams                           gangs, members, captures, site notes
GET  /v1/platform                        clients, plans, subscriptions, invoices, usage, tickets, audit
```

#### Workforce

```
GET    /v1/projects/:id/members          who is on this premise
PUT    /v1/projects/:id/members          replace the roster in one go
POST   /v1/projects/:id/members          add one person
DELETE /v1/projects/:id/members/:userId  take one person off
GET    /v1/work-updates                  what the site reported
```

#### Shifts, pay and travel

```
GET  /v1/payroll/:month                  one month, with its adjustments
POST /v1/payroll/:month/adjustments      correct a month — appended, never overwritten
POST /v1/payroll/:month/status           draft → calculated → review → approved → locked
POST /v1/travel/:id/decision             approve or refuse a trip
```

A locked month is corrected by an adjustment, not by editing a number, so the
adjustment is appended in the database: two managers correcting the same month
both get recorded, where a read-modify-write from a phone would lose one.

#### Teams and the site's record

```
GET    /v1/teams/:id/members                 who is in this gang
POST   /v1/teams/:id/members                 add employees
DELETE /v1/teams/:id/members/:employeeId     mark them as left
GET    /v1/notes                             the written record, pinned first
```

Leaving a gang is recorded, not deleted: a capture from last week names the
people who were in the team then, and removing the row would make that
record unreadable.

#### Platform

```
GET   /v1/platform/clients/:id               one client and everything hanging off them
POST  /v1/platform/clients/:id/status        suspend, restore, cancel
PATCH /v1/platform/subscriptions/:orgId      plan, cycle, price, overrides, dates
POST  /v1/platform/invoices/:id/status       paid, failed, refunded
POST  /v1/platform/tickets                   a client asks for something
POST  /v1/platform/tickets/:id/status        the owner answers
GET   /v1/platform/settings                  defaults for new companies
PATCH /v1/platform/settings                  merged, not replaced
```

There is no "am I the platform owner" check anywhere in these handlers, on
purpose. The owner sees every tenant and a client's administrator sees their
own, from the identical query, because that question is already answered once
in the database.

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
