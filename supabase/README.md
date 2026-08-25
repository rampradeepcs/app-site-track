# SiteTrack — Supabase backend

Three migrations, applied in order:

| File                        | Purpose                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260824000100_schema.sql` | 16 tables: platform (orgs, plans, subscriptions, invoices, usage, tickets, audit, settings) and workforce (users, projects, members, attendance, location points, work updates, notifications, org audit) |
| `20260824000200_rls.sql`    | 38 row-level-security policies, the auth helper functions, and the retention purge                                                                                                                        |
| `20260824000300_seed.sql`   | The three baseline plans and platform settings                                                                                                                                                            |

## Apply

Push straight to the database with `--db-url`. This bypasses the Supabase
management API, so it needs **no `supabase login` and no `supabase link`** —
one command, and the only credential is the database password you already have:

```bash
# Project Settings → Database → Connection string → URI
# (percent-encode the password if it contains special characters)
npx supabase db push --db-url "postgresql://postgres:<password>@db.fdxwxcwnzzcsnsxdhzjj.supabase.co:5432/postgres"
```

Add `--dry-run` first to list what would be applied without touching anything.

> `project_id` in `config.toml` names the project for local tooling; it does
> **not** establish the remote link. Without `--db-url`, `db push` reports
> "Cannot find project ref" until you run `supabase link`, which itself needs
> `supabase login`. The `--db-url` route skips both.

Then run `supabase/bootstrap.sql` **once** in the SQL editor, after changing
`owner_phone` / `owner_email` at the top to yours. This is not optional
housekeeping: RLS resolves every request through `auth.uid() -> users.auth_id`,
and a freshly migrated database has no users — so the first person to sign in
matches nothing, resolves to no organisation, and gets an empty app that looks
broken. The bootstrap creates the platform owner (and a demo tenant, which you
can delete for a genuinely empty production start).

Finally copy `.env.example` to `.env.local` and paste the anon key. With those unset the app runs in **demo mode** against the seeded
localStorage store, so the product stays fully explorable without a backend.

Regenerate types after any schema change:

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```

## How the two modes hydrate

Both stores seed locally first, then — only when credentials are present —
replace the tenant-owned slices with real rows:

- `WorkforceProvider` swaps in users, projects, attendance and work updates.
  Settings, permissions and the session stay local: those are device
  preferences, not tenant data.
- `PlatformProvider` swaps in organisations, plans, subscriptions, invoices
  and usage. The same query serves both audiences — RLS decides whether the
  caller sees one organisation or all of them.

Two rules make that safe to point at a real database:

1. **Hydration re-runs on sign-in.** Every policy resolves through
   `auth.uid()`, so a read issued before authentication is correctly answered
   with nothing. Hydrating once on mount would therefore always miss; both
   stores subscribe to `onAuthChange` and re-read.
2. **An empty result never overwrites.** Zero visible users means "this caller
   is not authorised" far more often than it means "this tenant is empty" —
   the signed-in person is themselves a row. Treating that as data would blank
   the app, so it is treated as no answer at all.

A hydration failure is likewise non-fatal. The app logs and keeps running on
what it already has, rather than showing a worker an empty screen at the site
gate.

## Signing in

The gate has two implementations and picks one at build time from
`isLiveBackend`:

|          | Demo (no credentials) | Live (credentials set)               |
| -------- | --------------------- | ------------------------------------ |
| Identity | pick a seeded person  | phone or email, real OTP             |
| Code     | any 4 digits          | the 6-digit code Supabase sends      |
| Role     | chosen at the door    | read from the user's database record |

The live gate (`src/components/LiveGate.tsx`) is not a reskin of the demo one.
Choosing your own role is meaningless once RLS is enforcing it, and there is no
list of people to pick from before you have authenticated — so the flow is
identifier → code → `currentAppUser()` → the home screen for whatever role came
back.

It also names the state in between: an identity that verifies but matches no
`users` row is **authenticated but unlinked**. That person is told so
explicitly, because the alternative — dropping them into an app with nothing in
it — looks like an outage. See the identity-linking section above for why a row
can fail to match.

Signing out clears the Supabase session as well as the local one; leaving the
token behind would sign the next person in as the last one.

## Tenant isolation

Isolation is enforced **in the database**, not in the app. The client store
also narrows state to the signed-in tenant, but that is a convenience — anyone
holding the anon key can query PostgREST directly, so RLS is the real boundary.

Policies resolve through `auth_org_id()` / `auth_role()`, which are
`SECURITY DEFINER` with a pinned `search_path` so the lookup is not itself
subject to the policies it feeds.

Verified against PostgreSQL 16 with two tenants, a manager in each, an employee
and a super admin:

| Actor               | Sees                                                       |
| ------------------- | ---------------------------------------------------------- |
| Manager @ Client A  | only A's users, projects, attendance, GPS points, invoices |
| Employee @ Client A | own attendance and GPS only; **zero** invoices             |
| Super Admin         | both tenants, all tables                                   |

Negative cases, all confirmed:

- Cross-tenant read targeting another org explicitly by id → **0 rows**
- Cross-tenant insert → `ERROR: new row violates row-level security policy`
- `delete from platform_audit` as super admin → **DELETE 0** (no delete policy
  exists, so the audit trail is append-only even for the platform owner)

## Auth and identity linking

`20260824000400_auth_link.sql` links a new Supabase auth identity to the
workforce record that already exists for that person. Employees are enrolled
by their manager long before they first sign in, so a new identity has to find
its existing row rather than create a second one. Matching is by phone first
(site workers are enrolled by number), then email; phone comparison is on
digits only, because records are typed as `+91 98942 10214` while Supabase
stores E.164.

This is not optional polish. Without it a worker signs in successfully but
their record still has `auth_id = null`, so `auth_org_id()` resolves to
nothing, every policy denies, and a legitimately authenticated person sees
empty screens.

Verified against PostgreSQL 16:

| Case                            | Result                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| Phone match despite punctuation | linked                                                                     |
| Email match, different casing   | linked                                                                     |
| Identity matching nobody        | claims 0 rows, does not hijack a linked record                             |
| Linked worker under RLS         | resolves to their org; sees 1 project, 0 from the other tenant, 0 invoices |

`link_user_to_auth(user, auth)` lets the platform owner attach an identity by
hand — for a changed number, or an invite that matched nothing.

## RLS performance and privilege hardening

`20260824000500_rls_hardening.sql` applies Supabase's Postgres best-practice
guidance (`npx skills add supabase/agent-skills`) and fixes three real problems
in the original policies:

1. **Helpers were called per row.** `using (is_superadmin() or org_id = auth_org_id())`
   re-evaluates those functions for every candidate row. Wrapping each in a
   scalar subquery — `(select private.is_superadmin())` — turns it into an
   InitPlan evaluated once per statement.
2. **Helpers lived in `public`**, so PostgREST exposed SECURITY DEFINER
   functions as RPC endpoints. They now live in `private`, which PostgREST does
   not expose, with `search_path` pinned to `''`.
3. **Policies had no role target**, so they were evaluated for `anon` too.
   Every policy is now `to authenticated`.

Measured on PostgreSQL 16 over 300,002 location points, same query, same data:

|        | Execution time | Plan                                                                             |
| ------ | -------------- | -------------------------------------------------------------------------------- |
| Before | **4,775 ms**   | `Filter: (is_superadmin() OR ((org_id = auth_org_id()) AND …))` — per-row calls  |
| After  | **44.5 ms**    | `InitPlan 1–4`, `Filter: ($0 OR ((org_id = $1) AND ($2 OR (employee_id = $3))))` |

**107× faster**, and the full isolation matrix still passes: manager sees only
their tenant (0 rows for another org even by explicit id), employee sees own
records and zero invoices, super admin sees both tenants, cross-tenant insert
is rejected, `delete from platform_audit` removes 0 rows, and an unrecognised
identity sees nothing.

### One correction to the upstream guidance

The skill suggests revoking `EXECUTE` from `authenticated` on helper functions.
Doing that breaks every policy with `permission denied for function` — RLS
expressions are evaluated with the **invoker's** privileges, not the policy
owner's. `authenticated` must keep `EXECUTE`. The real protection is the
schema: PostgREST only exposes schemas it is configured for, so functions in
`private` are unreachable over the API regardless of grants.

## Retention

`purge_expired_location_points()` deletes location history past each client's
configured window (plan value, or their per-client override). Schedule it:

```sql
select cron.schedule('purge-routes', '0 3 * * *',
                     'select purge_expired_location_points()');
```

## Notes on scale

`location_points` is the high-volume table — a 9-hour shift at a 15-second
sampling interval is ~2,160 rows per worker per day. It is written in batches
rather than per fix, which is also what lets an offline device flush its outbox
in one round trip. Partitioning by month is the natural next step.
