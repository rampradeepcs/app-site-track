-- ============================================================================
-- First-run bootstrap: seat the platform owner. Nothing else.
--
-- Run this ONCE in the Supabase SQL editor, after the migrations.
--
-- Why it exists: row-level security resolves every request through
-- auth.uid() -> users.auth_id -> org_id. A freshly migrated database has no
-- users at all, so the first person to sign in matches nothing, resolves to
-- no organisation, and gets an empty app that looks broken. Somebody has to
-- be seated by hand, because the thing that seats everyone else is a signed-in
-- session that does not yet exist.
--
-- Exactly one row, and it is a real person. The platform owner sits above
-- every tenant, which is why org_id is null and why a client admin can never
-- see them. Their phone and email must be real: a one-time code has to reach
-- an inbox or a handset that exists.
--
-- Everything else — every company, every premise, every worker — arrives
-- through the app: `/start` calls provision_company(), which creates the
-- organisation, its subscription, its admin and its first site in one
-- transaction. There is deliberately no seeded tenant here. A placeholder
-- company is indistinguishable from a real one on every screen that counts
-- them, and it is the thing that makes a dashboard look busy while telling
-- the owner nothing true.
--
-- The plans and platform settings are NOT here: they are product
-- configuration and ship as a migration
-- (`*_plans_and_settings.sql` / `src/lib/saas-seed.ts`).
--
-- To hand the platform to someone else, change the phone and email below and
-- re-run. A new auth identity is matched to this row by phone digits first
-- (on the national number, so the country code is optional), then email.
-- ============================================================================

insert into users (id, org_id, name, employee_code, role, designation, department,
                   phone, email, avatar_hue, status, shift_start, shift_end)
values (
  '00000000-0000-4000-8000-00000000000a',
  null,                               -- above every tenant, so a member of none
  'Platform Owner', 'WF-0001', 'superadmin', 'Product Owner', 'Platform',
  '+91 99443 11118', 'rampradeepux@gmail.com',
  265, 'active', 540, 1080
)
on conflict (id) do update
  set phone = excluded.phone,
      email = excluded.email,
      name  = excluded.name;

-- ----------------------------------------------------------------- check ---
-- A correct bootstrap is one superadmin and nothing else. If any of the
-- counts below are non-zero, this database is not the empty one you thought.
select 'platform owner: ' || coalesce(
         (select name || ' <' || coalesce(email, 'no email') || '> ' || phone
            from users where role = 'superadmin'), 'MISSING');
select 'tenants: '   || (select count(*) from organizations)
    || '  users: '   || (select count(*) from users)
    || '  premises: '|| (select count(*) from projects)
    || '  shifts: '  || (select count(*) from attendance);
select 'plans: ' || (select count(*) from plans)
    || '  settings rows: ' || (select count(*) from platform_settings);
