-- ============================================================================
-- Catch-up: three helpers and the signup RPC, brought up to what live runs.
--
-- These four exist in the repository already, at older definitions that
-- production has since moved past. Replaying the tree therefore produced a
-- database that looked complete and behaved differently — the worst of the
-- three failure modes, because nothing errors.
--
-- provision_company is the substantive one. The committed version refuses a
-- caller who already belongs to an organisation:
--
--     if exists (select 1 from users where auth_id = caller) then
--       raise exception 'this account already belongs to an organisation'
--
-- which is precisely the rule multi-company removed. On a replayed database
-- nobody could found a second company, and the founding wizard would fail for
-- every existing user with an error about an account they were entitled to
-- have. Live also gained the slug, which the committed version knows nothing
-- about and which is NOT NULL.
--
-- is_org_admin and is_org_owner are the public-schema forwarders, still
-- carrying their own copy of the unordered `limit 1` lookup. Pointing them at
-- the private implementations leaves one definition of who an admin is.
--
-- Captured from live with pg_get_functiondef, with ONE deliberate departure,
-- which is the only place in this whole catch-up where the repository was right
-- and production was wrong: provision_company's site-location check. Everything
-- else here takes live as authoritative. See the comment at the check itself.
--
-- Two functions are deliberately NOT captured here, although their text also
-- differs from live: set_project_members and private.auth_email. Compared with
-- comments and whitespace normalised away they are identical, and the
-- committed versions carry comments explaining why they are written as they
-- are. Replacing them with the live text would trade documentation for a hash
-- match and lose the reasoning.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provision_company(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  new_slug    text;
  chosen_plan text;
  trial_days  int;
  site        jsonb := payload->'site';
  office      jsonb := payload->'office';
  member      jsonb;
  seq         int := 1;
begin
  if caller is null then
    raise exception 'sign in before creating a company' using errcode = '28000';
  end if;
  -- jsonb_typeof, not "is null": the wizard sends the whole payload as JSON, and
  -- a missing location arrives as the jsonb value null, which is not SQL NULL and
  -- passes an "is null" test. A company created that way gets a site with no
  -- centre to its geofence — attendance happens inside a boundary, so nobody on
  -- it can ever check in, and the founder has no way to tell.
  --
  -- The committed version of this function had exactly that check, with exactly
  -- that comment. Production had drifted back to the weaker test, so capturing
  -- live verbatim would have re-enshrined the bug the comment was written about.
  -- Restored here, and applied to production along with it.
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

  chosen_plan := settings->>'defaultPlanId';
  if chosen_plan is null or not exists (select 1 from plans where id = chosen_plan) then
    select id into chosen_plan from plans where not archived order by monthly_price asc limit 1;
  end if;
  if chosen_plan is null then
    raise exception 'no plan is available to sign up on' using errcode = '42704';
  end if;
  trial_days := greatest(coalesce((settings->>'defaultTrialDays')::int, 14), 0);

  stem := upper(regexp_replace(
            substring(regexp_replace(company, '(\S)\S*\s*', '\1', 'g') from 1 for 3),
            '[^A-Za-z]', '', 'g'));
  if stem = '' then stem := 'WF'; end if;

  new_slug := nullif(trim(both '-' from left(slugify(company), 30)), '');
  if new_slug is null or new_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$'
     or new_slug in ('www', 'app', 'api', 'admin', 'platform', 'mail', 'static', 'assets', 'cdn', 'auth', 'login') then
    new_slug := 'co-' || lower(right(gen_random_uuid()::text, 6));
  end if;
  while exists (select 1 from organizations where slug = new_slug) loop
    new_slug := left(new_slug, 23) || '-' || lower(right(gen_random_uuid()::text, 6));
  end loop;

  insert into organizations (name, code, slug, industry, contact_name, contact_email,
                             contact_phone, country, timezone, status, billing, branding)
  values (
    company,
    stem || '-' || upper(right(gen_random_uuid()::text, 4)),
    new_slug,
    coalesce(payload->>'industry', 'Construction'),
    admin_name, coalesce(admin_email, ''), admin_phone,
    coalesce(payload->>'country', ''),
    coalesce(payload->>'timezone', 'Asia/Kolkata'),
    case when trial_days > 0 then 'trial' else 'active' end::org_status,
    jsonb_build_object(
      'legalName', coalesce(nullif(payload->>'legalName', ''), company), 'contactName', admin_name,
      'email', coalesce(admin_email, ''), 'phone', admin_phone,
      'addressLine', coalesce(payload->>'addressLine', ''), 'city', coalesce(payload->>'city', ''),
      'state', coalesce(payload->>'state', ''), 'postcode', coalesce(payload->>'postcode', ''),
      'country', coalesce(payload->>'country', ''),
      'taxIdLabel', coalesce(nullif(payload->>'taxIdLabel', ''), 'GSTIN'),
      'taxId', coalesce(payload->>'taxId', ''), 'taxPercent', 18,
      'currency', coalesce(nullif(payload->>'currency', ''), 'INR'), 'paymentMethod', ''),
    jsonb_build_object('appName', 'Workfence', 'accent', '#f6a723', 'logoText', left(stem, 2))
  )
  returning id into new_org;

  insert into subscriptions (org_id, plan_id, status, cycle, trial_ends_at, renews_at)
  values (new_org, chosen_plan,
          case when trial_days > 0 then 'trial' else 'active' end::sub_status,
          'monthly',
          case when trial_days > 0 then now() + make_interval(days => trial_days) end,
          now() + make_interval(days => greatest(trial_days, 30)));

  insert into users (auth_id, org_id, name, employee_code, role, designation,
                     department, phone, email, avatar_hue, status, shift_start, shift_end)
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
    continue when btrim(coalesce(member->>'name', '')) = ''
               or btrim(coalesce(member->>'email', '')) = '';
    seq := seq + 1;
    insert into users (org_id, name, employee_code, role, designation, department,
                       phone, email, avatar_hue, status, shift_start, shift_end, invited_by)
    values (new_org, btrim(member->>'name'),
            stem || '-' || lpad(seq::text, 4, '0'), 'employee',
            coalesce(nullif(btrim(coalesce(member->>'designation','')), ''), 'Worker'),
            'Site', nullif(btrim(coalesce(member->>'phone','')), ''),
            lower(btrim(member->>'email')),
            (hashtext(coalesce(member->>'name','')) % 360 + 360) % 360,
            'active', 540, 1080, new_admin);
  end loop;

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
  insert into audit_log (org_id, actor_id, action, target, detail)
  values (new_org, new_admin, 'company.create', company, admin_name || ' created ' || company);

  return jsonb_build_object('orgId', new_org, 'userId', new_admin,
                            'siteId', new_site, 'officeId', new_office,
                            'slug', new_slug);
end $function$;

CREATE OR REPLACE FUNCTION public.is_org_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.is_org_admin() $function$;

CREATE OR REPLACE FUNCTION public.is_org_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.is_org_owner() $function$;

CREATE OR REPLACE FUNCTION public.sync_my_profile()
 RETURNS SETOF users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.sync_user_from_auth(auth.uid());
  return query
    select * from public.users
     where auth_id = auth.uid()
     order by (org_id = private.active_org_id()) desc nulls last, joined_at;
end $function$;
