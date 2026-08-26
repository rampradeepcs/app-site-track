-- ============================================================================
-- First-run bootstrap.
--
-- Run this ONCE in the Supabase SQL editor, after the migrations.
--
-- It creates exactly what the app starts from: one organisation, two premises
-- (a site and an office) and one user per role. No invented history — the
-- attendance, routes and work updates all arrive by using the product.
--
-- This mirrors `src/lib/seed.ts`. If you change one, change the other, or the
-- app will look different depending on which backend it is talking to.
--
-- Why it exists at all: row-level security resolves every request through
-- auth.uid() -> users.auth_id. A freshly migrated database has no users, so
-- the first person to sign in matches nothing, resolves to no organisation,
-- and gets an empty app that looks broken.
--
-- BEFORE RUNNING: change the phone and email on the CHANGE ME line to the
-- ones you will actually sign in with. A new auth identity is matched to
-- these rows by phone digits first, then email.
-- ============================================================================

begin;

-- ------------------------------------------------------------ the tenant ---
insert into organizations (id, name, code, industry, contact_name, contact_email,
                           contact_phone, country, timezone, status, billing, branding)
values (
  '00000000-0000-4000-8000-000000000001', 'Nachi Tekneka', 'CL-1001', 'Construction',
  'Demo Admin', 'admin@workfence.demo', '+91 90000 00002', 'India', 'Asia/Kolkata', 'trial',
  jsonb_build_object(
    'legalName','Nachi Tekneka','contactName','Demo Admin',
    'email','admin@workfence.demo','phone','+91 90000 00002',
    'addressLine','Peelamedu','city','Coimbatore','state','Tamil Nadu',
    'postcode','641004','country','India','taxIdLabel','GSTIN','taxId','',
    'taxPercent',18,'currency','INR','paymentMethod',''),
  jsonb_build_object('appName','Workfence','accent','#f6a723','logoText','NT')
)
on conflict (id) do nothing;

insert into subscriptions (org_id, plan_id, status, cycle, trial_ends_at, renews_at)
values ('00000000-0000-4000-8000-000000000001', 'plan_growth', 'trial', 'monthly',
        now() + interval '14 days', now() + interval '14 days')
on conflict (org_id) do nothing;

-- --------------------------------------------------------------- people ----
-- One identity per role. The platform owner has no org_id: they sit above
-- every tenant, which is why a client admin cannot see them.
insert into users (id, org_id, name, employee_code, role, designation, department,
                   phone, email, avatar_hue, status, shift_start, shift_end)
values
  ('00000000-0000-4000-8000-00000000000a', null,
   'Demo Owner', 'NT-0001', 'superadmin', 'Product Owner', 'Platform',
   '+91 90000 00001', 'owner@workfence.demo',   -- CHANGE ME: your phone, your email
   265, 'active', 540, 1080),

  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000001',
   'Demo Admin', 'NT-0002', 'admin', 'Client Administrator', 'Management',
   '+91 90000 00002', 'admin@workfence.demo', 200, 'active', 540, 1080),

  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-000000000001',
   'Demo Manager', 'NT-0003', 'manager', 'Project Manager', 'Operations',
   '+91 90000 00003', 'manager@workfence.demo', 35, 'active', 510, 1080),

  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-000000000001',
   'Demo Employee', 'NT-0004', 'employee', 'Site Supervisor', 'Civil',
   '+91 90000 00004', 'employee@workfence.demo', 16, 'active', 510, 1050)
on conflict (id) do nothing;

-- ------------------------------------------------------------- premises ----
-- Both are geofenced places a shift can start and end at. The office is not a
-- job; it exists so a project switched to `outside-only` tracking has
-- somewhere other than the site to check out.
insert into projects (id, org_id, kind, tracking_mode, code, name, client, address,
                      site_contact, site_contact_phone, manager_id, status, description,
                      location, geofence_kind, geofence, zones, rules)
values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000001',
   'site', 'full-shift', 'NT-CW-101', 'Riverside Tower', 'Nachi Tekneka',
   'Avinashi Road, Peelamedu, Coimbatore 641004', 'Site Office', '+91 90000 00001',
   '00000000-0000-4000-8000-00000000000c', 'active',
   'First site. Rename it, redraw the boundary and assign your crew from Projects.',
   '{"lat":11.0273,"lng":77.0037}'::jsonb, 'circle',
   '{"kind":"circle","polygon":[],"center":{"lat":11.0273,"lng":77.0037},"radius":170,"bufferMeters":40}'::jsonb,
   '[{"id":"z_gate","name":"Main Gate","center":{"lat":11.026032,"lng":77.00323},"radius":32,"kind":"access"},
     {"id":"z_work","name":"Work Area","center":{"lat":11.027934,"lng":77.003158},"radius":45,"kind":"work"},
     {"id":"z_yard","name":"Material Yard","center":{"lat":11.027152,"lng":77.002629},"radius":40,"kind":"material"},
     {"id":"z_welfare","name":"Rest Area","center":{"lat":11.027115,"lng":77.003183},"radius":26,"kind":"welfare"}]'::jsonb,
   '{"shiftStart":510,"shiftEnd":1050,"lateGraceMinutes":15,"minShiftMinutes":420,"exitAlertMinutes":10,"autoCheckoutHours":14}'::jsonb),

  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-000000000001',
   'office', 'full-shift', 'NT-HO-001', 'Head Office', 'Internal',
   'Peelamedu, Coimbatore 641004', 'Front Desk', '+91 90000 00002',
   '00000000-0000-4000-8000-00000000000c', 'active',
   'Office premise. Crews working away from a site can start and end the day here.',
   '{"lat":11.0219,"lng":76.9938}'::jsonb, 'circle',
   '{"kind":"circle","polygon":[],"center":{"lat":11.0219,"lng":76.9938},"radius":70,"bufferMeters":25}'::jsonb,
   '[{"id":"zo_recep","name":"Reception","center":{"lat":11.0219,"lng":76.9938},"radius":22,"kind":"access"},
     {"id":"zo_desk","name":"Project Desk","center":{"lat":11.022005,"lng":76.994093},"radius":20,"kind":"work"}]'::jsonb,
   '{"shiftStart":540,"shiftEnd":1080,"lateGraceMinutes":15,"minShiftMinutes":420,"exitAlertMinutes":15,"autoCheckoutHours":14}'::jsonb)
on conflict (id) do nothing;

-- Everyone in the tenant is attached to both premises, so any of them can
-- start a shift at either and — under `outside-only` — close it at either.
insert into project_members (project_id, user_id, org_id)
select p.id, u.id, u.org_id
  from projects p
  join users u on u.org_id = p.org_id
 where p.org_id = '00000000-0000-4000-8000-000000000001'
on conflict do nothing;

commit;

-- ----------------------------------------------------------------- check ---
select 'organisations: ' || count(*) from organizations;
select 'users by role: ' || string_agg(role || '=' || n, ', ' order by role)
  from (select role::text as role, count(*) as n from users group by role) s;
select 'premises: ' || string_agg(name || ' (' || kind || ')', ', ' order by name) from projects;
select 'history rows: attendance=' || (select count(*) from attendance)
    || ' points=' || (select count(*) from location_points)
    || ' invoices=' || (select count(*) from invoices);
