-- ============================================================================
-- Catch-up 1 of 3: one person, several companies.
--
-- Dated to where it belongs rather than to today. 20260915120000 already calls
-- private.active_org_id() and already compares a status against 'revoked', so
-- both had to exist before it — and neither was ever committed. A database
-- replayed from this tree failed there, which is why nobody could check how
-- tenancy resolves by reading the repository.
--
-- Captured from the live database with pg_get_functiondef and replayed
-- verbatim. Idempotent throughout: a no-op against production, a repair
-- anywhere else.
-- ============================================================================

-- ------------------------------------------------------- leaving a company ----
-- Removal is not deletion. Attendance, routes and pay already recorded stay
-- attributable to the person who earned them, so the membership row survives
-- with a status that says it is over.
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'employee_status' and e.enumlabel = 'revoked'
  ) then
    alter type employee_status add value 'revoked';
  end if;
end $$;

alter table users add column if not exists removed_at timestamptz;
alter table users add column if not exists invited_by uuid references users(id) on delete set null;

-- ------------------------------------------------- one identity, many rows ----
-- The original schema said `auth_id uuid unique` (20260824000100_schema.sql:159),
-- which is the rule "an identity belongs to exactly one organisation". Dropping
-- it is what makes multi-company possible at all; a tree without this change
-- produces a database that physically cannot let anybody join a second company.
alter table users drop constraint if exists users_auth_id_key;

-- The replacement rule: one row per identity per company, and only where both
-- are known. A seeded member who has not signed in yet has auth_id null, and
-- several of those must coexist in one company.
create unique index if not exists users_auth_per_org_unique
  on public.users (org_id, auth_id)
  where auth_id is not null and org_id is not null;

-- ------------------------------------------------------------- profiles ----
-- The person, as distinct from any of their memberships. A membership is per
-- company and comes and goes; this is the record that survives both, and what
-- a stable public id can hang off.
create sequence if not exists wf_id_seq;

create table if not exists profiles (
  auth_id    uuid primary key references auth.users(id) on delete cascade,
  wf_id      text not null unique default ('WF-' || nextval('wf_id_seq')::text),
  name       text not null default '',
  email      text,
  phone      text,
  photo      text,
  status     text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select
  using (auth_id = auth.uid() or (select private.is_superadmin()));

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (auth_id = auth.uid()) with check (auth_id = auth.uid());

-- ------------------------------------------- which company is this request? ----
-- Every tenant-scoped policy resolves through active_org_id(). The model is
-- these two functions: the device names a company in a header, and the answer
-- is that company only if the caller is a live member of it. One membership
-- needs no header. Two memberships and no header answers nothing, deliberately
-- — guessing would show somebody a company they did not ask for.
CREATE OR REPLACE FUNCTION private.requested_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when coalesce(current_setting('request.headers', true), '') = '' then null
    when (current_setting('request.headers', true)::json ->> 'x-workfence-company')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (current_setting('request.headers', true)::json ->> 'x-workfence-company')::uuid
    else null
  end
$function$;;

CREATE OR REPLACE FUNCTION private.active_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    -- The company the request names, if the caller is a live member of it.
    (select u.org_id
       from public.users u
      where u.auth_id = auth.uid()
        and u.org_id = private.requested_org_id()
        and u.status not in ('inactive', 'revoked')
      limit 1),
    -- No company named: a lone membership speaks for itself. Several do not,
    -- and naming a company one is not a member of falls through to nothing.
    (select case when count(*) = 1 then (array_agg(u.org_id))[1] end
       from public.users u
      where private.requested_org_id() is null
        and u.auth_id = auth.uid()
        and u.org_id is not null
        and u.status not in ('inactive', 'revoked'))
  )
$function$;;

-- An owner is an admin *of the company this request is about*, which is a
-- different question from "is an admin somewhere" once a person can belong to
-- two companies. The compensation, pay-policy, payroll and notes policies all
-- turn on it, so it has to exist as soon as active_org_id() does.
create or replace function private.is_org_owner()
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce((select role = 'admin'
                     from public.users
                    where auth_id = auth.uid()
                      and org_id is not null and org_id = private.active_org_id()
                      and status not in ('inactive', 'revoked')
                    limit 1), false)
$function$;

grant execute on function private.is_org_owner() to authenticated, service_role;

grant execute on function private.requested_org_id() to authenticated, service_role;
grant execute on function private.active_org_id()    to authenticated, service_role;
