-- ============================================================================
-- Workfence — backend verification.
--
-- Paste into the Supabase SQL editor and run, any time you want to know the
-- backend is in the state the app expects — after migrations, after the
-- bootstrap, after handing the project to someone else.
--
-- Read-only: no writes, no rows created. Every row of output says PASS or
-- FAIL and what that check protects. Expected output is 25 rows of PASS;
-- rows 11-12 fail until `bootstrap.sql` has been run once.
-- ============================================================================

with checks(ord, name, pass, detail) as (
  values
  (1,  'provision_company exists',
      (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'provision_company' and n.nspname = 'public'),
      'the self-serve signup RPC'),
  (2,  'provision_company is SECURITY DEFINER',
      (select bool_and(p.prosecdef) from pg_proc p where p.proname = 'provision_company'),
      'it must run with owner rights — RLS cannot admit a caller with no tenant'),
  (3,  'authenticated may call provision_company',
      has_function_privilege('authenticated', 'public.provision_company(jsonb)', 'execute'),
      'signup is for signed-in identities'),
  (4,  'anon may NOT call provision_company',
      not has_function_privilege('anon', 'public.provision_company(jsonb)', 'execute'),
      'no anonymous tenant creation'),
  (5,  'provision_premise exists',
      (select count(*) = 1 from pg_proc where proname = 'provision_premise'),
      'the internal helper'),
  (6,  'authenticated may NOT call provision_premise',
      not has_function_privilege('authenticated',
        'public.provision_premise(uuid,uuid,text,jsonb,premise_kind,tracking_mode,text,text)', 'execute'),
      'callable alone it would let anyone add a premise to any tenant'),
  (7,  'phones_match exists',
      (select count(*) = 1 from pg_proc where proname = 'phones_match'),
      'the national-number comparison'),
  (8,  'phones_match: national matches E.164',
      (select phones_match('9000022222', '+91 90000 22222')),
      'a worker enrolled without the country code still links'),
  (9,  'phones_match: different numbers do NOT match',
      (select not phones_match('9000022222', '9000022223')),
      'no false positives'),
  (10, 'auth-link trigger installed',
      (select count(*) = 1 from pg_trigger where tgname = 'on_auth_user_created'),
      'new identities are matched to their existing user row'),
  (11, 'platform owner seated',
      (select count(*) = 1 from users where role = 'superadmin' and org_id is null),
      'bootstrap.sql ran; the first sign-in resolves to somebody'),
  (12, 'owner has real contact details',
      (select email is not null and phone <> '' from users where role = 'superadmin' limit 1),
      'a one-time code has to reach a handset that exists'),
  (13, 'three plans present',
      (select count(*) = 3 from plans),
      'starter / growth / enterprise'),
  (14, 'platform settings present',
      (select count(*) = 1 from platform_settings),
      'signupsEnabled, default plan, trial days'),
  (15, 'signups are enabled',
      (select coalesce((settings->>'signupsEnabled')::boolean, true) from platform_settings where id = 1),
      'provision_company refuses when this is off'),
  (16, 'no placeholder tenants',
      (select count(*) = 0 from organizations),
      'tenants arrive through signup, not seeding — 0 until someone signs up'),
  (17, 'RLS enabled on every public table',
      (select bool_and(c.relrowsecurity) from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'),
      'the entire security model'),
  (18, 'anon reads nothing from users',
      not has_table_privilege('anon', 'users', 'select')
        or (select count(*) = 0 from pg_policies
              where tablename = 'users' and 'anon' = any(string_to_array(array_to_string(roles, ','), ','))),
      'tenant data is invisible without a session'),
  (19, 'provision_client exists',
      (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'provision_client' and n.nspname = 'public'),
      'the console''s Onboard client RPC — the wizard called it for months before it existed'),
  (20, 'provision_client is SECURITY DEFINER',
      (select bool_and(p.prosecdef) from pg_proc p where p.proname = 'provision_client'),
      'it writes rows for a tenant the caller does not belong to'),
  (21, 'authenticated may call provision_client',
      has_function_privilege('authenticated', 'public.provision_client(jsonb)', 'execute'),
      'the function itself refuses everyone who is not the platform owner'),
  (22, 'anon may NOT call provision_client',
      not has_function_privilege('anon', 'public.provision_client(jsonb)', 'execute'),
      'there is no anonymous client creation'),
  (23, 'organizations.slug exists and is unique',
      (select count(*) = 1 from information_schema.columns
        where table_name = 'organizations' and column_name = 'slug')
      and (select count(*) >= 1 from pg_indexes
            where schemaname = 'public' and tablename = 'organizations'
              and indexdef ilike 'CREATE UNIQUE%' and indexdef ilike '%(slug)%'),
      'a client is routed to by slug, so two clients cannot share one'),
  (24, 'slugify exists',
      (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'slugify' and n.nspname = 'public'),
      'provision_client builds a subdomain with it'),
  (25, 'private.is_superadmin exists',
      (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'is_superadmin' and n.nspname = 'private'),
      'the guard provision_client and the commercial policies call')
)
select ord,
       case when pass then 'PASS' else 'FAIL' end as result,
       name, detail
from checks order by ord;
