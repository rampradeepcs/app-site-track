-- Change a project's roster by difference rather than by replacement.
--
-- The client did this as two statements: delete every row for the project,
-- then insert the list the browser happened to be holding. Two things go
-- wrong with that, and one of them already has.
--
-- A list built from stale or half-hydrated state silently drops whoever is
-- missing from it. That is the bug fixed in d0a3769 — the caller passed a
-- roster assembled before an edit, and the people on it were deleted and
-- not put back. Correcting the caller left the hazard in place for every
-- other caller and every future one.
--
-- And between the delete and the insert there is a window. A failure there,
-- or a connection dropped at a site with no signal, leaves the project with
-- no members at all and nothing to say so.
--
-- Doing it here makes it one statement: rows that should go, go; rows that
-- should arrive, arrive; rows already correct are not touched, so
-- `assigned_at` keeps saying when somebody actually joined the site rather
-- than when the roster was last saved.

create or replace function public.set_project_members(p_project uuid, p_users uuid[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  org      uuid;
  wanted   uuid[] := coalesce(p_users, '{}'::uuid[]);
  stranger uuid;
  added    int;
  removed  int;
begin
  select org_id into org from public.projects where id = p_project;
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
    returning 1
  )
  select (select count(*) from gone), (select count(*) from fresh)
    into removed, added;

  return jsonb_build_object('added', added, 'removed', removed);
end $$;

comment on function public.set_project_members(uuid, uuid[]) is
  'Set a project''s roster to exactly these people, as one statement. '
  'Adds what is missing, removes what is no longer wanted, leaves the rest '
  'alone. Caller must administer the project''s company.';

revoke all on function public.set_project_members(uuid, uuid[]) from public;
grant execute on function public.set_project_members(uuid, uuid[]) to authenticated, service_role;
