# SiteTrack — Supabase backend

Three migrations, applied in order:

| File | Purpose |
|---|---|
| `20260824000100_schema.sql` | 16 tables: platform (orgs, plans, subscriptions, invoices, usage, tickets, audit, settings) and workforce (users, projects, members, attendance, location points, work updates, notifications, org audit) |
| `20260824000200_rls.sql` | 38 row-level-security policies, the auth helper functions, and the retention purge |
| `20260824000300_seed.sql` | The three baseline plans and platform settings |

## Apply

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Then copy `.env.example` to `.env.local` and fill in the project URL and anon
key. With those unset the app runs in **demo mode** against the seeded
localStorage store, so the product stays fully explorable without a backend.

Regenerate types after any schema change:

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```

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
