-- ============================================================================
-- Match an auth identity to its user record on the national number, not the
-- exact digit string.
--
-- The original rule compared every digit, which quietly required whoever
-- enrolled a worker to have typed the country code. They often have not:
-- self-serve signup invites a crew straight from the phone's contacts, where
-- a number is as likely to be stored "9000022222" as "+91 90000 22222".
--
-- The failure was silent and bad. The worker signs in successfully, matches
-- nothing, has auth_id null, resolves to no organisation — and, now that a
-- company can create itself, is offered the signup wizard and ends up as the
-- sole member of a second empty tenant instead of on their crew's site.
--
-- So: exact digits still match, and failing that the last ten digits do, which
-- is the national number in every plan the app is used in. Ten rather than
-- nine because nine invites collisions between genuinely different people for
-- no extra reach.
-- ============================================================================

create or replace function link_auth_identity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  matched_id uuid;
  raw_phone  text := nullif(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '');
  raw_email  text := nullif(new.email, '');
begin
  select u.id into matched_id
  from users u
  where u.auth_id is null
    and (
      (raw_phone is not null and phones_match(u.phone, raw_phone))
      or (raw_email is not null and lower(u.email) = lower(raw_email))
    )
  order by
    -- Prefer a phone match; email is the weaker signal.
    case when raw_phone is not null and phones_match(u.phone, raw_phone)
      then 0 else 1 end
  limit 1;

  if matched_id is not null then
    update users set auth_id = new.id where id = matched_id;
  end if;

  return new;
end $$;

/**
 * Whether two phone numbers, written however their owner writes them, are the
 * same line. Immutable so it can be used in an index if the users table ever
 * grows past the point where a sequential scan on sign-in is acceptable.
 */
create or replace function phones_match(a text, b text)
returns boolean
language sql immutable
set search_path = public
as $$
  with d as (
    select regexp_replace(coalesce(a, ''), '\D', '', 'g') as x,
           regexp_replace(coalesce(b, ''), '\D', '', 'g') as y
  )
  select x <> '' and y <> ''
     and (x = y or (length(x) >= 10 and length(y) >= 10
                    and right(x, 10) = right(y, 10)))
  from d
$$;
