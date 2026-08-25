-- ============================================================================
-- First-run bootstrap.
--
-- Run this ONCE in the Supabase SQL editor after `db push`, with the two
-- values below changed to yours.
--
-- Why it exists: RLS resolves everything through auth.uid() -> users.auth_id.
-- On a freshly migrated database there are no users, so the first person to
-- sign in matches nothing, resolves to no organisation, and sees an empty
-- app that looks broken. This creates the platform owner so that first
-- sign-in lands somewhere, plus a demo tenant so the screens have content.
-- ============================================================================

\set owner_phone '''+919600309001'''
\set owner_email '''priya@example.com'''

-- ---------------------------------------------------------------- owner ----
-- No org_id: the platform Super Admin sits above every tenant.
insert into users (org_id, name, employee_code, role, designation, department,
                   phone, email, avatar_hue, status, shift_start, shift_end)
values (null, 'Platform Owner', 'NT-0001', 'superadmin', 'Product Owner',
        'Management', :owner_phone, :owner_email, 265, 'active', 540, 1080)
on conflict do nothing;

-- ----------------------------------------------------------- demo tenant ---
-- Optional. Delete this block for a genuinely empty production start.
with org as (
  insert into organizations (name, code, industry, contact_name, contact_email,
                             contact_phone, country, timezone, status, billing, branding)
  values ('ABC Infra Developers', 'CL-1001', 'Civil construction',
          'Rajesh Narayanan', 'rajesh@abcinfra.in', '+919894210101',
          'India', 'Asia/Kolkata', 'active',
          jsonb_build_object('legalName','ABC Infra Developers Pvt Ltd','currency','INR',
                             'taxIdLabel','GSTIN','taxPercent',18,'country','India'),
          jsonb_build_object('appName','SiteTrack','accent','#f6a723','logoText','AI'))
  returning id
), sub as (
  insert into subscriptions (org_id, plan_id, status, cycle, renews_at,
                             limit_overrides, feature_overrides, on_limit_reached)
  select id, 'plan_growth', 'active', 'annual', now() + interval '340 days',
         '{}'::jsonb, '{}'::jsonb, 'block'
  from org returning org_id
), mgr as (
  insert into users (org_id, name, employee_code, role, designation, department,
                     phone, email, avatar_hue, status, shift_start, shift_end)
  select id, 'Rajesh Narayanan', 'NT-0101', 'manager', 'Project Manager',
         'Operations', '+919894210101', 'rajesh@abcinfra.in', 12, 'active', 510, 1080
  from org returning id, org_id
)
insert into projects (org_id, code, name, client, address, site_contact,
                      site_contact_phone, manager_id, start_date, status,
                      description, location, geofence_kind, geofence, zones, rules)
select
  m.org_id, 'NT-CW-101', 'ABC Construction Site', 'ABC Infra Developers',
  'Avinashi Road, Peelamedu, Coimbatore', 'Rajesh Narayanan', '+919894210101',
  m.id, current_date - 120, 'active',
  'Seven-storey commercial block with basement parking.',
  '{"lat":11.0273,"lng":77.0037}'::jsonb,
  'polygon',
  jsonb_build_object(
    'polygon', jsonb_build_array(
      jsonb_build_object('lat',11.02885,'lng',77.00305),
      jsonb_build_object('lat',11.02845,'lng',77.00505),
      jsonb_build_object('lat',11.02645,'lng',77.00520),
      jsonb_build_object('lat',11.02580,'lng',77.00365),
      jsonb_build_object('lat',11.02700,'lng',77.00215)),
    'center', jsonb_build_object('lat',11.0273,'lng',77.0037),
    'radius', 190, 'bufferMeters', 40),
  jsonb_build_array(
    jsonb_build_object('id','z1','name','Main Gate','kind','access',
      'center',jsonb_build_object('lat',11.02620,'lng',77.00330),'radius',30),
    jsonb_build_object('id','z2','name','Block A','kind','work',
      'center',jsonb_build_object('lat',11.02810,'lng',77.00330),'radius',45),
    jsonb_build_object('id','z3','name','Material Yard','kind','material',
      'center',jsonb_build_object('lat',11.02700,'lng',77.00270),'radius',40)),
  jsonb_build_object('shiftStart',510,'shiftEnd',1050,'lateGraceMinutes',10,
                     'minShiftMinutes',240,'exitAlertMinutes',10,'autoCheckoutHours',14)
from mgr m;

-- ------------------------------------------------------------------ check --
select 'super admins: ' || count(*) from users where role = 'superadmin';
select 'organisations: ' || count(*) from organizations;
select 'projects: '      || count(*) from projects;
