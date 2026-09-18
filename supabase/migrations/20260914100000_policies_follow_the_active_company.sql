-- ============================================================================
-- Catch-up: the private helpers, and the policies that were left behind.
--
-- 20260824000500_rls_hardening.sql moved the RLS helpers into the private
-- schema and rewrote the policies that existed at the time to use them.
-- 20260828000900 then created nine more tables — shifts, assignments,
-- compensation, pay policies, payroll runs, travel, petrol, food, allowance
-- decisions — with policies written against the OLD public helpers, and
-- nothing in this tree ever brought them across.
--
-- That mattered more than tidiness once a person could belong to two
-- companies. The old helpers answered "which company?" with
--
--     select org_id from public.users where auth_id = auth.uid() limit 1
--
-- an unordered LIMIT over that person's own membership rows. For anybody with
-- one membership it is correct; for anybody with two it returns whichever row
-- Postgres happens to hand back first, so the pay, travel and shift data they
-- could read was decided by row order rather than by the company their device
-- had selected. The live helpers resolve private.active_org_id() instead,
-- which honours the x-workfence-company header and refuses to guess.
--
-- Production has had this for some time. A database built from this tree did
-- not, so the repository described a system with a tenancy hole that the real
-- one does not have — and no reviewer could have caught it by reading.
--
-- Captured from live with pg_get_functiondef and pg_policies. Idempotent.
-- ============================================================================

-- --------------------------------------------------------------- helpers ----
CREATE OR REPLACE FUNCTION private.auth_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select id from public.users
      where auth_id = auth.uid() and org_id is not null and org_id = private.active_org_id()
      limit 1),
    (select id from public.users
      where auth_id = auth.uid() and role = 'superadmin'
      limit 1))
$function$;

CREATE OR REPLACE FUNCTION private.auth_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.active_org_id() $function$;

CREATE OR REPLACE FUNCTION private.auth_role()
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select role from public.users
      where auth_id = auth.uid() and org_id is not null and org_id = private.active_org_id()
      limit 1),
    (select role from public.users
      where auth_id = auth.uid() and role = 'superadmin'
      limit 1))
$function$;

CREATE OR REPLACE FUNCTION private.is_org_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select role in ('admin', 'manager')
                     from public.users
                    where auth_id = auth.uid()
                      and org_id is not null and org_id = private.active_org_id()
                      and status not in ('inactive', 'revoked')
                    limit 1), false)
$function$;

CREATE OR REPLACE FUNCTION private.sync_user_from_auth(target uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a          auth.users%rowtype;
  meta       jsonb;
  app        jsonb;
  p_email    text;
  p_name     text;
  p_avatar   text;
  p_phone    text;
  p_provider text;
  matched    uuid;
begin
  if target is null then return null; end if;
  select * into a from auth.users where id = target;
  if not found then return null; end if;

  meta    := coalesce(a.raw_user_meta_data, '{}'::jsonb);
  app     := coalesce(a.raw_app_meta_data,  '{}'::jsonb);
  p_email := lower(nullif(btrim(coalesce(a.email, '')), ''));

  select btrim(v) into p_name
    from unnest(array[meta->>'full_name', meta->>'name',
                      meta->>'display_name', meta->>'preferred_username'])
         with ordinality as t(v, n)
   where btrim(coalesce(v, '')) <> '' and v not like '%@%'
   order by n limit 1;

  p_avatar := coalesce(nullif(meta->>'avatar_url', ''), nullif(meta->>'picture', ''));
  p_phone  := coalesce(nullif(a.phone, ''), nullif(meta->>'phone', ''), nullif(meta->>'phone_number', ''));

  select i.provider into p_provider
    from auth.identities i where i.user_id = a.id
   order by i.last_sign_in_at desc nulls last, i.created_at desc limit 1;
  p_provider := coalesce(p_provider, app->>'provider');

  insert into public.profiles (auth_id, name, email, phone, photo, updated_at)
  values (a.id, coalesce(p_name, ''), p_email, p_phone, p_avatar, now())
  on conflict (auth_id) do update
     set name       = case when btrim(public.profiles.name) = '' and excluded.name <> ''
                           then excluded.name else public.profiles.name end,
         email      = coalesce(excluded.email, public.profiles.email),
         phone      = case when coalesce(btrim(public.profiles.phone), '') = ''
                           then excluded.phone else public.profiles.phone end,
         photo      = coalesce(excluded.photo, public.profiles.photo),
         updated_at = now();

  -- The person who has no company yet takes every membership made for their
  -- confirmed address: those were made before they existed, and signing in
  -- is their acceptance. Anyone who already belongs somewhere accepts each
  -- further company explicitly.
  if p_email is not null and a.email_confirmed_at is not null
     and not exists (select 1 from public.users where auth_id = a.id and org_id is not null) then
    update public.users u
       set auth_id = a.id
     where u.auth_id is null
       and lower(u.email) = p_email
       and u.status <> 'revoked';
    update public.company_invitations
       set status = 'accepted', accepted_at = now(), invited_user_id = a.id
     where status = 'pending'
       and lower(email) = p_email
       and org_id in (select org_id from public.users where auth_id = a.id);
  end if;

  -- Invitations addressed to this address now know who they are for.
  update public.company_invitations
     set invited_user_id = a.id
   where status = 'pending' and invited_user_id is null
     and p_email is not null and lower(email) = p_email;

  update public.users u
     set name  = case when btrim(u.name) = '' and p_name is not null then p_name else u.name end,
         phone = case when coalesce(btrim(u.phone), '') = '' and p_phone is not null then p_phone else u.phone end,
         photo = case when p_avatar is not null
                       and (u.photo is null or u.photo = u.auth_profile->>'avatar_url')
                      then p_avatar else u.photo end,
         auth_provider   = coalesce(p_provider, u.auth_provider),
         email_verified  = a.email_confirmed_at is not null,
         last_sign_in_at = a.last_sign_in_at,
         auth_profile    = jsonb_strip_nulls(jsonb_build_object(
                             'name', p_name, 'email', p_email, 'avatar_url', p_avatar,
                             'phone', p_phone, 'provider', p_provider,
                             'providers', app->'providers',
                             'provider_id', meta->>'provider_id', 'synced_at', now()))
   where u.auth_id = a.id;

  select id into matched
    from public.users
   where auth_id = a.id
   order by (org_id = private.active_org_id()) desc nulls last, joined_at
   limit 1;
  return matched;
end $function$;

-- The public-schema helpers are kept as thin forwarders rather than deleted:
-- policies written before the private schema existed still call them by the
-- old names, and a forwarder means there is exactly one definition of "which
-- company is this request about" rather than two that can drift apart.
CREATE OR REPLACE FUNCTION public.auth_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.active_org_id() $function$;

CREATE OR REPLACE FUNCTION public.auth_role()
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.auth_role() $function$;

CREATE OR REPLACE FUNCTION public.auth_user()
 RETURNS users
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select * from public.users where id = private.auth_user_id() $function$;

CREATE OR REPLACE FUNCTION public.guard_user_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if private.auth_uid() is null then
    return new;
  end if;
  -- A membership operation — accepting an invitation, being restored — runs
  -- under this flag for its own transaction and nothing else.
  if current_setting('workfence.membership_op', true) = 'on' then
    return new;
  end if;
  if private.is_superadmin() or private.is_org_admin() then
    return new;
  end if;
  if old.auth_id is null
     and new.auth_id = private.auth_uid()
     and new.role is not distinct from old.role
     and new.org_id is not distinct from old.org_id
     and new.status is not distinct from old.status
     and new.employee_code is not distinct from old.employee_code then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.org_id is distinct from old.org_id
     or new.auth_id is distinct from old.auth_id
     or new.status is distinct from old.status
     or new.employee_code is distinct from old.employee_code then
    raise exception
      'only an administrator can change role, status, employee code or organisation'
      using errcode = '42501';
  end if;
  return new;
end $function$;

-- ---------------------------------------------- policies left on the old ones ----
-- Nine tables' worth, rewritten to the live definitions. Every one of these
-- reached org_id through the unordered lookup above.
drop policy if exists allowance_dec_read on allowance_decisions;
create policy allowance_dec_read on allowance_decisions
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND (( SELECT private.is_org_admin() AS is_org_admin) OR (employee_id = ( SELECT private.auth_user_id() AS auth_user_id))))));

drop policy if exists allowance_dec_write on allowance_decisions;
create policy allowance_dec_write on allowance_decisions
  for all
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin))))
  with check (((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin)));

drop policy if exists comp_insert on compensation;
create policy comp_insert on compensation
  for insert
  with check (((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_owner() AS is_org_owner)));

drop policy if exists comp_read on compensation;
create policy comp_read on compensation
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND (( SELECT private.is_org_owner() AS is_org_owner) OR (employee_id = ( SELECT private.auth_user_id() AS auth_user_id))))));

drop policy if exists food_read on food_rules;
create policy food_read on food_rules
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR (org_id = ( SELECT private.auth_org_id() AS auth_org_id))));

drop policy if exists food_write on food_rules;
create policy food_write on food_rules
  for all
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin))))
  with check (((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin)));

drop policy if exists notif_read on notifications;
create policy notif_read on notifications
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ((user_id = ( SELECT private.auth_user_id() AS auth_user_id)) OR ((user_id IS NULL) AND ((audience = ( SELECT private.auth_role() AS auth_role)) OR ( SELECT private.is_org_admin() AS is_org_admin)))))));

drop policy if exists paypolicy_read on pay_policies;
create policy paypolicy_read on pay_policies
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR (org_id = ( SELECT private.auth_org_id() AS auth_org_id))));

drop policy if exists paypolicy_write on pay_policies;
create policy paypolicy_write on pay_policies
  for all
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_owner() AS is_org_owner))))
  with check (((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_owner() AS is_org_owner)));

drop policy if exists payroll_read on payroll_runs;
create policy payroll_read on payroll_runs
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin))));

drop policy if exists payroll_write on payroll_runs;
create policy payroll_write on payroll_runs
  for all
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_owner() AS is_org_owner))))
  with check (((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_owner() AS is_org_owner)));

drop policy if exists petrol_read on petrol_rules;
create policy petrol_read on petrol_rules
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR (org_id = ( SELECT private.auth_org_id() AS auth_org_id))));

drop policy if exists petrol_write on petrol_rules;
create policy petrol_write on petrol_rules
  for all
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin))))
  with check (((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin)));

drop policy if exists shift_assign_read on shift_assignments;
create policy shift_assign_read on shift_assignments
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND (( SELECT private.is_org_admin() AS is_org_admin) OR (employee_id = ( SELECT private.auth_user_id() AS auth_user_id))))));

drop policy if exists shift_assign_write on shift_assignments;
create policy shift_assign_write on shift_assignments
  for all
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin))))
  with check (((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin)));

drop policy if exists shifts_read on shifts;
create policy shifts_read on shifts
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR (org_id = ( SELECT private.auth_org_id() AS auth_org_id))));

drop policy if exists shifts_write on shifts;
create policy shifts_write on shifts
  for all
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin))))
  with check (((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND ( SELECT private.is_org_admin() AS is_org_admin)));

drop policy if exists travel_insert on travel_sessions;
create policy travel_insert on travel_sessions
  for insert
  with check (((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND (( SELECT private.is_org_admin() AS is_org_admin) OR (employee_id = ( SELECT private.auth_user_id() AS auth_user_id)))));

drop policy if exists travel_read on travel_sessions;
create policy travel_read on travel_sessions
  for select
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND (( SELECT private.is_org_admin() AS is_org_admin) OR (employee_id = ( SELECT private.auth_user_id() AS auth_user_id))))));

drop policy if exists travel_update on travel_sessions;
create policy travel_update on travel_sessions
  for update
  using ((( SELECT private.is_superadmin() AS is_superadmin) OR ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)) AND (( SELECT private.is_org_admin() AS is_org_admin) OR (employee_id = ( SELECT private.auth_user_id() AS auth_user_id))))))
  with check ((org_id = ( SELECT private.auth_org_id() AS auth_org_id)));
