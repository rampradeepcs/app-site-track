-- ============================================================================
-- Workfence — multi-tenant schema
--
-- Hierarchy: platform → organization (tenant) → projects → users → shifts.
-- Every tenant-owned table carries org_id and is protected by RLS so one
-- client can never read another's workforce, routes, attendance or billing.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums ----
create type app_role        as enum ('employee','manager','admin','superadmin');
create type org_status      as enum ('active','trial','suspended','payment-hold','cancelled');
create type sub_status      as enum ('trial','active','past-due','paused','suspended','cancelled');
create type billing_cycle   as enum ('monthly','annual');
create type invoice_status  as enum ('draft','issued','paid','pending','overdue','failed','refunded','cancelled');
create type project_status  as enum ('planning','active','on-hold','completed');
create type geofence_kind   as enum ('polygon','circle');
create type attendance_status as enum ('present','absent','late','early-checkout','missing-checkout','on-leave','holiday');
create type employee_status as enum ('active','inactive','on-leave');
create type ticket_status   as enum ('open','in-progress','waiting','resolved');
create type ticket_kind     as enum ('account','subscription','payment','technical','access');

-- =========================================================== platform ======
create table plans (
  id                  text primary key,
  name                text not null,
  description         text not null default '',
  monthly_price       numeric(12,2) not null default 0,
  annual_price        numeric(12,2) not null default 0,
  currency            text not null default 'INR',
  trial_days          int  not null default 14,
  -- limits; null means unlimited
  max_employees       int,
  max_managers        int,
  max_projects        int,
  max_storage_gb      int,
  route_retention_days int not null default 30,
  api_calls_per_month int not null default 0,
  features            jsonb not null default '{}'::jsonb,
  support_level       text not null default 'standard',
  archived            boolean not null default false,
  created_at          timestamptz not null default now()
);

create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text not null unique,
  industry      text not null default '',
  website       text not null default '',
  contact_name  text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  country       text not null default 'India',
  timezone      text not null default 'Asia/Kolkata',
  status        org_status not null default 'trial',
  billing       jsonb not null default '{}'::jsonb,
  branding      jsonb not null default '{}'::jsonb,
  suspended_reason text,
  created_at    timestamptz not null default now()
);

create table subscriptions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  plan_id           text not null references plans(id),
  status            sub_status not null default 'trial',
  cycle             billing_cycle not null default 'monthly',
  started_at        timestamptz not null default now(),
  trial_ends_at     timestamptz,
  renews_at         timestamptz not null,
  cancelled_at      timestamptz,
  -- per-client overrides: effective entitlement = plan ⊕ these
  limit_overrides   jsonb not null default '{}'::jsonb,
  feature_overrides jsonb not null default '{}'::jsonb,
  custom_price      numeric(12,2),
  discount_percent  numeric(5,2),
  credit_balance    numeric(12,2) not null default 0,
  on_limit_reached  text not null default 'block',
  notes             text,
  unique (org_id)
);

create table invoices (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  org_id         uuid not null references organizations(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  amount         numeric(12,2) not null,
  tax_amount     numeric(12,2) not null default 0,
  currency       text not null default 'INR',
  issued_at      timestamptz not null default now(),
  due_at         timestamptz not null,
  paid_at        timestamptz,
  status         invoice_status not null default 'issued',
  period_label   text not null default '',
  payment_method text not null default '',
  failure_reason text
);

create table usage_snapshots (
  org_id            uuid not null references organizations(id) on delete cascade,
  month             text not null,                -- YYYY-MM
  employees         int not null default 0,
  active_employees  int not null default 0,
  managers          int not null default 0,
  projects          int not null default 0,
  storage_gb        numeric(10,2) not null default 0,
  check_ins         int not null default 0,
  tracking_sessions int not null default 0,
  location_points   bigint not null default 0,
  work_updates      int not null default 0,
  api_calls         bigint not null default 0,
  report_runs       int not null default 0,
  active_manager_days int not null default 0,
  gps_errors        int not null default 0,
  primary key (org_id, month)
);

create table support_tickets (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  subject    text not null,
  body       text not null default '',
  kind       ticket_kind not null default 'technical',
  status     ticket_status not null default 'open',
  priority   text not null default 'normal',
  raised_by  text not null default '',
  opened_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only: no update/delete policy is ever granted on this table.
create table platform_audit (
  id             uuid primary key default gen_random_uuid(),
  at             timestamptz not null default now(),
  actor_id       uuid,
  actor_name     text not null default '',
  org_id         uuid references organizations(id) on delete set null,
  action         text not null,
  target         text not null default '',
  previous_value text,
  new_value      text,
  detail         text,
  ip             text
);

create table platform_settings (
  id       int primary key default 1,
  settings jsonb not null default '{}'::jsonb,
  constraint platform_settings_singleton check (id = 1)
);

-- ========================================================== workforce ======
create table users (
  id             uuid primary key default gen_random_uuid(),
  -- links to Supabase auth; null for seeded records not yet invited
  auth_id        uuid unique references auth.users(id) on delete set null,
  -- null only for the platform super admin, who belongs to no tenant
  org_id         uuid references organizations(id) on delete cascade,
  name           text not null,
  employee_code  text not null default '',
  role           app_role not null default 'employee',
  designation    text not null default '',
  department     text not null default '',
  phone          text not null default '',
  email          text,
  avatar_hue     int  not null default 200,
  photo          text,
  status         employee_status not null default 'active',
  shift_start    int not null default 510,   -- minutes from midnight
  shift_end      int not null default 1050,
  supervisor_rating numeric(4,2),
  joined_at      timestamptz not null default now(),
  constraint users_org_required check (role = 'superadmin' or org_id is not null)
);
create index on users (org_id);
create index on users (auth_id);

create table projects (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  code          text not null default '',
  name          text not null,
  client        text not null default '',
  address       text not null default '',
  site_contact  text not null default '',
  site_contact_phone text not null default '',
  manager_id    uuid references users(id) on delete set null,
  start_date    date,
  end_date      date,
  status        project_status not null default 'planning',
  description   text not null default '',
  location      jsonb not null,               -- {lat,lng}
  geofence_kind geofence_kind not null default 'circle',
  geofence      jsonb not null,               -- {polygon[],center,radius,bufferMeters}
  zones         jsonb not null default '[]'::jsonb,
  rules         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index on projects (org_id);

create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on project_members (org_id);
create index on project_members (user_id);

create table attendance (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  employee_id    uuid not null references users(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  date           date not null,
  check_in       jsonb,   -- {at,coords,accuracy,selfie,place,insideGeofence,offline}
  check_out      jsonb,
  worked_minutes int,
  distance_meters numeric(12,2) not null default 0,
  status         attendance_status not null default 'absent',
  auto_closed    boolean not null default false,
  events         jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  unique (employee_id, date, project_id)
);
create index on attendance (org_id, date);
create index on attendance (employee_id, date desc);

-- High-volume: partitioning by month is the natural next step at scale.
create table location_points (
  id            bigserial primary key,
  org_id        uuid not null references organizations(id) on delete cascade,
  attendance_id uuid not null references attendance(id) on delete cascade,
  employee_id   uuid not null references users(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  lat           double precision not null,
  lng           double precision not null,
  accuracy      real not null default 0,
  speed         real not null default 0,
  heading       real not null default 0,
  at            timestamptz not null,
  offline       boolean not null default false
);
create index on location_points (attendance_id, at);
create index on location_points (org_id, at desc);

create table work_updates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  employee_id   uuid not null references users(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  attendance_id uuid references attendance(id) on delete set null,
  kind          text not null default 'progress',
  category      text not null default 'Other',
  description   text not null,
  detail        jsonb not null default '{}'::jsonb,
  photos        jsonb not null default '[]'::jsonb,
  coords        jsonb,
  place         text,
  date          date not null,
  at            timestamptz not null default now()
);
create index on work_updates (org_id, at desc);
create index on work_updates (employee_id, at desc);

create table notifications (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete cascade,
  audience app_role not null,
  user_id  uuid references users(id) on delete cascade,
  kind     text not null,
  title    text not null,
  body     text not null default '',
  severity text not null default 'info',
  link     text,
  read     boolean not null default false,
  at       timestamptz not null default now()
);
create index on notifications (org_id, at desc);

create table audit_log (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action   text not null,
  target   text not null default '',
  detail   text,
  at       timestamptz not null default now()
);
create index on audit_log (org_id, at desc);
