-- ============================================================================
-- Being put on a site is news. Tell the person.
--
-- Assigning somebody to a project was completely silent. set_project_members
-- wrote the rows and returned two counts; every other membership event in the
-- product — invited, joined, removed, restored — raises a notification in the
-- same transaction as the change, and this one raised nothing. So a worker was
-- added to a site and the first they knew of it was noticing a new site in the
-- app, if they happened to look.
--
-- The client was no better: assignEmployee updates the roster, writes an audit
-- row and syncs, and never calls pushNotification. So there was nothing to miss
-- on either side.
--
-- Raised here rather than in the client for the same reason the other
-- membership events are: it happens in the transaction that changes the roster,
-- so a notification cannot exist for an assignment that did not land, and an
-- assignment cannot land without one. It also means it works whoever did the
-- assigning and from whichever device.
--
-- The function already knew who was added — the `fresh` CTE counted the rows it
-- inserted and threw the ids away. Now it keeps them.
-- ============================================================================

create or replace function public.set_project_members(p_project uuid, p_users uuid[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  org      uuid;
  proj     text;
  proj_code text;
  wanted   uuid[] := coalesce(p_users, '{}'::uuid[]);
  stranger uuid;
  added    int;
  removed  int;
  joined   uuid[];
  joiner   record;
begin
  select p.org_id, p.name, p.code into org, proj, proj_code
    from public.projects p where p.id = p_project;
  if org is null then
    raise exception 'no such project' using errcode = '22023';
  end if;

  -- The same question the members_write policy asks, asked here because a
  -- SECURITY DEFINER function is not subject to it. Deliberately identical:
  -- this is meant to be safer than the client, not more permissive.
  if not (
    (select private.is_superadmin())
    or (org = (select private.active_org_id()) and (select private.is_org_admin()))
  ) then
    raise exception 'only this company may change its project rosters'
      using errcode = '42501';
  end if;

  -- Nobody from another company lands on this site, whatever the caller
  -- sends. The rows carry org_id and a wrong one would be invisible to the
  -- tenant it named and present in their counts.
  select w.id into stranger
    from unnest(wanted) as w(id)
   where not exists (
     select 1 from public.users u where u.id = w.id and u.org_id = org
   )
   limit 1;
  if stranger is not null then
    raise exception 'that person is not a member of this company'
      using errcode = '22023';
  end if;

  with keep as (
    select distinct unnest(wanted) as user_id
  ),
  gone as (
    delete from public.project_members pm
     where pm.project_id = p_project
       and not exists (select 1 from keep k where k.user_id = pm.user_id)
    returning 1
  ),
  fresh as (
    insert into public.project_members (project_id, user_id, org_id)
    select p_project, k.user_id, org
      from keep k
     where not exists (
       select 1 from public.project_members pm
        where pm.project_id = p_project and pm.user_id = k.user_id
     )
    on conflict (project_id, user_id) do nothing
    -- Keeping the ids, not just the count: they are who has to be told.
    returning user_id
  )
  select (select count(*) from gone),
         coalesce((select array_agg(user_id) from fresh), '{}'::uuid[])
    into removed, joined;

  added := coalesce(array_length(joined, 1), 0);

  -- One notification each, addressed to the person rather than broadcast to a
  -- role: everyone else on the site already knows they are on it. The audience
  -- is that person's own role, because the app filters the feed by role before
  -- it filters by user — an employee's notification tagged `manager` would be
  -- written, synced and never shown.
  for joiner in
    select u.id, u.role
      from unnest(joined) as j(user_id)
      join public.users u on u.id = j.user_id
     where u.status not in ('inactive', 'revoked')
  loop
    perform private.notify_org(
      org,
      joiner.role,
      'project-assigned',
      'You are on ' || proj,
      case when coalesce(proj_code, '') = '' then ''
           else proj_code || ' — ' end
        || 'check in here from your next shift.',
      'info',
      case when joiner.role = 'employee' then '/employee'
           else '/manager/project?id=' || p_project::text end,
      joiner.id);
  end loop;

  return jsonb_build_object('added', added, 'removed', removed);
end $$;

grant execute on function public.set_project_members(uuid, uuid[]) to authenticated, service_role;
