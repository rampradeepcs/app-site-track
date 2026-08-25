-- ============================================================================
-- RLS hardening, following Supabase's Postgres best-practice guidance.
--
-- Three problems with the original policies:
--
--  1. Helpers were called bare, so Postgres re-evaluated them per row. On a
--     300k-row location_points table a full scan took ~4.8s.
--  2. The helpers lived in `public`, which PostgREST exposes as RPC
--     endpoints — needless surface for SECURITY DEFINER functions.
--  3. Policies had no role target, so they were also evaluated for `anon`.
--
-- Wrapping each helper in a scalar subquery turns it into an InitPlan
-- evaluated once per statement instead of once per row.
-- ============================================================================

create schema if not exists private;

-- Supabase always provides anon/authenticated/service_role, but this migration
-- is also run against a plain Postgres in CI and local testing, where they do
-- not exist. Revoke defensively so the file is portable either way.
do $$
declare r text;
begin
  revoke all on schema private from public;
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema private from %I', r);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------- helpers -----
-- search_path is pinned to '' so every reference must be schema-qualified;
-- a SECURITY DEFINER function with a mutable search_path is hijackable.

create or replace function private.auth_uid()
returns uuid language sql stable security definer set search_path = ''
as $$ select auth.uid() $$;

create or replace function private.auth_org_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select org_id from public.users where auth_id = auth.uid() limit 1 $$;

create or replace function private.auth_role()
returns public.app_role language sql stable security definer set search_path = ''
as $$ select role from public.users where auth_id = auth.uid() limit 1 $$;

create or replace function private.auth_user_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select id from public.users where auth_id = auth.uid() limit 1 $$;

create or replace function private.is_superadmin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select role = 'superadmin' from public.users
                       where auth_id = auth.uid() limit 1), false) $$;

create or replace function private.is_org_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select role in ('admin','manager') from public.users
                       where auth_id = auth.uid() limit 1), false) $$;

-- Privileges, and why they are what they are.
--
-- RLS USING/WITH CHECK expressions are evaluated with the *invoker's*
-- privileges, not the policy owner's — so `authenticated` must retain EXECUTE
-- or every policy fails with "permission denied for function". (Verified:
-- revoking it produced exactly that error on a plain SELECT.)
--
-- The protection is the schema, not the grant. PostgREST only exposes schemas
-- listed in its configuration (`public` by default), so nothing in `private`
-- is reachable as an RPC endpoint however the grants read. `anon` is revoked
-- because unauthenticated callers never need these.
do $$
declare r text;
begin
  revoke execute on all functions in schema private from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on all functions in schema private from anon;
  end if;
  foreach r in array array['authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant usage on schema private to %I', r);
      execute format('grant execute on all functions in schema private to %I', r);
    end if;
  end loop;
end $$;

-- Indexes backing every column an RLS policy filters on.
create index if not exists users_auth_id_idx        on public.users (auth_id);
create index if not exists users_org_id_idx         on public.users (org_id);
create index if not exists points_org_employee_idx  on public.location_points (org_id, employee_id);
create index if not exists attendance_org_emp_idx   on public.attendance (org_id, employee_id);
create index if not exists updates_org_emp_idx      on public.work_updates (org_id, employee_id);

-- ------------------------------------------------------- rebuilt policies --
-- Every policy is scoped `to authenticated` (anon skips them entirely) and
-- wraps helpers in a subquery so they become InitPlans.

drop policy if exists plans_read on plans;
drop policy if exists plans_write on plans;
create policy plans_read on plans for select to authenticated using (true);
create policy plans_write on plans for all to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

drop policy if exists orgs_read on organizations;
drop policy if exists orgs_write on organizations;
create policy orgs_read on organizations for select to authenticated
  using ((select private.is_superadmin()) or id = (select private.auth_org_id()));
create policy orgs_write on organizations for all to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

drop policy if exists subs_read on subscriptions;
drop policy if exists subs_write on subscriptions;
create policy subs_read on subscriptions for select to authenticated
  using ((select private.is_superadmin()) or org_id = (select private.auth_org_id()));
create policy subs_write on subscriptions for all to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

drop policy if exists invoices_read on invoices;
drop policy if exists invoices_write on invoices;
create policy invoices_read on invoices for select to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id()) and (select private.is_org_admin())));
create policy invoices_write on invoices for all to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

drop policy if exists usage_read on usage_snapshots;
drop policy if exists usage_write on usage_snapshots;
create policy usage_read on usage_snapshots for select to authenticated
  using ((select private.is_superadmin()) or org_id = (select private.auth_org_id()));
create policy usage_write on usage_snapshots for all to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

drop policy if exists tickets_read on support_tickets;
drop policy if exists tickets_insert on support_tickets;
drop policy if exists tickets_update on support_tickets;
create policy tickets_read on support_tickets for select to authenticated
  using ((select private.is_superadmin()) or org_id = (select private.auth_org_id()));
create policy tickets_insert on support_tickets for insert to authenticated
  with check ((select private.is_superadmin()) or org_id = (select private.auth_org_id()));
create policy tickets_update on support_tickets for update to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

drop policy if exists audit_read on platform_audit;
drop policy if exists audit_insert on platform_audit;
create policy audit_read on platform_audit for select to authenticated
  using ((select private.is_superadmin()));
create policy audit_insert on platform_audit for insert to authenticated
  with check ((select private.is_superadmin()));

drop policy if exists settings_read on platform_settings;
drop policy if exists settings_write on platform_settings;
create policy settings_read on platform_settings for select to authenticated using (true);
create policy settings_write on platform_settings for all to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

drop policy if exists users_read on users;
drop policy if exists users_insert on users;
drop policy if exists users_update on users;
drop policy if exists users_delete on users;
create policy users_read on users for select to authenticated
  using ((select private.is_superadmin()) or org_id = (select private.auth_org_id()));
create policy users_insert on users for insert to authenticated
  with check ((select private.is_superadmin())
           or (org_id = (select private.auth_org_id()) and (select private.is_org_admin())));
create policy users_update on users for update to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id()) and (select private.is_org_admin()))
      or auth_id = (select private.auth_uid()))
  with check ((select private.is_superadmin()) or org_id = (select private.auth_org_id()));
create policy users_delete on users for delete to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id()) and (select private.auth_role()) = 'admin'));

drop policy if exists projects_read on projects;
drop policy if exists projects_write on projects;
create policy projects_read on projects for select to authenticated
  using ((select private.is_superadmin()) or org_id = (select private.auth_org_id()));
create policy projects_write on projects for all to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id()) and (select private.is_org_admin())))
  with check ((select private.is_superadmin())
           or (org_id = (select private.auth_org_id()) and (select private.is_org_admin())));

drop policy if exists members_read on project_members;
drop policy if exists members_write on project_members;
create policy members_read on project_members for select to authenticated
  using ((select private.is_superadmin()) or org_id = (select private.auth_org_id()));
create policy members_write on project_members for all to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id()) and (select private.is_org_admin())))
  with check ((select private.is_superadmin())
           or (org_id = (select private.auth_org_id()) and (select private.is_org_admin())));

drop policy if exists attendance_read on attendance;
drop policy if exists attendance_insert on attendance;
drop policy if exists attendance_update on attendance;
create policy attendance_read on attendance for select to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id())
          and ((select private.is_org_admin()) or employee_id = (select private.auth_user_id()))));
create policy attendance_insert on attendance for insert to authenticated
  with check (org_id = (select private.auth_org_id())
          and ((select private.is_org_admin()) or employee_id = (select private.auth_user_id())));
create policy attendance_update on attendance for update to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id())
          and ((select private.is_org_admin()) or employee_id = (select private.auth_user_id()))))
  with check (org_id = (select private.auth_org_id()));

drop policy if exists points_read on location_points;
drop policy if exists points_insert on location_points;
create policy points_read on location_points for select to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id())
          and ((select private.is_org_admin()) or employee_id = (select private.auth_user_id()))));
create policy points_insert on location_points for insert to authenticated
  with check (org_id = (select private.auth_org_id())
          and employee_id = (select private.auth_user_id()));

drop policy if exists updates_read on work_updates;
drop policy if exists updates_insert on work_updates;
drop policy if exists updates_update on work_updates;
create policy updates_read on work_updates for select to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id())
          and ((select private.is_org_admin()) or employee_id = (select private.auth_user_id()))));
create policy updates_insert on work_updates for insert to authenticated
  with check (org_id = (select private.auth_org_id())
          and employee_id = (select private.auth_user_id()));
create policy updates_update on work_updates for update to authenticated
  using (org_id = (select private.auth_org_id())
     and employee_id = (select private.auth_user_id()))
  with check (org_id = (select private.auth_org_id()));

drop policy if exists notif_read on notifications;
drop policy if exists notif_insert on notifications;
drop policy if exists notif_update on notifications;
create policy notif_read on notifications for select to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id())
          and (user_id is null or user_id = (select private.auth_user_id())
               or (select private.is_org_admin()))));
create policy notif_insert on notifications for insert to authenticated
  with check (org_id = (select private.auth_org_id()));
create policy notif_update on notifications for update to authenticated
  using (org_id = (select private.auth_org_id()))
  with check (org_id = (select private.auth_org_id()));

drop policy if exists orgaudit_read on audit_log;
drop policy if exists orgaudit_insert on audit_log;
create policy orgaudit_read on audit_log for select to authenticated
  using ((select private.is_superadmin())
      or (org_id = (select private.auth_org_id()) and (select private.is_org_admin())));
create policy orgaudit_insert on audit_log for insert to authenticated
  with check (org_id = (select private.auth_org_id()));

-- The originals stay for the retention purge, which runs as a definer job
-- rather than through a policy; drop the ones nothing references.
drop function if exists auth_user();
