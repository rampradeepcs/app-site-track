-- Let a signed-in person claim the worker record that carries their address.
--
-- on_auth_user_created already links the two, but only AFTER INSERT ON
-- auth.users — it fires once, when the account is first created. That covers
-- the invited worker who has never signed in, and nobody else. Anyone whose
-- auth account predates their invitation is never linked: they sign in
-- successfully, resolve to no worker record, and are shown the flow for
-- founding a company they are already a member of. Adding them again is not
-- a fix, because the address is unique.
--
-- So the claim is also available at sign-in, keyed on the address the token
-- was issued for.
--
-- Safety comes from three conditions, all checked here rather than trusted
-- from the caller:
--   * the address is taken from the JWT, never from an argument
--   * the address must be confirmed, so an unverified sign-up cannot claim
--     a colleague's record by registering their address
--   * only a record with auth_id IS NULL can be claimed, so a linked record
--     can never be taken over

create or replace function public.claim_user_record()
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  claimer     uuid := auth.uid();
  claim_email text;
  matched_id  uuid;
begin
  if claimer is null then
    return null;
  end if;

  -- The address as the identity provider confirmed it. An unconfirmed
  -- address is not evidence of anything.
  select lower(u.email) into claim_email
  from auth.users u
  where u.id = claimer
    and u.email is not null
    and u.email_confirmed_at is not null;

  if claim_email is null then
    return null;
  end if;

  -- Already linked: nothing to do, and say which record it is.
  select id into matched_id from public.users where auth_id = claimer limit 1;
  if matched_id is not null then
    return matched_id;
  end if;

  update public.users
     set auth_id = claimer
   where id = (
     select id from public.users
      where auth_id is null
        and lower(email) = claim_email
      order by joined_at
      limit 1
   )
  returning id into matched_id;

  return matched_id;
end;
$$;

revoke all on function public.claim_user_record() from public;
grant execute on function public.claim_user_record() to authenticated;

comment on function public.claim_user_record() is
  'Links the caller to an unclaimed users row bearing their confirmed address. Returns the row id, or null when no such row exists.';
