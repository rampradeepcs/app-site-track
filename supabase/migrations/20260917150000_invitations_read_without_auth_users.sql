-- Let an admin read their company's pending invitations again.
--
-- `invitations_read` asked whether the caller's own confirmed address matched
-- the invitation, and answered it by selecting from auth.users. The
-- `authenticated` role has no SELECT there, so evaluating the policy raised
--
--   42501: permission denied for table users
--
-- rather than returning no rows. PostgREST passed the error up, invite-crew
-- turned it into a 400, and the app told the inviter their colleague "was
-- added, but the invitation email could not be sent" — which was true, and
-- said nothing about why.
--
-- The branch itself is the one that lets an invited person see the invitation
-- addressed to them, so it has to stay. It moves behind a SECURITY DEFINER
-- helper, which is how every other identity question in this schema is already
-- answered: is_superadmin, auth_org_id, is_org_admin. Nothing about who may
-- read what changes.

create or replace function private.auth_email()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  -- Confirmed addresses only. An unverified address must not match an
  -- invitation, or anybody could sign up as somebody else and read theirs.
  select lower(a.email::text)
  from auth.users a
  where a.id = auth.uid()
    and a.email_confirmed_at is not null
$$;

comment on function private.auth_email() is
  'The signed-in caller''s confirmed email, lowercased. Exists so RLS can ask '
  'the question without granting SELECT on auth.users to every logged-in role.';

revoke all on function private.auth_email() from public;
grant execute on function private.auth_email() to authenticated, service_role;

drop policy if exists invitations_read on public.company_invitations;

create policy invitations_read on public.company_invitations
for select
using (
  (select private.is_superadmin())
  or invited_user_id = auth.uid()
  or lower(email) = (select private.auth_email())
  or (
    org_id = (select private.auth_org_id())
    and (select private.is_org_admin())
  )
);
