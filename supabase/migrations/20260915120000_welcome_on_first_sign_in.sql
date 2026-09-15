-- A person is welcomed into a company once, on the first sign-in that
-- follows their invitation.
--
-- The flag sits on the membership row rather than on the profile, because
-- somebody can belong to several companies: being welcomed into one says
-- nothing about the next, and a second company deserves its own greeting.
alter table public.users
  add column if not exists welcomed_at timestamptz;

comment on column public.users.welcomed_at is
  'When this person was welcomed into this company. Null means never; the app claims it on their first sign-in.';

-- Anyone already signed in has long since arrived. Welcoming them now would
-- greet a stranger who has been here for weeks, so they start as welcomed and
-- only genuinely new members see it.
update public.users
   set welcomed_at = now()
 where welcomed_at is null
   and last_sign_in_at is not null;

/*
 * Claim the welcome: says whether one is due, names the company, and stamps
 * the row in the same statement.
 *
 * One call rather than a read and a write, because two calls race. A person
 * who opens the app on a phone and a laptop in the same minute would pass
 * the read on both and be welcomed twice; here the UPDATE ... RETURNING is
 * the claim, and only one of them gets a row back.
 *
 * Stamping on claim rather than on dismissal is deliberate. It can cost
 * somebody the greeting if the app dies between the two, which is a far
 * smaller harm than greeting them again every morning because they never
 * tapped the button.
 *
 * Naming a company is not a way into it: active_org_id() honours the header
 * only for somebody who is a live member of what it names.
 */
create or replace function public.claim_welcome()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  org_id_v  uuid := private.active_org_id();
  claimed   uuid;
  org_name  text;
  site_name text;
  me_name   text;
  me_role   public.app_role;
begin
  if org_id_v is null then
    return jsonb_build_object('due', false);
  end if;

  update public.users u
     set welcomed_at = now()
   where u.auth_id = auth.uid()
     and u.org_id = org_id_v
     and u.welcomed_at is null
     and u.status not in ('inactive', 'revoked')
  returning u.id, u.name, u.role into claimed, me_name, me_role;

  if claimed is null then
    return jsonb_build_object('due', false);
  end if;

  select o.name into org_name
    from public.organizations o where o.id = org_id_v;

  -- Their first site, when they have been put on one: a greeting that names
  -- the gate they will actually stand at says more than the company alone.
  select p.name into site_name
    from public.projects p
   where p.org_id = org_id_v
   order by p.created_at
   limit 1;

  return jsonb_build_object(
    'due', true,
    'company', coalesce(org_name, ''),
    'site', coalesce(site_name, ''),
    'name', coalesce(me_name, ''),
    'role', me_role::text
  );
end $$;

revoke all on function public.claim_welcome() from public, anon;
grant execute on function public.claim_welcome() to authenticated;
