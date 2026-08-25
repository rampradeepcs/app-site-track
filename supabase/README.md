# SiteTrack — Supabase backend

Three migrations, applied in order:

| File | Purpose |
|---|---|
| `20260824000100_schema.sql` | 16 tables: platform (orgs, plans, subscriptions, invoices, usage, tickets, audit, settings) and workforce (users, projects, members, attendance, location points, work updates, notifications, org audit) |
| `20260824000200_rls.sql` | 38 row-level-security policies, the auth helper functions, and the retention purge |
| `20260824000300_seed.sql` | The three baseline plans and platform settings |

## Apply

The project ref is already set in `supabase/config.toml`
(`fdxwxcwnzzcsnsxdhzjj`), so linking is not needed:

```bash
npx supabase login
npx supabase db push          # applies all four migrations
```

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

A hydration failure is deliberately non-fatal. The app logs and keeps running
on what it already has, rather than showing a worker an empty screen at the
site gate.

## Tenant isolation

Isolation is enforced **in the database**, not in the app. The client store
also narrows state to the signed-in tenant, but that is a convenience — anyone
holding the anon key can query PostgREST directly, so RLS is the real boundary.

Policies resolve through `auth_org_id()` / `auth_role()`, which are
`SECURITY DEFINER` with a pinned `search_path` so the lookup is not itself
subject to the policies it feeds.

Verified against PostgreSQL 16 with two tenants, a manager in each, an employee
and a super admin:

| Actor | Sees |
|---|---|
| Manager @ Client A | only A's users, projects, attendance, GPS points, invoices |
| Employee @ Client A | own attendance and GPS only; **zero** invoices |
| Super Admin | both tenants, all tables |

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

| Case | Result |
|---|---|
| Phone match despite punctuation | linked |
| Email match, different casing | linked |
| Identity matching nobody | claims 0 rows, does not hijack a linked record |
| Linked worker under RLS | resolves to their org; sees 1 project, 0 from the other tenant, 0 invoices |

`link_user_to_auth(user, auth)` lets the platform owner attach an identity by
hand — for a changed number, or an invite that matched nothing.

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
