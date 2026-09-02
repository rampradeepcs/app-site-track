-- Refuse a site with no location, however the JSON says so.
--
-- The guard tested `site->'location' is null`, which catches an absent key
-- and not a present one whose value is JSON null — jsonb null is a value.
-- The wizard sends the payload as one JSON document, so a site without
-- coordinates arrived as exactly that, passed the check, and produced a
-- project with location NULL and a circular geofence with no centre. The
-- company, the subscription and the crew were all created around a site
-- nobody could check in to.
--
-- Only the guard changes.

create or replace function public.provision_company(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller      uuid := auth.uid();
  settings    jsonb;
  new_org     uuid;
  new_admin   uuid;
  new_site    uuid;
  new_office  uuid;
  company     text := btrim(coalesce(payload->>'company', ''));
  admin_name  text := btrim(coalesce(payload#>>'{admin,name}', ''));
  admin_phone text := btrim(coalesce(payload#>>'{admin,phone}', ''));
  admin_email text := nullif(btrim(coalesce(payload#>>'{admin,email}', '')), '');
  stem        text;
  chosen_plan text;
  trial_days  int;
  site        jsonb := payload->'site';
  office      jsonb := payload->'office';
  member      jsonb;
  seq         int := 1;
begin
  if caller is null then
    raise exception 'sign in before creating a company'
      using errcode = '28000';
  end if;

  if exists (select 1 from users where auth_id = caller) then
    raise exception 'this account already belongs to an organisation'
      using errcode = '23505';
  end if;

  -- jsonb_typeof, not "is null": the wizard sends the whole payload as JSON,
  -- and a missing location arrives as the jsonb value null, which is not SQL
  -- NULL and passes an "is null" test. A company created that way got a site
  -- with no centre to its geofence — attendance happens inside a boundary, so
  -- nobody on it could ever check in, and the founder had no way to tell.
  if company = '' or admin_name = ''
     or site is null or jsonb_typeof(site) <> 'object'
     or jsonb_typeof(site->'location') <> 'object'
     or (site#>>'{location,lat}') is null
     or (site#>>'{location,lng}') is null then
    raise exception 'company, your name and a first site with a location are all required'
      using errcode = '22023';
  end if;

  select ps.settings into settings from platform_settings ps where ps.id = 1;
  settings := coalesce(settings, '{}'::jsonb);

  if coalesce((settings->>'signupsEnabled')::boolean, true) is not true then
    raise exception 'signups are closed' using errcode = '42501';
  end if;

  -- Fall back to the cheapest live plan when no default is configured, rather
  -- than failing a signup over a setting nobody filled in.
  chosen_plan := settings->>'defaultPlanId';
  if chosen_plan is null or not exists (select 1 from plans where id = chosen_plan) then
    select id into chosen_plan
      from plans where not archived order by monthly_price asc limit 1;
  end if;
  if chosen_plan is null then
    raise exception 'no plan is available to sign up on' using errcode = '42704';
  end if;
  trial_days := greatest(coalesce((settings->>'defaultTrialDays')::int, 14), 0);

  -- Initials for codes: "Nachi Tekneka" -> "NT". Matches src/lib/store.tsx.
  stem := upper(regexp_replace(
            substring(regexp_replace(company, '(\S)\S*\s*', '\1', 'g') from 1 for 3),
            '[^A-Za-z]', '', 'g'));
  if stem = '' then stem := 'WF'; end if;

  insert into organizations (name, code, industry, contact_name, contact_email,
                             contact_phone, country, timezone, status, billing, branding)
  values (
    company,
    -- organizations.code is unique; the tail of a fresh uuid is what makes
    -- two companies with the same initials land on different codes.
    stem || '-' || upper(right(gen_random_uuid()::text, 4)),
    coalesce(payload->>'industry', 'Construction'),
    admin_name, coalesce(admin_email, ''), admin_phone,
    coalesce(payload->>'country', ''),
    coalesce(payload->>'timezone', 'Asia/Kolkata'),
    case when trial_days > 0 then 'trial' else 'active' end::org_status,
    jsonb_build_object(
      'legalName', company, 'contactName', admin_name,
      'email', coalesce(admin_email, ''), 'phone', admin_phone,
      'addressLine','', 'city','', 'state','', 'postcode','', 'country','',
      'taxIdLabel','GSTIN', 'taxId','', 'taxPercent', 18,
      'currency','INR', 'paymentMethod',''),
    jsonb_build_object('appName','Workfence','accent','#f6a723','logoText', left(stem, 2))
  )
  returning id into new_org;

  insert into subscriptions (org_id, plan_id, status, cycle, trial_ends_at, renews_at)
  values (new_org, chosen_plan,
          case when trial_days > 0 then 'trial' else 'active' end::sub_status,
          'monthly',
          case when trial_days > 0 then now() + make_interval(days => trial_days) end,
          now() + make_interval(days => greatest(trial_days, 30)));

  -- The founder is the admin, and is linked to the calling identity here
  -- rather than by the auth trigger: that trigger runs on identity creation,
  -- which already happened, and matches rows that exist, which this did not.
  insert into users (auth_id, org_id, name, employee_code, role, designation,
                     department, phone, email, avatar_hue, status,
                     shift_start, shift_end)
  values (caller, new_org, admin_name, stem || '-0001', 'admin',
          'Client Administrator', 'Management', admin_phone, admin_email,
          200, 'active', 540, 1080)
  returning id into new_admin;

  new_site := provision_premise(new_org, new_admin, company, site, 'site',
    coalesce(site->>'trackingMode', 'full-shift')::tracking_mode,
    stem || '-S01',
    'Your first site. Redraw the boundary and add zones from Projects.');

  if office is not null and jsonb_typeof(office) = 'object' then
    new_office := provision_premise(new_org, new_admin, company, office, 'office',
      'full-shift'::tracking_mode, stem || '-HO1',
      'Office premise. Crews working away from a site can start and end the day here.');
  end if;

  for member in select * from jsonb_array_elements(coalesce(payload->'crew', '[]'::jsonb))
  loop
    -- A crew member without an address cannot be one: users.email is NOT NULL
    -- because the address is what they sign in with. Skip them rather than
    -- abort, so one bad row cannot cost the founder the whole company.
    continue when btrim(coalesce(member->>'name', '')) = ''
               or btrim(coalesce(member->>'email', '')) = '';
    seq := seq + 1;
    insert into users (org_id, name, employee_code, role, designation, department,
                       phone, email, avatar_hue, status, shift_start, shift_end)
    values (new_org, btrim(member->>'name'),
            stem || '-' || lpad(seq::text, 4, '0'), 'employee',
            coalesce(nullif(btrim(coalesce(member->>'designation','')), ''), 'Worker'),
            'Site', nullif(btrim(coalesce(member->>'phone','')), ''),
            lower(btrim(member->>'email')),
            (hashtext(coalesce(member->>'name','')) % 360 + 360) % 360,
            'active', 540, 1080);
  end loop;

  -- Everyone in a new tenant is on every premise: a crew that cannot check in
  -- anywhere is the same dead end as no crew at all, and narrowing it later
  -- from Projects is one tap.
  insert into project_members (project_id, user_id, org_id)
  select p.id, u.id, new_org
    from projects p cross join users u
   where p.org_id = new_org and u.org_id = new_org
  on conflict do nothing;

  insert into platform_audit (actor_id, actor_name, org_id, action, target, new_value, detail)
  values (new_admin, admin_name, new_org, 'client.create', company,
          chosen_plan || ' (monthly)',
          'Self-serve signup: ' ||
          (case when new_office is null then '1 premise' else '2 premises' end) ||
          ', ' || (seq - 1) || ' invited');

  return jsonb_build_object('orgId', new_org, 'userId', new_admin,
                            'siteId', new_site, 'officeId', new_office);
end $$;
