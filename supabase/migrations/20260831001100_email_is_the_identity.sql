-- ============================================================================
-- Email becomes the identity; phone becomes contact detail.
--
-- The product signed people in by mobile number, on the reasoning that a site
-- labourer is likelier to have a number than a work email. That has been
-- reversed deliberately: sign-in is now email, including Google and Outlook,
-- and the address is the unique key across an organisation.
--
-- Two consequences the database has to reflect:
--
--   * The auth-linking trigger preferred a phone match over an email one.
--     With email as the identity that precedence is now backwards — a person
--     signing in with Google presents an email and nothing else, and the
--     phone branch would only ever fire on a stale number that happens to
--     collide.
--   * `users.email` was nullable and unconstrained. An identity you can sign
--     in with cannot be optional, and two people cannot share one, or a
--     sign-in resolves to an ambiguous row rather than a person.
-- ============================================================================

-- ---------------------------------------------------- backfill first ------
-- Nobody may be left without an identity, and a placeholder that is obviously
-- a placeholder is better than a null: it is visible in the roster, it is
-- unique, and an administrator can correct it in the employee editor.
update users
set email = lower(
      regexp_replace(coalesce(nullif(trim(name), ''), 'user'), '[^a-zA-Z0-9]+', '.', 'g')
    ) || '.' || substr(id::text, 1, 8) || '@placeholder.workfence.app'
where email is null or trim(email) = '';

-- Two rows sharing an address is an ambiguous login, so disambiguate any that
-- already exist before the constraint goes on.
with dupes as (
  select id,
         row_number() over (partition by org_id, lower(email) order by created_at, id) as n
  from users
)
update users u
set email = regexp_replace(u.email, '@', '+' || d.n::text || '@')
from dupes d
where u.id = d.id and d.n > 1;

alter table users alter column email set not null;

-- Unique per tenant rather than globally: two organisations may legitimately
-- both employ someone reachable at the same shared address, and refusing that
-- would be the database inventing a rule the business does not have.
create unique index if not exists users_email_per_org_unique
  on users (org_id, lower(email));

-- Phone is no longer an identity, so it stops being required.
alter table users alter column phone drop not null;

-- ------------------------------------------------ linking precedence ------
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
      (raw_email is not null and lower(u.email) = lower(raw_email))
      or (raw_phone is not null and phones_match(u.phone, raw_phone))
    )
  order by
    -- Email first now: it is what a person signs in with, and a single
    -- sign-on presents nothing else. Phone remains as a fallback for
    -- accounts enrolled before the change.
    case when raw_email is not null and lower(u.email) = lower(raw_email)
      then 0 else 1 end
  limit 1;

  if matched_id is not null then
    update users set auth_id = new.id where id = matched_id;
  end if;

  return new;
end;
$$;
