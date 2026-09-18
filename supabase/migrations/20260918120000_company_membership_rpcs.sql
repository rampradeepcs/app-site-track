-- ============================================================================
-- Catch-up 3 of 3: the RPCs the app calls.
--
-- Everything the multi-company surface is made of: the list a person chooses a
-- company from, the roster an admin manages, founding a second company, editing
-- the company you are in, inviting somebody and the four ends an invitation can
-- come to, removing and restoring a member, and the branding a tenant subdomain
-- serves before anybody has signed in.
--
-- Depends on 20260914000000 (active_org_id, profiles, the status value) and on
-- 20260917140000 / 20260917150000 (the invitations table and its read policy).
-- ============================================================================

-- Raising a notification is a definer-side job: the events worth telling a
-- company about are exactly the ones whose actor may not be able to see that
-- company's notification rows.
CREATE OR REPLACE FUNCTION private.notify_org(p_org uuid, p_audience app_role, p_kind text, p_title text, p_body text, p_severity text DEFAULT 'info'::text, p_link text DEFAULT NULL::text, p_user uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.notifications
    (org_id, audience, user_id, kind, title, body, severity, link, read, at)
  values (p_org, p_audience, p_user, p_kind, p_title, p_body, p_severity, p_link, false, now())
$function$;;

grant execute on function private.notify_org(uuid, app_role, text, text, text, text, text, uuid)
  to authenticated, service_role;

-- ------------------------------------------------------------- membership ----
CREATE OR REPLACE FUNCTION public.my_companies()
 RETURNS TABLE(org_id uuid, name text, slug text, code text, org_status text, app_name text, logo_text text, accent text, membership_id uuid, role app_role, status text, employee_code text, designation text, joined_at timestamp with time zone, active_projects integer, is_active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select o.id, o.name, o.slug, o.code, o.status::text,
         o.branding->>'appName', o.branding->>'logoText', o.branding->>'accent',
         u.id, u.role, u.status::text, u.employee_code, u.designation, u.joined_at,
         (select count(*)::int from public.projects p
           where p.org_id = o.id and p.status::text = 'active'
             and (u.role in ('admin', 'manager')
                  or exists (select 1 from public.project_members m
                              where m.project_id = p.id and m.user_id = u.id))),
         o.id = private.active_org_id()
    from public.users u
    join public.organizations o on o.id = u.org_id
   where u.auth_id = auth.uid()
     and u.status <> 'revoked'
   order by u.joined_at
$function$;;

CREATE OR REPLACE FUNCTION public.company_members()
 RETURNS TABLE(membership_id uuid, activated boolean, invited boolean, invitation_id uuid, invited_at timestamp with time zone, invitation_expires_at timestamp with time zone, last_sign_in_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.id,
         u.auth_id is not null,
         i.id is not null,
         i.id,
         i.created_at,
         i.expires_at,
         u.last_sign_in_at
    from public.users u
    left join lateral (
      select ci.id, ci.created_at, ci.expires_at
        from public.company_invitations ci
       where ci.org_id = u.org_id
         and lower(ci.email) = lower(u.email)
         and ci.status = 'pending'
         and ci.expires_at > now()
       order by ci.created_at desc
       limit 1) i on true
   where u.org_id = private.active_org_id()
     and private.is_org_admin()
$function$;;

CREATE OR REPLACE FUNCTION public.create_company(payload jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select public.provision_company(payload) $function$;;

CREATE OR REPLACE FUNCTION public.update_my_company(payload jsonb)
 RETURNS organizations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org      uuid := private.active_org_id();
  me       public.users%rowtype;
  row      public.organizations%rowtype;
  old_name text;
  new_name text;
begin
  if org is null or not private.is_org_owner() then
    raise exception 'only a company administrator may change the company' using errcode = '42501';
  end if;
  select * into me from public.users where id = private.auth_user_id();
  select * into row from public.organizations where id = org for update;
  old_name := row.name;

  new_name := btrim(coalesce(payload->>'name', row.name));
  if length(new_name) < 2 then
    raise exception 'the company needs a name' using errcode = '22023';
  end if;

  update public.organizations o
     set name          = new_name,
         industry      = coalesce(nullif(btrim(coalesce(payload->>'industry', '')), ''), o.industry),
         website       = coalesce(payload->>'website', o.website),
         contact_name  = coalesce(payload->>'contactName', o.contact_name),
         contact_email = coalesce(payload->>'contactEmail', o.contact_email),
         contact_phone = coalesce(payload->>'contactPhone', o.contact_phone),
         country       = coalesce(payload->>'country', o.country),
         timezone      = coalesce(nullif(btrim(coalesce(payload->>'timezone', '')), ''), o.timezone),
         branding      = o.branding || coalesce(payload->'branding', '{}'::jsonb),
         billing       = o.billing  || coalesce(payload->'billing',  '{}'::jsonb)
   where o.id = org
   returning * into row;

  insert into public.audit_log (org_id, actor_id, action, target, detail)
  values (org, me.id, 'company.update', row.name,
          case when old_name is distinct from new_name
               then me.name || ' renamed the company from ' || old_name || ' to ' || new_name
               else me.name || ' updated the company profile' end);

  insert into public.platform_audit
    (actor_id, actor_name, org_id, action, target, previous_value, new_value, detail)
  values (me.id, me.name, org, 'company.update', row.name, old_name, new_name,
          'Company profile edited by its administrator');

  -- A rename shows up on every screen; the other administrators should know
  -- why, rather than wondering whose company they are looking at.
  if old_name is distinct from new_name then
    perform private.notify_org(
      org, 'admin', 'company-renamed',
      'Company renamed to ' || new_name,
      me.name || ' changed the name from ' || old_name || '.',
      'info', '/admin/company');
  else
    perform private.notify_org(
      org, 'admin', 'company-updated',
      'Company profile updated',
      me.name || ' changed the company details.',
      'info', '/admin/company');
  end if;

  return row;
end $function$;;

CREATE OR REPLACE FUNCTION public.remove_member(p_user uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org    uuid := private.active_org_id();
  me     public.users%rowtype;
  target public.users%rowtype;
  o_name text;
begin
  if org is null or not private.is_org_admin() then
    raise exception 'only a company administrator or manager may remove members' using errcode = '42501';
  end if;
  select * into me from public.users where id = private.auth_user_id();
  select * into target from public.users where id = p_user and org_id = org for update;
  if not found then
    raise exception 'no such member of this company' using errcode = '22023';
  end if;
  if target.id = me.id then
    raise exception 'you cannot remove yourself; ask another administrator' using errcode = '42501';
  end if;
  if me.role = 'manager' and target.role <> 'employee' then
    raise exception 'a manager may remove employees only' using errcode = '42501';
  end if;
  if target.role = 'admin'
     and (select count(*) from public.users
           where org_id = org and role = 'admin' and status = 'active') <= 1 then
    raise exception 'a company must keep at least one administrator' using errcode = '42501';
  end if;
  select name into o_name from public.organizations where id = org;

  update public.users set status = 'revoked', removed_at = now() where id = target.id;
  delete from public.project_members where user_id = target.id;
  update public.company_invitations set status = 'cancelled'
   where org_id = org and status = 'pending'
     and (invited_user_id = target.auth_id or lower(email) = lower(target.email));

  insert into public.audit_log (org_id, actor_id, action, target, detail)
  values (org, me.id, 'member.remove', target.id::text,
          me.name || ' removed ' || target.name || ' from ' || coalesce(o_name, 'the company')
          || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));
  insert into public.platform_audit
    (actor_id, actor_name, org_id, action, target, previous_value, new_value, detail)
  values (me.id, me.name, org, 'member.revoke', target.name, target.status::text, 'revoked',
          'Access to ' || coalesce(o_name, 'the company') || ' revoked'
          || coalesce(': ' || nullif(btrim(p_reason), ''), ''));

  perform private.notify_org(
    org, 'admin', 'member-removed',
    target.name || ' was removed',
    me.name || ' revoked their access to the company'
      || coalesce(' — ' || nullif(btrim(p_reason), ''), '') || '.',
    'warning', '/admin/team');

  return jsonb_build_object('membershipId', target.id, 'status', 'revoked');
end $function$;;

CREATE OR REPLACE FUNCTION public.restore_member(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org    uuid := private.active_org_id();
  me     public.users%rowtype;
  target public.users%rowtype;
begin
  if org is null or not private.is_org_owner() then
    raise exception 'only a company administrator may restore a member' using errcode = '42501';
  end if;
  select * into me from public.users where id = private.auth_user_id();
  select * into target from public.users where id = p_user and org_id = org for update;
  if not found then
    raise exception 'no such member of this company' using errcode = '22023';
  end if;
  perform set_config('workfence.membership_op', 'on', true);
  update public.users set status = 'active', removed_at = null where id = target.id;
  insert into public.audit_log (org_id, actor_id, action, target, detail)
  values (org, me.id, 'member.restore', target.id::text, me.name || ' restored ' || target.name);
  insert into public.platform_audit
    (actor_id, actor_name, org_id, action, target, previous_value, new_value, detail)
  values (me.id, me.name, org, 'member.restore', target.name, target.status::text, 'active', 'Membership restored');

  perform private.notify_org(
    org, 'admin', 'member-restored',
    target.name || ' was restored',
    me.name || ' gave them access to the company again.',
    'success', '/admin/team');

  return jsonb_build_object('membershipId', target.id, 'status', 'active');
end $function$;;

-- ------------------------------------------------------------ invitations ----
CREATE OR REPLACE FUNCTION public.invite_member(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org      uuid := private.active_org_id();
  me       public.users%rowtype;
  v_email  text := lower(btrim(coalesce(payload->>'email', '')));
  v_name   text := btrim(coalesce(payload->>'name', ''));
  v_role   public.app_role;
  existing public.users%rowtype;
  auth_for uuid;
  inv_id   uuid;
begin
  if org is null or not private.is_org_admin() then
    raise exception 'only a company administrator or manager may invite' using errcode = '42501';
  end if;
  select * into me from public.users where id = private.auth_user_id();
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'a valid email address is required' using errcode = '22023';
  end if;
  v_role := coalesce(nullif(payload->>'role', ''), 'employee')::public.app_role;
  if v_role = 'superadmin' then
    raise exception 'that role cannot be given by a company' using errcode = '22023';
  end if;
  if me.role = 'manager' and v_role <> 'employee' then
    raise exception 'a manager may invite employees only' using errcode = '42501';
  end if;

  select * into existing from public.users
   where org_id = org and lower(email) = v_email limit 1;
  if found and existing.status <> 'revoked' and existing.auth_id is not null then
    raise exception '% is already a member of this company', v_email using errcode = '23505';
  end if;

  select id into auth_for from auth.users
   where lower(email) = v_email and email_confirmed_at is not null limit 1;

  insert into public.company_invitations
    (org_id, invited_user_id, email, phone, name, role, department, designation,
     project_id, shift_id, employment_type, invited_by)
  values
    (org, auth_for, v_email, nullif(btrim(coalesce(payload->>'phone', '')), ''), v_name, v_role,
     btrim(coalesce(payload->>'department', '')), btrim(coalesce(payload->>'designation', '')),
     nullif(payload->>'projectId', '')::uuid, nullif(payload->>'shiftId', '')::uuid,
     coalesce(nullif(payload->>'employmentType', ''), 'full-time'), me.id)
  on conflict (org_id, lower(email)) where status = 'pending' do update
    set role = excluded.role, name = excluded.name, phone = excluded.phone,
        department = excluded.department, designation = excluded.designation,
        project_id = excluded.project_id, shift_id = excluded.shift_id,
        employment_type = excluded.employment_type, invited_by = excluded.invited_by,
        invited_user_id = excluded.invited_user_id,
        expires_at = now() + interval '30 days'
  returning id into inv_id;

  insert into public.audit_log (org_id, actor_id, action, target, detail)
  values (org, me.id, 'member.invite', v_email,
          me.name || ' invited ' || coalesce(nullif(v_name, ''), v_email) || ' as ' || v_role::text);

  -- For the other administrators, who did not press the button.
  perform private.notify_org(
    org, 'admin', 'member-invited',
    'Invitation sent to ' || coalesce(nullif(v_name, ''), v_email),
    me.name || ' invited them to join as ' || v_role::text || '.',
    'info', '/admin/team');

  return jsonb_build_object('id', inv_id, 'existingUser', auth_for is not null, 'email', v_email);
end $function$;;

CREATE OR REPLACE FUNCTION public.my_invitations()
 RETURNS TABLE(id uuid, org_id uuid, company text, role app_role, designation text, department text, project text, invited_by text, created_at timestamp with time zone, expires_at timestamp with time zone, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select i.id, i.org_id, o.name, i.role, i.designation, i.department, p.name, b.name,
         i.created_at, i.expires_at, i.status
    from public.company_invitations i
    join public.organizations o on o.id = i.org_id
    left join public.projects p on p.id = i.project_id
    left join public.users b on b.id = i.invited_by
   where i.status = 'pending'
     and i.expires_at > now()
     and (i.invited_user_id = auth.uid()
          or lower(i.email) = (select lower(a.email) from auth.users a
                                where a.id = auth.uid() and a.email_confirmed_at is not null))
   order by i.created_at desc
$function$;;

CREATE OR REPLACE FUNCTION public.company_invitations_pending()
 RETURNS TABLE(id uuid, email text, name text, role app_role, designation text, department text, project text, invited_by text, created_at timestamp with time zone, expires_at timestamp with time zone, has_membership boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select i.id, i.email, i.name, i.role, i.designation, i.department, p.name, b.name,
         i.created_at, i.expires_at,
         exists (select 1 from public.users u
                  where u.org_id = i.org_id and lower(u.email) = lower(i.email))
    from public.company_invitations i
    left join public.projects p on p.id = i.project_id
    left join public.users b on b.id = i.invited_by
   where i.org_id = private.active_org_id()
     and private.is_org_admin()
     and i.status = 'pending'
     and i.expires_at > now()
   order by i.created_at desc
$function$;;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  i        public.company_invitations%rowtype;
  a        auth.users%rowtype;
  prof     public.profiles%rowtype;
  existing public.users%rowtype;
  o_name   text;
  stem     text;
  n        int;
  mid      uuid;
  m_name   text;
begin
  select * into i from public.company_invitations where id = p_id for update;
  if not found or i.status <> 'pending' then
    raise exception 'no such invitation' using errcode = '22023';
  end if;
  if i.expires_at < now() then
    update public.company_invitations set status = 'expired' where id = p_id;
    raise exception 'that invitation has expired' using errcode = '22023';
  end if;
  select * into a from auth.users where id = auth.uid();
  if a.id is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if not (i.invited_user_id = a.id
          or (a.email_confirmed_at is not null and lower(a.email) = lower(i.email))) then
    raise exception 'this invitation is for somebody else' using errcode = '42501';
  end if;

  perform set_config('workfence.membership_op', 'on', true);
  perform private.sync_user_from_auth(a.id);
  select * into prof from public.profiles where auth_id = a.id;
  select name into o_name from public.organizations where id = i.org_id;
  m_name := coalesce(nullif(prof.name, ''), nullif(i.name, ''), split_part(i.email, '@', 1));

  select * into existing from public.users
   where org_id = i.org_id
     and (auth_id = a.id or (auth_id is null and lower(email) = lower(i.email)))
   order by (auth_id = a.id) desc nulls last
   limit 1;

  if found then
    if existing.auth_id = a.id and existing.status <> 'revoked' then
      update public.company_invitations
         set status = 'accepted', accepted_at = now(), invited_user_id = a.id where id = p_id;
      return jsonb_build_object('orgId', i.org_id, 'membershipId', existing.id, 'alreadyMember', true);
    end if;
    update public.users
       set auth_id     = a.id,
           status      = 'active',
           removed_at  = null,
           role        = i.role,
           designation = coalesce(nullif(i.designation, ''), designation),
           department  = coalesce(nullif(i.department, ''), department),
           invited_by  = i.invited_by,
           joined_at   = now(),
           name        = case when btrim(name) = '' then m_name else name end
     where id = existing.id
     returning id into mid;
  else
    stem := upper(regexp_replace(
              substring(regexp_replace(coalesce(o_name, ''), '(\S)\S*\s*', '\1', 'g') from 1 for 3),
              '[^A-Za-z]', '', 'g'));
    if stem = '' then stem := 'WF'; end if;
    select coalesce(max(substring(employee_code from '[0-9]+$')::int), 0) into n
      from public.users where org_id = i.org_id and employee_code ~ ('^' || stem || '-[0-9]+$');
    insert into public.users
      (org_id, auth_id, name, employee_code, role, designation, department, phone, email,
       avatar_hue, status, shift_start, shift_end, invited_by, joined_at)
    values
      (i.org_id, a.id, m_name, stem || '-' || lpad((n + 1)::text, 4, '0'), i.role,
       coalesce(nullif(i.designation, ''),
                case i.role when 'admin' then 'Administrator' when 'manager' then 'Manager' else 'Worker' end),
       coalesce(nullif(i.department, ''), 'Site'),
       coalesce(prof.phone, i.phone, ''), lower(i.email),
       (hashtext(i.email) % 360 + 360) % 360, 'active', 540, 1080, i.invited_by, now())
    returning id into mid;
  end if;

  if i.project_id is not null then
    insert into public.project_members (project_id, user_id, org_id)
    values (i.project_id, mid, i.org_id) on conflict do nothing;
  end if;

  update public.company_invitations
     set status = 'accepted', accepted_at = now(), invited_user_id = a.id where id = p_id;

  insert into public.audit_log (org_id, actor_id, action, target, detail)
  values (i.org_id, mid, 'member.accept', lower(i.email),
          m_name || ' joined ' || coalesce(o_name, 'the company') || ' as ' || i.role::text);

  -- The thing an administrator was waiting to hear.
  perform private.notify_org(
    i.org_id, 'admin', 'member-joined',
    m_name || ' joined the company',
    m_name || ' accepted the invitation and is now ' || i.role::text || '.',
    'success', '/admin/team');

  return jsonb_build_object('orgId', i.org_id, 'membershipId', mid, 'alreadyMember', false);
end $function$;;

CREATE OR REPLACE FUNCTION public.decline_invitation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  i public.company_invitations%rowtype;
  a auth.users%rowtype;
begin
  select * into i from public.company_invitations where id = p_id for update;
  if not found or i.status <> 'pending' then
    raise exception 'no such invitation' using errcode = '22023';
  end if;
  select * into a from auth.users where id = auth.uid();
  if not (i.invited_user_id = a.id
          or (a.email_confirmed_at is not null and lower(a.email) = lower(i.email))) then
    raise exception 'this invitation is for somebody else' using errcode = '42501';
  end if;
  update public.company_invitations set status = 'declined' where id = p_id;
  insert into public.audit_log (org_id, actor_id, action, target, detail)
  values (i.org_id, null, 'member.decline', lower(i.email), lower(i.email) || ' declined the invitation');

  -- Worth hearing too: a seat being held for somebody who is not coming.
  perform private.notify_org(
    i.org_id, 'admin', 'invitation-declined',
    coalesce(nullif(i.name, ''), lower(i.email)) || ' declined',
    lower(i.email) || ' will not be joining the company.',
    'warning', '/admin/team');
end $function$;;

CREATE OR REPLACE FUNCTION public.cancel_invitation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org uuid := private.active_org_id();
  me  public.users%rowtype;
  inv public.company_invitations%rowtype;
begin
  if org is null or not private.is_org_admin() then
    raise exception 'only a company administrator or manager may cancel an invitation' using errcode = '42501';
  end if;
  select * into me from public.users where id = private.auth_user_id();
  select * into inv from public.company_invitations where id = p_id and org_id = org for update;
  if not found then
    raise exception 'no such invitation' using errcode = '22023';
  end if;
  update public.company_invitations set status = 'cancelled' where id = p_id;
  insert into public.audit_log (org_id, actor_id, action, target, detail)
  values (org, me.id, 'member.invite.cancel', lower(inv.email),
          me.name || ' cancelled the invitation to ' || lower(inv.email));
end $function$;;

-- --------------------------------------------------------------- branding ----
CREATE OR REPLACE FUNCTION public.tenant_branding(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
           'slug',     o.slug,
           'name',     o.name,
           'appName',  coalesce(nullif(o.branding->>'appName', ''), 'Workfence'),
           'accent',   o.branding->>'accent',
           'logoText', o.branding->>'logoText',
           'status',   o.status)
    from public.organizations o
   where o.slug = lower(btrim(p_slug))
   limit 1
$function$;;

grant execute on function public.my_companies()                to authenticated, service_role;
grant execute on function public.company_members()             to authenticated, service_role;
grant execute on function public.create_company(jsonb)         to authenticated, service_role;
grant execute on function public.update_my_company(jsonb)      to authenticated, service_role;
grant execute on function public.remove_member(uuid, text)     to authenticated, service_role;
grant execute on function public.restore_member(uuid)          to authenticated, service_role;
grant execute on function public.invite_member(jsonb)          to authenticated, service_role;
grant execute on function public.my_invitations()              to authenticated, service_role;
grant execute on function public.company_invitations_pending() to authenticated, service_role;
grant execute on function public.accept_invitation(uuid)       to authenticated, service_role;
grant execute on function public.decline_invitation(uuid)      to authenticated, service_role;
grant execute on function public.cancel_invitation(uuid)       to authenticated, service_role;

-- tenant_branding answers for a subdomain before there is a session: it is how
-- a client's own login page knows whose logo to wear. anon needs it by design,
-- and it returns only what a login page may show.
grant execute on function public.tenant_branding(text)         to anon, authenticated, service_role;
