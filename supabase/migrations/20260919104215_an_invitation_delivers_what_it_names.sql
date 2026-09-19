-- ============================================================================
-- An invitation has to deliver what it named.
--
-- Somebody signed up, accepted their invitation, and the home screen told
-- them they had no project. That particular case was not this function's
-- fault — the invitation was sent without a project, and the form has been
-- changed to stop that — but looking at the path turned up two ways this
-- function can drop an assignment it was given, and both end at the same
-- blank screen.
--
--   1. The early return. When the person already has a live membership row,
--      the function marks the invitation accepted and returns before it
--      reaches the project grant. That is reachable: the founding wizard
--      writes crew rows with no auth_id, an administrator can then invite
--      one of those people to a specific site, and clicking the mail link
--      creates the auth user, which fires link_auth_identity, which claims
--      the crew row. By the time Accept is pressed they look like an
--      existing member, so the branch is taken and the project they were
--      invited to is silently dropped.
--
--      It has never fired in this database — no accepted invitation has ever
--      carried a project — so this is prevention, not repair.
--
--   2. shift_id, which the function has never read at all. The invitation
--      screen has a shift picker, invite_member stores the answer, and
--      nothing downstream applies it. Same defect as the project one, one
--      column over, and worth closing in the same pass rather than waiting
--      for it to be reported in its own right.
--
-- The shape of the fix is to stop treating the grants as something that
-- happens at the end of the happy path, and make them the thing the function
-- does on every path that ends in a membership. So they move into one block
-- that all three branches reach.
--
-- Deliberately NOT changed here, and worth knowing about:
--   * private.sync_user_from_auth can mark an invitation accepted from the
--     auth trigger without granting anything. Rewriting it means restating
--     a hundred lines by hand, which is how drift gets introduced; it needs
--     its own change with its own test.
--   * public.link_auth_identity claims an unclaimed users row by email OR
--     PHONE, with no confirmation check. That is a wider question than this
--     migration.
--   * employment_type is stored on the invitation and has no column on
--     public.users to land in.
-- ============================================================================

create or replace function public.accept_invitation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
  already  boolean := false;
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
      -- Already a member. This used to return here, which is what dropped
      -- the grants. It now falls through to them, carrying a flag so the
      -- rest of the function still knows this was not a new joiner: no
      -- audit line and no "joined the company" notification, because they
      -- did not join, and the administrator does not need telling twice.
      --
      -- The role is deliberately still not applied. An invitation must not
      -- be a way to re-grade somebody who is already here.
      already := true;
      mid     := existing.id;
    else
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
    end if;
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

  -- ---------------------------------------------------------- the grants --
  -- Every path that produced a membership arrives here, which is the change.
  --
  -- The project is checked against the invitation's own company rather than
  -- trusted from the row. project_members has no constraint tying its
  -- project to its org, so a stale or cross-tenant id would otherwise be
  -- stored and believed — and this function is SECURITY DEFINER, so no
  -- policy is going to catch it on the way past.
  if i.project_id is not null
     and exists (select 1 from public.projects p
                  where p.id = i.project_id and p.org_id = i.org_id) then
    insert into public.project_members (project_id, user_id, org_id)
    values (i.project_id, mid, i.org_id)
    on conflict (project_id, user_id) do nothing;
  end if;

  -- The shift the invitation named, applied from today. Same company check,
  -- for the same reason. `already` members are included: being put on a
  -- shift is not a re-grading, it is the roster answer somebody asked for
  -- when they sent the invitation.
  if i.shift_id is not null
     and exists (select 1 from public.shifts sh
                  where sh.id = i.shift_id and sh.org_id = i.org_id)
     and not exists (select 1 from public.shift_assignments sa
                      where sa.employee_id = mid and sa.shift_id = i.shift_id) then
    insert into public.shift_assignments
      (org_id, employee_id, shift_id, effective_from, assigned_by)
    values (i.org_id, mid, i.shift_id, current_date, i.invited_by);
  end if;

  update public.company_invitations
     set status = 'accepted', accepted_at = now(), invited_user_id = a.id where id = p_id;

  if already then
    return jsonb_build_object('orgId', i.org_id, 'membershipId', mid, 'alreadyMember', true);
  end if;

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
end $function$;

grant execute on function public.accept_invitation(uuid) to authenticated, service_role;
