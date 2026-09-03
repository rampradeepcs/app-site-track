-- Sign in with Google or Outlook, and the record is kept current.
--
-- A single sign-on hands over more than an address: a display name, a
-- photograph, sometimes a number, and the fact that the provider vouches for
-- the address. None of it reached the worker record. Onboarding copied the
-- name into the form once; after that the record and the identity drifted,
-- and nothing recorded whether the person had ever actually signed in — the
-- register showed an invited worker and a working one identically.
--
-- So the record is now brought up to date from the identity, every time,
-- server-side, by a trigger on auth.users. GoTrue updates that row on every
-- sign-in (last_sign_in_at, and the provider's metadata for OAuth), which is
-- exactly the moment the profile is freshest. Doing it in the database rather
-- than the app means every client — the phone, the web, a future one — gets
-- the same behaviour without being asked, and a stale build cannot skip it.
--
-- What is taken, and what is not:
--   * name and phone fill in only when the record has none. An administrator
--     who typed a name chose it; the provider's version is kept alongside in
--     auth_profile, not written over it.
--   * the photograph is taken whenever the record's photo is empty or is the
--     one a previous sync set — never over one somebody uploaded.
--   * auth_provider is the identity that most recently vouched for the
--     account; email_verified and last_sign_in_at mirror the identity row.
--
-- The same routine also does what claim_user_record did — link an unclaimed
-- record bearing the confirmed address — so a first sign-in links and fills
-- in one step, and a sign-in that reaches the app through any path ends the
-- same way.

alter table public.users
  add column if not exists auth_provider   text,
  add column if not exists auth_profile    jsonb,
  add column if not exists email_verified  boolean not null default false,
  add column if not exists last_sign_in_at timestamptz;

comment on column public.users.auth_provider is
  'Identity provider that most recently vouched for this account: google, azure or email.';
comment on column public.users.auth_profile is
  'What the identity provider last said about this person (name, avatar, phone, providers). Informational; the columns beside it are the record.';
comment on column public.users.email_verified is
  'Mirrors auth.users.email_confirmed_at: the provider has confirmed the address.';
comment on column public.users.last_sign_in_at is
  'Mirrors auth.users.last_sign_in_at. Null for a worker who has been invited but never signed in.';

-- ------------------------------------------------------------ the sync ----
create or replace function private.sync_user_from_auth(target uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
begin
  if target is null then
    return null;
  end if;

  select * into a from auth.users where id = target;
  if not found then
    return null;
  end if;

  meta    := coalesce(a.raw_user_meta_data, '{}'::jsonb);
  app     := coalesce(a.raw_app_meta_data,  '{}'::jsonb);
  p_email := lower(nullif(btrim(coalesce(a.email, '')), ''));

  -- Providers disagree on the key: Google sends full_name, Azure tends to
  -- send name. First one that is actually a name wins; an address is not one.
  select btrim(v) into p_name
    from unnest(array[meta->>'full_name', meta->>'name',
                      meta->>'display_name', meta->>'preferred_username'])
         with ordinality as t(v, n)
   where btrim(coalesce(v, '')) <> ''
     and v not like '%@%'
   order by n
   limit 1;

  p_avatar := coalesce(nullif(meta->>'avatar_url', ''), nullif(meta->>'picture', ''));
  p_phone  := coalesce(nullif(a.phone, ''), nullif(meta->>'phone', ''),
                       nullif(meta->>'phone_number', ''));

  -- The identity that vouched most recently. GoTrue stamps the identity row
  -- on each OAuth sign-in, so this follows the button the person pressed.
  select i.provider into p_provider
    from auth.identities i
   where i.user_id = a.id
   order by i.last_sign_in_at desc nulls last, i.created_at desc
   limit 1;
  p_provider := coalesce(p_provider, app->>'provider');

  -- Linked already, or claimable: an unclaimed record bearing the confirmed
  -- address. An unconfirmed address is not evidence of anything, and a linked
  -- record can never be taken over.
  select id into matched from public.users where auth_id = a.id limit 1;
  if matched is null and p_email is not null and a.email_confirmed_at is not null then
    update public.users
       set auth_id = a.id
     where id = (
       select id from public.users
        where auth_id is null and lower(email) = p_email
        order by joined_at
        limit 1)
    returning id into matched;
  end if;
  if matched is null then
    return null;
  end if;

  update public.users u
     set name  = case when btrim(u.name) = '' and p_name is not null
                      then p_name else u.name end,
         phone = case when coalesce(btrim(u.phone), '') = '' and p_phone is not null
                      then p_phone else u.phone end,
         photo = case when p_avatar is not null
                       and (u.photo is null or u.photo = u.auth_profile->>'avatar_url')
                      then p_avatar else u.photo end,
         auth_provider   = coalesce(p_provider, u.auth_provider),
         email_verified  = a.email_confirmed_at is not null,
         last_sign_in_at = a.last_sign_in_at,
         auth_profile    = jsonb_strip_nulls(jsonb_build_object(
                             'name',        p_name,
                             'email',       p_email,
                             'avatar_url',  p_avatar,
                             'phone',       p_phone,
                             'provider',    p_provider,
                             'providers',   app->'providers',
                             'provider_id', meta->>'provider_id',
                             'synced_at',   now()))
   where u.id = matched;

  return matched;
end $$;

-- Supabase grants anon and authenticated execute on new functions by
-- default, directly rather than through PUBLIC, so each is revoked by name.
revoke all on function private.sync_user_from_auth(uuid) from public, anon, authenticated;

comment on function private.sync_user_from_auth(uuid) is
  'Links (if needed) and refreshes the users row for an auth identity from what the provider said. Returns the row id, or null when there is no record for this person.';

-- ---------------------------------------------------- on every sign-in ----
-- Runs inside GoTrue's own transaction, so it must never raise: a failure
-- here would refuse the sign-in itself over a profile detail.
create or replace function public.sync_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_user_from_auth(new.id);
  return new;
exception when others then
  raise warning 'sync_auth_user(%): % [%]', new.id, sqlerrm, sqlstate;
  return new;
end $$;

revoke all on function public.sync_auth_user() from public, anon, authenticated;
grant execute on function public.sync_auth_user() to supabase_auth_admin;

drop trigger if exists on_auth_user_synced on auth.users;
create trigger on_auth_user_synced
  after insert or update of last_sign_in_at, raw_user_meta_data, raw_app_meta_data,
                            email, phone, email_confirmed_at
  on auth.users
  for each row execute function public.sync_auth_user();

-- --------------------------------------------------------- for the app ----
-- One call that links, refreshes and reads back the caller's own record, so
-- the app has a fresh copy the moment it needs one — including right after
-- provisioning a company, when the founder's row is minutes younger than
-- their sign-in and the trigger has already been and gone.
create or replace function public.sync_my_profile()
returns setof public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  target := private.sync_user_from_auth(auth.uid());
  if target is null then
    return;
  end if;
  return query select * from public.users where id = target;
end $$;

revoke all on function public.sync_my_profile() from public, anon;
grant execute on function public.sync_my_profile() to authenticated;

comment on function public.sync_my_profile() is
  'Links and refreshes the caller''s users row from their identity provider and returns it. Empty when the caller belongs to no organisation.';

-- claim_user_record keeps its contract for clients already in the field; it
-- is now the same routine.
create or replace function public.claim_user_record()
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.sync_user_from_auth(auth.uid());
$$;

revoke all on function public.claim_user_record() from public, anon;
grant execute on function public.claim_user_record() to authenticated;

-- ---------------------------------------------------------- everyone ----
-- Bring every existing record up to date with what its identity already
-- says, so the change is not something only new sign-ins benefit from.
do $$
declare r record;
begin
  for r in select id from auth.users loop
    perform private.sync_user_from_auth(r.id);
  end loop;
end $$;
