-- ============================================================================
-- What Supabase provides before the first migration runs.
--
-- replay.sh lays this over an empty Postgres so the migration tree can be
-- applied to something that is not a Supabase project: the four roles, the
-- auth schema, enough of auth.users for the migrations that read it, and the
-- three auth.* functions the policies call.
--
-- It is a stand-in, not a copy. It exists so `replay.sh` can answer one
-- question — does this tree still build the database we run? — without needing
-- a Supabase project to throw away.
-- ============================================================================

drop schema if exists public cascade;
drop schema if exists private cascade;
drop schema if exists auth cascade;
create schema public;
create schema private;
create schema auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if;
end $$;
create extension if not exists pgcrypto;
-- auth.users as Supabase ships it, to the extent the migrations touch it.
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text, role text,
  email text, email_confirmed_at timestamptz,
  phone text, phone_confirmed_at timestamptz,
  confirmed_at timestamptz,
  encrypted_password text,
  invited_at timestamptz, confirmation_sent_at timestamptz,
  recovery_sent_at timestamptz, email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  is_super_admin boolean, is_anonymous boolean default false,
  banned_until timestamptz, deleted_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text, provider_id text,
  identity_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb) $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::json->>'role','') $$;
grant usage on schema auth, public, private to anon, authenticated, service_role, supabase_auth_admin;
