-- ============================================================================
-- Catch-up: provision_client and the two helpers it stands on.
--
-- These objects have been in the live database for some time and in no
-- migration, so `supabase db reset` — and any fresh project, CI database or
-- staging copy built from this tree — came out without them, and the console's
-- "Onboard client" wizard would fail there while working in production. This
-- file is the live definitions, captured with pg_get_functiondef and replayed
-- verbatim, so the tree describes the database again.
--
-- It is deliberately NOT a rewrite. An earlier attempt here was a fresh
-- implementation of provision_client, which would have been a create-or-replace
-- over the live one and would have quietly dropped its subdomain rules — the
-- reserved-name list, the length and shape check, the collision retry. When the
-- repository and the database disagree, the database is the one with users on
-- it; the repository is what needs correcting.
--
-- Everything here is idempotent, so it is a no-op against production and a
-- repair everywhere else.
-- ============================================================================

-- ------------------------------------------------------------- slugify ----
-- A company name to the label its subdomain is built from. IMMUTABLE and
-- search_path '' because it is called from indexes and from SECURITY DEFINER
-- functions, neither of which may depend on the caller's schema resolution.
create or replace function public.slugify(input text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'))
$function$;

-- ------------------------------------------------- private.is_superadmin ----
-- The same question public.is_superadmin() answers, in the private schema the
-- RLS policies use. Both exist live; this one is referenced by provision_client
-- and by later policies, and only the public one was ever committed.
create schema if not exists private;

create or replace function private.is_superadmin()
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (select 1 from public.users where auth_id = auth.uid() and role = 'superadmin')
$function$;

-- ------------------------------------------------- organizations.slug ----
-- Live: text, NOT NULL, with a unique index. Added in three steps so a
-- database that already has rows gets a slug for each of them before the
-- constraint lands, rather than failing the migration on existing data.
alter table organizations add column if not exists slug text;

update organizations
   set slug = coalesce(
         nullif(trim(both '-' from left(slugify(name), 30)), ''),
         'co-' || lower(right(id::text, 6)))
 where slug is null;

-- Two companies called the same thing would collide on the index below.
with dupes as (
  select id,
         row_number() over (partition by slug order by created_at, id) as n
    from organizations
)
update organizations o
   set slug = left(o.slug, 23) || '-' || lower(right(o.id::text, 6))
  from dupes d
 where d.id = o.id and d.n > 1;

do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'organizations'
       and indexdef ilike 'CREATE UNIQUE%' and indexdef ilike '%(slug)%'
  ) then
    create unique index organizations_slug_unique on public.organizations (slug);
  end if;
end $$;

alter table organizations alter column slug set not null;

-- A slug becomes a hostname, so the database states the rule rather than
-- trusting every writer to. Same pattern and same reserved list that
-- provision_client checks, enforced for anything that writes the column.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_slug_format') then
    alter table organizations add constraint organizations_slug_format
      check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$'
             and slug <> all (array['www','app','api','admin','platform','mail',
                                    'static','assets','cdn','auth','login']));
  end if;
end $$;

-- ------------------------------------------------------ provision_client ----
-- The platform owner creates a client whole: organisation, subscription, and an
-- administrator row with auth_id null, which the person named claims by email
-- at their first sign-in.
create or replace function public.provision_client(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor          users%rowtype;
  new_org        uuid;
  new_admin      uuid;
  new_sub        uuid;
  company        text := btrim(coalesce(payload->>'name', ''));
  requested_code text := nullif(btrim(coalesce(payload->>'code', '')), '');
  requested_slug text := nullif(lower(btrim(coalesce(payload->>'slug', ''))), '');
  admin_name     text := btrim(coalesce(payload#>>'{admin,name}', ''));
  admin_email    text := lower(nullif(btrim(coalesce(payload#>>'{admin,email}', '')), ''));
  admin_phone    text := btrim(coalesce(payload#>>'{admin,phone}', ''));
  admin_role     text := coalesce(nullif(btrim(coalesce(payload#>>'{admin,role}', '')), ''), 'Client Administrator');
  plan_id        text := payload->>'planId';
  cycle          text := coalesce(payload->>'cycle', 'monthly');
  trial_days     int  := greatest(coalesce((payload->>'trialDays')::int, 0), 0);
  stem           text;
  new_code       text;
  new_slug       text;
begin
  if not private.is_superadmin() then
    raise exception 'only the platform owner may create clients' using errcode = '42501';
  end if;
  if company = '' or admin_name = '' or admin_email is null then
    raise exception 'company, administrator name and administrator email are required'
      using errcode = '22023';
  end if;
  if plan_id is null or not exists (select 1 from plans where id = plan_id) then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  if cycle not in ('monthly', 'annual') then
    raise exception 'cycle must be monthly or annual' using errcode = '22023';
  end if;

  select * into actor from users where auth_id = auth.uid() limit 1;

  -- Initials for codes, as provision_company does: "Nachi Tekneka" -> "NT".
  stem := upper(regexp_replace(
            substring(regexp_replace(company, '(\S)\S*\s*', '\1', 'g') from 1 for 3),
            '[^A-Za-z]', '', 'g'));
  if stem = '' then stem := 'WF'; end if;

  new_code := coalesce(requested_code, stem || '-' || upper(right(gen_random_uuid()::text, 4)));
  while exists (select 1 from organizations where code = new_code) loop
    new_code := stem || '-' || upper(right(gen_random_uuid()::text, 4));
  end loop;

  new_slug := coalesce(requested_slug, nullif(trim(both '-' from left(slugify(company), 30)), ''));
  if new_slug is null
     or new_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$'
     or new_slug in ('www', 'app', 'api', 'admin', 'platform', 'mail', 'static', 'assets', 'cdn', 'auth', 'login') then
    if requested_slug is not null then
      raise exception 'that subdomain is not allowed' using errcode = '22023';
    end if;
    new_slug := 'co-' || lower(right(gen_random_uuid()::text, 6));
  end if;
  if requested_slug is not null and exists (select 1 from organizations where slug = new_slug) then
    raise exception 'that subdomain is already taken' using errcode = '23505';
  end if;
  while exists (select 1 from organizations where slug = new_slug) loop
    new_slug := left(new_slug, 23) || '-' || lower(right(gen_random_uuid()::text, 6));
  end loop;

  insert into organizations (name, code, slug, industry, website, contact_name, contact_email,
                             contact_phone, country, timezone, status, billing, branding)
  values (
    company, new_code, new_slug,
    coalesce(nullif(payload->>'industry', ''), 'Construction'),
    coalesce(payload->>'website', ''),
    coalesce(nullif(payload->>'contactName', ''), admin_name),
    coalesce(nullif(payload->>'contactEmail', ''), admin_email),
    coalesce(payload->>'contactPhone', ''),
    coalesce(payload->>'country', ''),
    coalesce(nullif(payload->>'timezone', ''), 'Asia/Kolkata'),
    (case when trial_days > 0 then 'trial' else 'active' end)::org_status,
    coalesce(payload->'billing', jsonb_build_object(
      'legalName', company, 'contactName', admin_name, 'email', admin_email,
      'phone', admin_phone, 'addressLine', '', 'city', '', 'state', '', 'postcode', '',
      'country', coalesce(payload->>'country', ''), 'taxIdLabel', 'GSTIN', 'taxId', '',
      'taxPercent', 18, 'currency', 'INR', 'paymentMethod', '')),
    coalesce(payload->'branding', jsonb_build_object(
      'appName', 'Workfence', 'accent', '#000000', 'logoText', left(stem, 2)))
  )
  returning id into new_org;

  insert into subscriptions (org_id, plan_id, status, cycle, trial_ends_at, renews_at,
                             limit_overrides, feature_overrides)
  values (
    new_org, plan_id,
    (case when trial_days > 0 then 'trial' else 'active' end)::sub_status,
    cycle::billing_cycle,
    case when trial_days > 0 then now() + make_interval(days => trial_days) end,
    now() + make_interval(days => case when trial_days > 0 then trial_days
                                       when cycle = 'annual' then 365 else 30 end),
    coalesce(payload->'limitOverrides', '{}'::jsonb),
    coalesce(payload->'featureOverrides', '{}'::jsonb)
  )
  returning id into new_sub;

  insert into users (org_id, name, employee_code, role, designation, department,
                     phone, email, avatar_hue, status, shift_start, shift_end)
  values (new_org, admin_name, stem || '-0001', 'admin', admin_role, 'Management',
          admin_phone, admin_email, 200, 'active', 540, 1080)
  returning id into new_admin;

  insert into platform_audit (actor_id, actor_name, org_id, action, target, new_value, detail)
  values (actor.id, coalesce(actor.name, 'Platform'), new_org, 'client.create', company,
          plan_id || ' (' || cycle || ')',
          'Created from the platform console; administrator ' || admin_name || ' <' || admin_email || '>');

  return jsonb_build_object('orgId', new_org, 'userId', new_admin, 'subscriptionId', new_sub,
                            'code', new_code, 'slug', new_slug);
end $function$;

-- Callable by any signed-in identity; the function itself refuses everyone who
-- is not the platform owner. anon is never granted.
revoke all on function public.provision_client(jsonb) from public;
grant execute on function public.provision_client(jsonb) to authenticated, service_role;
grant execute on function public.slugify(text) to authenticated, service_role;
grant execute on function private.is_superadmin() to authenticated, service_role;
