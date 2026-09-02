-- A worker may edit themselves, not their standing.
--
-- users_update lets somebody update their own row, which is right: their
-- name, their photo, their number are theirs. Its WITH CHECK only confirms
-- the row stays inside their own tenant, and role is not org_id — so
--
--   update users set role = 'admin' where auth_id = auth.uid()
--
-- succeeded. Any employee could make themselves an administrator of their
-- company, and an administrator reads everyone's pay, edits every record and
-- deletes people. status and employee_code went the same way: a worker could
-- mark themselves inactive to disappear from the register, or take another
-- person's code.
--
-- RLS cannot express "these columns, but not those", so the column rule goes
-- in a trigger and the row rule stays in the policy.

create or replace function public.guard_user_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No JWT: a migration, a scheduled job, or the service key. Those are
  -- trusted by other means and are not what this guard is about.
  if private.auth_uid() is null then
    return new;
  end if;

  -- An administrator changing people is the entire job. RLS has already
  -- confined them to their own tenant.
  if private.is_superadmin() or private.is_org_admin() then
    return new;
  end if;

  -- Claiming a record that carries your address is how a first sign-in
  -- links up, and it is the one case where auth_id legitimately changes
  -- under a non-admin. Nothing else may move with it.
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
end $$;

drop trigger if exists users_guard_self_update on public.users;
create trigger users_guard_self_update
  before update on public.users
  for each row execute function public.guard_user_self_update();

comment on function public.guard_user_self_update() is
  'Keeps role, status, employee_code, org_id and auth_id out of reach of a user editing their own row.';
