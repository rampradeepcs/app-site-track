-- ============================================================================
-- Row-level security — tenant isolation enforced in the database.
--
-- The app already scopes reads at the store boundary, but that is a
-- convenience, not a security control: anyone holding an anon key could query
-- PostgREST directly. These policies are the real boundary. A manager in one
-- client cannot read another client's people, projects, attendance, routes or
-- billing even with a hand-crafted request.
-- ============================================================================

-- --------------------------------------------------------------- helpers ---
-- SECURITY DEFINER + a pinned search_path so the lookup itself is not subject
-- to the policies it feeds, and cannot be hijacked by a mutable search_path.

create or replace function auth_user()
returns users
language sql stable security definer set search_path = public
as $$ select * from users where auth_id = auth.uid() limit 1 $$;

create or replace function auth_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select org_id from users where auth_id = auth.uid() limit 1 $$;

create or replace function auth_role()
returns app_role
language sql stable security definer set search_path = public
as $$ select role from users where auth_id = auth.uid() limit 1 $$;

create or replace function is_superadmin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role = 'superadmin' from users where auth_id = auth.uid() limit 1), false) $$;

-- True when the caller may administer their own organisation.
create or replace function is_org_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role in ('admin','manager') from users where auth_id = auth.uid() limit 1), false) $$;

-- ------------------------------------------------------------- enable RLS ---
alter table organizations   enable row level security;
alter table subscriptions   enable row level security;
alter table invoices        enable row level security;
alter table usage_snapshots enable row level security;
alter table support_tickets enable row level security;
alter table platform_audit  enable row level security;
alter table platform_settings enable row level security;
alter table plans           enable row level security;
alter table users           enable row level security;
alter table projects        enable row level security;
alter table project_members enable row level security;
alter table attendance      enable row level security;
alter table location_points enable row level security;
alter table work_updates    enable row level security;
alter table notifications   enable row level security;
alter table audit_log       enable row level security;

-- ====================================================== platform tables ====
-- Commercial data: the platform owner sees everything; a client sees only
-- their own record, and never anybody's billing but their own.

create policy plans_read on plans
  for select using (auth.uid() is not null);
create policy plans_write on plans
  for all using (is_superadmin()) with check (is_superadmin());

create policy orgs_read on organizations
  for select using (is_superadmin() or id = auth_org_id());
create policy orgs_write on organizations
  for all using (is_superadmin()) with check (is_superadmin());

create policy subs_read on subscriptions
  for select using (is_superadmin() or org_id = auth_org_id());
create policy subs_write on subscriptions
  for all using (is_superadmin()) with check (is_superadmin());

create policy invoices_read on invoices
  for select using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()));
create policy invoices_write on invoices
  for all using (is_superadmin()) with check (is_superadmin());

create policy usage_read on usage_snapshots
  for select using (is_superadmin() or org_id = auth_org_id());
create policy usage_write on usage_snapshots
  for all using (is_superadmin()) with check (is_superadmin());

create policy tickets_read on support_tickets
  for select using (is_superadmin() or org_id = auth_org_id());
create policy tickets_insert on support_tickets
  for insert with check (is_superadmin() or org_id = auth_org_id());
create policy tickets_update on support_tickets
  for update using (is_superadmin()) with check (is_superadmin());

-- Append-only by construction: insert + select only, no update or delete
-- policy exists, so even the super admin cannot rewrite history via the API.
create policy audit_read on platform_audit
  for select using (is_superadmin());
create policy audit_insert on platform_audit
  for insert with check (is_superadmin());

create policy settings_read on platform_settings
  for select using (auth.uid() is not null);
create policy settings_write on platform_settings
  for all using (is_superadmin()) with check (is_superadmin());

-- ===================================================== workforce tables ====
-- The shape is the same throughout: super admin sees all; everyone else is
-- confined to their own org, and a plain employee only to their own records.

create policy users_read on users
  for select using (is_superadmin() or org_id = auth_org_id());
create policy users_insert on users
  for insert with check (is_superadmin() or (org_id = auth_org_id() and is_org_admin()));
create policy users_update on users
  for update using (
    is_superadmin()
    or (org_id = auth_org_id() and is_org_admin())
    or auth_id = auth.uid()                       -- own profile
  ) with check (is_superadmin() or org_id = auth_org_id());
create policy users_delete on users
  for delete using (is_superadmin() or (org_id = auth_org_id() and auth_role() = 'admin'));

create policy projects_read on projects
  for select using (is_superadmin() or org_id = auth_org_id());
create policy projects_write on projects
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()))
  with check (is_superadmin() or (org_id = auth_org_id() and is_org_admin()));

create policy members_read on project_members
  for select using (is_superadmin() or org_id = auth_org_id());
create policy members_write on project_members
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()))
  with check (is_superadmin() or (org_id = auth_org_id() and is_org_admin()));

-- Employees read and write only their own attendance; managers see the org.
create policy attendance_read on attendance
  for select using (
    is_superadmin()
    or (org_id = auth_org_id() and (is_org_admin() or employee_id = (select id from auth_user())))
  );
create policy attendance_insert on attendance
  for insert with check (
    org_id = auth_org_id()
    and (is_org_admin() or employee_id = (select id from auth_user()))
  );
create policy attendance_update on attendance
  for update using (
    is_superadmin()
    or (org_id = auth_org_id() and (is_org_admin() or employee_id = (select id from auth_user())))
  ) with check (org_id = auth_org_id());

-- Location history is the most sensitive table in the product.
create policy points_read on location_points
  for select using (
    is_superadmin()
    or (org_id = auth_org_id() and (is_org_admin() or employee_id = (select id from auth_user())))
  );
create policy points_insert on location_points
  for insert with check (
    org_id = auth_org_id() and employee_id = (select id from auth_user())
  );

create policy updates_read on work_updates
  for select using (
    is_superadmin()
    or (org_id = auth_org_id() and (is_org_admin() or employee_id = (select id from auth_user())))
  );
create policy updates_insert on work_updates
  for insert with check (
    org_id = auth_org_id() and employee_id = (select id from auth_user())
  );
create policy updates_update on work_updates
  for update using (org_id = auth_org_id() and employee_id = (select id from auth_user()))
  with check (org_id = auth_org_id());

create policy notif_read on notifications
  for select using (
    is_superadmin()
    or (org_id = auth_org_id() and (user_id is null or user_id = (select id from auth_user()) or is_org_admin()))
  );
create policy notif_insert on notifications
  for insert with check (org_id = auth_org_id());
create policy notif_update on notifications
  for update using (org_id = auth_org_id()) with check (org_id = auth_org_id());

create policy orgaudit_read on audit_log
  for select using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()));
create policy orgaudit_insert on audit_log
  for insert with check (org_id = auth_org_id());

-- ------------------------------------------------------------- retention ---
-- Enforces the client's configured location-history window. Schedule with
-- pg_cron: select cron.schedule('purge-routes','0 3 * * *','select purge_expired_location_points()');
create or replace function purge_expired_location_points()
returns bigint
language plpgsql security definer set search_path = public
as $$
declare removed bigint;
begin
  with cutoffs as (
    select s.org_id,
           now() - (coalesce(
             (s.limit_overrides->>'routeRetentionDays')::int,
             p.route_retention_days
           ) || ' days')::interval as cutoff
    from subscriptions s join plans p on p.id = s.plan_id
  )
  delete from location_points lp
  using cutoffs c
  where lp.org_id = c.org_id and lp.at < c.cutoff;
  get diagnostics removed = row_count;
  return removed;
end $$;
