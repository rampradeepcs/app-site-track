-- ============================================================================
-- Linking auth identities to workforce records.
--
-- Employees are created by their manager long before they ever sign in, so a
-- new auth identity has to find its existing row rather than create a second
-- one. Matching is by phone first (site workers are enrolled by number) and
-- email second.
--
-- Without this, a worker who signs in successfully still has auth_id = null on
-- their record, every RLS policy resolves to no organisation, and the app
-- shows empty screens to someone who is legitimately signed in.
-- ============================================================================

create or replace function link_auth_identity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  matched_id uuid;
  raw_phone  text := nullif(new.phone, '');
  raw_email  text := nullif(new.email, '');
begin
  -- Compare phones on digits only: records are entered as "+91 98942 10214"
  -- but Supabase stores E.164 without punctuation.
  select u.id into matched_id
  from users u
  where u.auth_id is null
    and (
      (raw_phone is not null
        and regexp_replace(u.phone, '\D', '', 'g') =
            regexp_replace(raw_phone, '\D', '', 'g'))
      or (raw_email is not null and lower(u.email) = lower(raw_email))
    )
  order by
    -- Prefer a phone match; email is the weaker signal.
    case when raw_phone is not null
      and regexp_replace(u.phone, '\D', '', 'g') =
          regexp_replace(raw_phone, '\D', '', 'g') then 0 else 1 end
  limit 1;

  if matched_id is not null then
    update users set auth_id = new.id where id = matched_id;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_auth_identity();

-- Let a super admin attach an identity by hand — for a worker whose number
-- changed, or an invite that matched nothing.
create or replace function link_user_to_auth(target_user uuid, target_auth uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_superadmin() then
    raise exception 'only the platform owner may relink identities';
  end if;
  update users set auth_id = target_auth where id = target_user;
end $$;
