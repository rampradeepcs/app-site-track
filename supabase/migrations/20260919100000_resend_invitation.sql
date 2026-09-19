-- ============================================================================
-- Send that invitation again.
--
-- An invitation is a row in company_invitations and a letter sent by the
-- invite-crew function, and only the row is durable. If the letter does not
-- arrive — a typo caught too late, a spam folder, a provider having a bad
-- afternoon — there was nothing to do about it. Cancelling and re-inviting
-- worked, but it is a strange thing to ask somebody to do, and it loses who
-- invited them and when.
--
-- Two things this does that the client could not do for itself:
--
--   * Refresh the expiry. An invitation lasts 30 days from when it was made,
--     not from when it was last sent. Resending on day 29 would otherwise post
--     a letter with a day left on it, which is worse than not resending.
--
--   * Record it. last_sent_at is what lets the screen say when the last letter
--     went, so an administrator who is not sure whether they already pressed it
--     can see rather than guess — and does not send a third.
--
-- Sending the letter itself stays in the edge function, which owns the Resend
-- key and the wording. This prepares the row and hands back the address; the
-- client asks invite-crew to write to it.
-- ============================================================================

-- When the last letter went. Null on rows that predate this, which the screen
-- reads as "we do not know", not as "never" — those were all sent at creation.
alter table company_invitations add column if not exists last_sent_at timestamptz;

create or replace function public.resend_invitation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  me  public.users%rowtype;
  inv public.company_invitations%rowtype;
  org uuid := private.active_org_id();
begin
  if org is null or not private.is_org_admin() then
    raise exception 'only a company administrator or manager may resend an invitation'
      using errcode = '42501';
  end if;
  select * into me from public.users where id = private.auth_user_id();

  -- Scoped to the caller's own company in the lookup rather than checked after:
  -- an id from another company should be indistinguishable from one that does
  -- not exist, or the error message becomes a way to probe for them.
  select * into inv from public.company_invitations
   where id = p_id and org_id = org;
  if not found then
    raise exception 'no such invitation' using errcode = '22023';
  end if;

  -- Accepted and declined are answers. Resending an answered invitation would
  -- invite somebody who is already in, or pester somebody who said no.
  if inv.status not in ('pending', 'expired') then
    raise exception 'that invitation was already %', inv.status using errcode = '22023';
  end if;

  -- A manager may only have invited an employee, and may only resend one.
  if me.role = 'manager' and inv.role <> 'employee' then
    raise exception 'a manager may resend employee invitations only' using errcode = '42501';
  end if;

  update public.company_invitations
     set status       = 'pending',
         expires_at   = now() + interval '30 days',
         last_sent_at = now()
   where id = inv.id;

  insert into public.audit_log (org_id, actor_id, action, target, detail)
  values (org, me.id, 'member.invite.resend', inv.email,
          me.name || ' sent the invitation to '
          || coalesce(nullif(inv.name, ''), inv.email) || ' again');

  -- Deliberately quieter than invite_member, which tells the other
  -- administrators an invitation exists. They know; this is the same one.
  return jsonb_build_object(
    'id',        inv.id,
    'email',     inv.email,
    'name',      inv.name,
    'role',      inv.role,
    'expiresAt', now() + interval '30 days');
end $function$;

grant execute on function public.resend_invitation(uuid) to authenticated, service_role;


-- ---------------------------------------------- the list it is pressed from ----
-- Two changes, and the second is the one that matters.
--
-- last_sent_at so the screen can say when the last letter went, rather than
-- leaving an administrator to guess whether they already pressed it.
--
-- And expired invitations are no longer hidden. The filter was
-- `expires_at > now()`, so an invitation that lapsed unanswered vanished from
-- the only screen that could do anything about it — which is precisely the
-- case this feature exists for: the letter never arrived, nobody acted, thirty
-- days passed. They come back, flagged, and resending revives them. Nothing
-- flips status to 'expired' on a schedule, so `expired` is computed from the
-- date rather than read from the column.
--
-- The return type changes, so this is a drop and create rather than a replace.
drop function if exists public.company_invitations_pending();

create or replace function public.company_invitations_pending()
returns table(
  id uuid, email text, name text, role app_role, designation text, department text,
  project text, invited_by text, created_at timestamptz, expires_at timestamptz,
  last_sent_at timestamptz, expired boolean, has_membership boolean)
language sql
stable security definer
set search_path to ''
as $function$
  select i.id, i.email, i.name, i.role, i.designation, i.department, p.name, b.name,
         i.created_at, i.expires_at, i.last_sent_at,
         i.expires_at <= now(),
         exists (select 1 from public.users u
                  where u.org_id = i.org_id and lower(u.email) = lower(i.email))
    from public.company_invitations i
    left join public.projects p on p.id = i.project_id
    left join public.users b on b.id = i.invited_by
   where i.org_id = private.active_org_id()
     and private.is_org_admin()
     and i.status = 'pending'
   -- Lapsed ones first: they are the ones needing a decision.
   order by (i.expires_at <= now()) desc, i.created_at desc
$function$;

grant execute on function public.company_invitations_pending() to authenticated, service_role;
