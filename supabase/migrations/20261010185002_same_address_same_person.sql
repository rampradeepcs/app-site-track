-- Same address, same person — and asked before joining a further company.
--
-- Google, Outlook and the emailed code are three ways of proving one thing:
-- that the person holds an address. A company that typed that address into
-- its roster has said who it means. This makes the two meet every time:
--
--   * Someone who belongs to no company yet takes every record made for
--     their confirmed address the moment they sign in, in every company —
--     signing in is their acceptance, as it always was. It used to be one
--     company: the insert trigger below linked a single row, unconfirmed,
--     before the address was proven, and that one link switched the
--     claim-every-record rule off for good.
--
--   * Someone who already belongs somewhere is asked about each further
--     company, once. A record another company made for their address
--     becomes a pending invitation addressed to them, tied to that record,
--     which the app raises at sign-in; accepting links that very record, as
--     the company has it then. Before this, a record added directly — Add
--     employee, the signup wizard's crew — was never linked and never
--     offered: the person could not reach that company at all.
--
--   * Founding a company is not a way round either. provision_company now
--     refuses a caller who already belongs somewhere, unless they came
--     through create_company, the deliberate "another company" path.
--
-- Built against the functions as they are in production, which had drifted
-- from the committed migrations. provision_company and accept_invitation
-- are spliced at exact anchor lines rather than restated, so nothing else in
-- them changes; a splice whose anchor is missing stops the migration.

-- ------------------------------------------- 1. the record an invitation --
-- An invitation the sync makes from a roster record names it. Deleting the
-- record deletes its invitation; accepting links exactly that record; and
-- "declined" is remembered per record, not by a timestamp a company's
-- device writes.

alter table public.company_invitations
  add column if not exists source_user_id uuid
  references public.users(id) on delete cascade;

create index if not exists company_invitations_source_user_idx
  on public.company_invitations (source_user_id)
  where source_user_id is not null;

-- -------------------------------------------------- 2. the insert trigger --
-- Linking now happens only once an address is confirmed: on the UPDATE that
-- confirms it (on_auth_user_synced) or when the app asks (sync_my_profile).
-- Phone matching retires with it; email has been the identity since
-- 20260831001100.

create or replace function public.link_auth_identity()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Deliberately does nothing. At INSERT the address is not yet confirmed —
  -- GoTrue inserts the user and confirms it in a later UPDATE — so a link
  -- made here trusted an address nobody had proven, picked one company at
  -- random, and could pick a removed membership. See sync_user_from_auth.
  return new;
end;
$function$;

-- ------------------------------------------------------ 3. the sync rule --

create or replace function private.sync_user_from_auth(target uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  is_member  boolean;
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

  -- Nothing below trusts an address its provider has not confirmed.
  if p_email is not null and a.email_confirmed_at is not null then

    -- The platform owner's seat belongs to no company, so it is not a further
    -- company to be asked about; bootstrap.sql names its owner by address,
    -- and a re-created auth account must find it again (20260904100000).
    update public.users u
       set auth_id = a.id
     where u.auth_id is null
       and u.org_id is null
       and u.role = 'superadmin'
       and u.status <> 'revoked'
       and lower(u.email) = p_email
       and not exists (select 1 from public.users x
                        where x.auth_id = a.id and x.org_id is null);

    -- A removed membership is not belonging somewhere.
    is_member := exists (
      select 1 from public.users
       where auth_id = a.id and org_id is not null and status <> 'revoked');

    if not is_member then
      -- No company yet: every record made for this address, in every
      -- company, is theirs — signing in is the acceptance. Except a company
      -- they have already said no to.
      update public.users u
         set auth_id = a.id
       where u.auth_id is null
         and lower(u.email) = p_email
         and u.status <> 'revoked'
         and u.org_id is not null
         and not exists (select 1 from public.users x
                          where x.auth_id = a.id and x.org_id = u.org_id)
         and not exists (select 1 from public.company_invitations ci
                          where ci.status = 'declined'
                            and (ci.source_user_id = u.id
                                 or (ci.source_user_id is null
                                     and ci.org_id = u.org_id
                                     and lower(ci.email) = p_email
                                     and ci.created_at >= u.joined_at)));

      -- Invitations to those companies are answered by that — with what
      -- they promised. accept_invitation gives a project and a shift; so
      -- does this, under the same company checks, before marking them done.
      insert into public.project_members (project_id, user_id, org_id)
      select ci.project_id, u.id, ci.org_id
        from public.company_invitations ci
        join public.users u
          on u.org_id = ci.org_id and u.auth_id = a.id and u.status <> 'revoked'
        join public.projects p
          on p.id = ci.project_id and p.org_id = ci.org_id
       where ci.status = 'pending' and lower(ci.email) = p_email
      on conflict (project_id, user_id) do nothing;

      insert into public.shift_assignments
        (org_id, employee_id, shift_id, effective_from, assigned_by)
      select ci.org_id, u.id, ci.shift_id, current_date, ci.invited_by
        from public.company_invitations ci
        join public.users u
          on u.org_id = ci.org_id and u.auth_id = a.id and u.status <> 'revoked'
        join public.shifts sh
          on sh.id = ci.shift_id and sh.org_id = ci.org_id
       where ci.status = 'pending' and lower(ci.email) = p_email
         and not exists (select 1 from public.shift_assignments sa
                          where sa.employee_id = u.id and sa.shift_id = ci.shift_id);

      -- Only companies they are now actually in. A removed row is still
      -- linked, and counting it marked a re-invitation "accepted" while the
      -- person stayed removed — the one invitation that could bring them
      -- back, swallowed.
      update public.company_invitations
         set status = 'accepted', accepted_at = now(), invited_user_id = a.id
       where status = 'pending'
         and lower(email) = p_email
         and org_id in (select org_id from public.users
                         where auth_id = a.id and status <> 'revoked');
    else
      -- Already somewhere: each further company is asked, once, about the
      -- record it holds for them.

      -- An invitation whose record is gone, linked, or no longer live is
      -- withdrawn; one whose record changed says what it says now.
      update public.company_invitations ci
         set status = 'cancelled'
       where ci.status = 'pending'
         and ci.source_user_id is not null
         and lower(ci.email) = p_email
         and not exists (select 1 from public.users u
                          where u.id = ci.source_user_id
                            and u.auth_id is null
                            and u.status in ('active', 'on-leave')
                            and lower(u.email) = p_email);
      update public.company_invitations ci
         set role        = u.role,
             name        = coalesce(u.name, ''),
             designation = coalesce(u.designation, ''),
             department  = coalesce(u.department, ''),
             phone       = nullif(btrim(coalesce(u.phone, '')), '')
        from public.users u
       where ci.source_user_id = u.id
         and ci.status = 'pending';

      -- A live record with no invitation yet becomes one. Not again once
      -- they have declined that record; a company that adds them afresh
      -- makes a new record, and so a new question.
      insert into public.company_invitations
        (org_id, invited_user_id, email, phone, name, role, department,
         designation, invited_by, source_user_id)
      select u.org_id, a.id, lower(u.email), nullif(btrim(coalesce(u.phone, '')), ''),
             coalesce(u.name, ''), u.role, coalesce(u.department, ''),
             coalesce(u.designation, ''), u.invited_by, u.id
        from public.users u
       where u.auth_id is null
         and lower(u.email) = p_email
         and u.status in ('active', 'on-leave')
         and u.org_id is not null
         and u.role <> 'superadmin'
         and not exists (select 1 from public.users x
                          where x.auth_id = a.id and x.org_id = u.org_id)
         and not exists (select 1 from public.company_invitations ci
                          where ci.org_id = u.org_id
                            and lower(ci.email) = p_email
                            and ci.status = 'pending')
         and not exists (select 1 from public.company_invitations ci
                          where ci.source_user_id = u.id
                            and ci.status = 'declined')
      on conflict do nothing;
    end if;

    -- Invitations to this confirmed address now know who they are for.
    -- Inside the confirmed block: an unproven address must not be able to
    -- become the person an invitation is addressed to.
    update public.company_invitations
       set invited_user_id = a.id
     where status = 'pending' and invited_user_id is null
       and lower(email) = p_email;
  end if;

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

  -- A live membership before a removed one: the record somebody is "now".
  select id into matched
    from public.users
   where auth_id = a.id
   order by (status <> 'revoked') desc,
            (org_id = private.active_org_id()) desc nulls last,
            joined_at
   limit 1;
  return matched;
end $function$;

-- Same preference for the rows the app reads back.
create or replace function public.sync_my_profile()
 returns setof public.users
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform private.sync_user_from_auth(auth.uid());
  return query
    select * from public.users
     where auth_id = auth.uid()
     order by (status <> 'revoked') desc,
              (org_id = private.active_org_id()) desc nulls last,
              joined_at;
end $function$;

-- ------------------------------ 4. accepting a record-made invitation ----
-- Links the record the invitation was made from, as the company has it now:
-- its role, status and details are the company's, and an invitation is not
-- a way to restore an old copy of them. A record that is gone, linked to
-- somebody else, or no longer live refuses the invitation.

do $splice$
declare
  def     text := pg_get_functiondef('public.accept_invitation(uuid)'::regprocedure);
  lookup  text := E'  select * into existing from public.users\n'
               || E'   where org_id = i.org_id\n'
               || E'     and (auth_id = a.id or (auth_id is null and lower(email) = lower(i.email)))\n'
               || E'   order by (auth_id = a.id) desc nulls last\n'
               || E'   limit 1;\n';
  closing text := E'    returning id into mid;\n  end if;\n\n'
               || E'  -- ---------------------------------------------------------- the grants --';
  branch  text := E'  -- Made from a roster record (sync_user_from_auth): link that record,\n'
               || E'  -- as the company has it now, or refuse.\n'
               || E'  if i.source_user_id is not null then\n'
               || E'    select * into existing from public.users\n'
               || E'     where id = i.source_user_id and org_id = i.org_id\n'
               || E'     for update;\n'
               || E'    if not found\n'
               || E'       or (existing.auth_id is not null and existing.auth_id <> a.id)\n'
               || E'       or existing.status not in (''active'', ''on-leave'')\n'
               || E'       or lower(existing.email) <> lower(i.email) then\n'
               || E'      raise exception ''this invitation is no longer available'' using errcode = ''22023'';\n'
               || E'    end if;\n'
               || E'    if existing.auth_id = a.id then\n'
               || E'      already := true;\n'
               || E'    else\n'
               || E'      update public.users set auth_id = a.id where id = existing.id;\n'
               || E'    end if;\n'
               || E'    mid := existing.id;\n'
               || E'  else\n';
begin
  if position('i.source_user_id' in def) > 0 then
    return; -- applied already
  end if;
  if position(lookup in def) = 0 or position(closing in def) = 0 then
    raise exception 'accept_invitation has changed; add the source_user_id branch by hand';
  end if;
  def := replace(def, lookup, branch || lookup);
  def := replace(def, closing,
                 E'    returning id into mid;\n  end if;\n  end if;\n\n'
                 || E'  -- ---------------------------------------------------------- the grants --');
  execute def;
end
$splice$;

-- ------------------------------------------ 5. one company, unless meant --

-- The deliberate path says so for the length of its own transaction.
create or replace function public.create_company(payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform set_config('workfence.founding_another', 'on', true);
  return public.provision_company(payload);
end $function$;

-- Spliced into provision_company straight after its sign-in check.
do $splice$
declare
  def    text := pg_get_functiondef('public.provision_company(jsonb)'::regprocedure);
  anchor text := E'raise exception ''sign in before creating a company'' using errcode = ''28000'';\n  end if;';
  guard  text := E'\n  -- One company per sign-in unless meant: create_company, the deliberate\n'
              || E'  -- path for founding another, says so. Anyone else who already belongs\n'
              || E'  -- somewhere is opening their own company, not making a second one.\n'
              || E'  if current_setting(''workfence.founding_another'', true) is distinct from ''on''\n'
              || E'     and exists (select 1 from public.users m\n'
              || E'                  where m.auth_id = caller and m.org_id is not null\n'
              || E'                    and m.status <> ''revoked'') then\n'
              || E'    raise exception ''this address already belongs to a company''\n'
              || E'      using errcode = ''P0001'', hint = ''already_member'';\n'
              || E'  end if;';
begin
  if position('already_member' in def) > 0 then
    return; -- applied already
  end if;
  if position(anchor in def) = 0 then
    raise exception 'provision_company no longer opens with its sign-in check; add the already_member guard by hand';
  end if;
  execute replace(def, anchor, anchor || guard);
end
$splice$;
