-- ============================================================================
-- Shifts, breaks, overtime, salary, payroll, travel and allowances.
--
-- Everything the product grew after attendance, given the same treatment as
-- everything before it: tenant-scoped tables, RLS as the real boundary, and
-- no computed money stored anywhere. The tables here hold *inputs and
-- judgements* — shift definitions, salary revisions, travel routes, approval
-- decisions — because every amount in the app is recalculated from them on
-- read. A stored total is a number that can disagree with its evidence.
--
-- Two access rules are stricter than the rest of the schema and are enforced
-- here rather than in the client:
--
--   * compensation, pay_policies and payroll_runs are ADMIN-ONLY. A manager
--     runs shifts and approves overtime; they do not read salaries unless
--     their organisation's pay policy says so, and that decision is not the
--     database's to trust a client about — so the base rule is admin, and
--     the app's manager-visibility flag can only ever narrow it further.
--   * a worker may read their own everything (their shift, their travel,
--     their allowances) and write only their own travel sessions.
-- ============================================================================

-- ---------------------------------------------------------------- enums ----
create type shift_kind        as enum ('fixed','flexible','overnight','custom');
create type salary_type       as enum ('monthly','daily','hourly');
create type payroll_status    as enum ('draft','calculated','review','approved','locked');
create type travel_status     as enum ('active','pending','approved','rejected');
create type vehicle_type      as enum ('two-wheeler','four-wheeler','none');
create type rule_status       as enum ('active','archived');
create type approval_mode     as enum ('auto','manager');
create type decision_status   as enum ('approved','rejected');

-- ------------------------------------------- columns on existing tables ----
-- Attendance grows the shift it was measured against, the breaks taken, the
-- overtime detected and the optional checkout voice note. All nullable: rows
-- written before these existed stay valid and read as "none".
alter table attendance
  add column if not exists shift_id   uuid,
  add column if not exists breaks     jsonb not null default '[]'::jsonb,
  add column if not exists overtime   jsonb,
  add column if not exists voice_note jsonb;

-- A trail point may belong to a travel session. Only these are ever measured
-- for petrol allowance: ordinary shift movement is presence, not travel.
alter table location_points
  add column if not exists travel_session_id uuid;

alter table users
  add column if not exists vehicle jsonb;

-- Travel recording is independent of the shift tracking policy: a site can
-- record nothing of on-site movement and still permit an approved supply run.
alter table projects
  add column if not exists travel_tracking boolean not null default false;

-- =========================================================== shifts ========
create table shifts (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organizations(id) on delete cascade,
  name                    text not null,
  code                    text not null default '',
  kind                    shift_kind not null default 'fixed',
  -- minutes from midnight; for an overnight shift end < start
  start_minute            int not null default 510,
  end_minute              int not null default 1050,
  required_minutes        int not null default 480,
  grace_minutes           int not null default 15,
  break_rules             jsonb not null default '[]'::jsonb,
  max_breaks_per_shift    int not null default 3,
  min_break_minutes       int not null default 5,
  max_break_minutes       int not null default 90,
  employee_breaks_allowed boolean not null default true,
  break_approval_required boolean not null default false,
  overtime                jsonb not null default '{}'::jsonb,
  working_days            int[] not null default '{1,2,3,4,5,6}',
  project_ids             uuid[] not null default '{}',
  status                  rule_status not null default 'active',
  created_at              timestamptz not null default now()
);
create index on shifts (org_id, status);

alter table attendance
  add constraint attendance_shift_fk
  foreign key (shift_id) references shifts(id) on delete set null;

create table shift_assignments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  employee_id    uuid not null references users(id) on delete cascade,
  shift_id       uuid not null references shifts(id) on delete cascade,
  -- the date this assignment starts applying; future dates schedule a change
  effective_from date not null,
  assigned_by    uuid references users(id) on delete set null,
  at             timestamptz not null default now()
);
create index on shift_assignments (employee_id, effective_from desc);

-- ====================================================== compensation ======
-- Append-only by construction: a revision is a new row on its own effective
-- date. Nothing here is ever updated, so salary history cannot be rewritten.
create table compensation (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id) on delete cascade,
  employee_id            uuid not null references users(id) on delete cascade,
  type                   salary_type not null default 'monthly',
  amount                 numeric(12,2) not null,
  effective_from         date not null,
  working_days_per_month int not null default 26,
  standard_day_minutes   int not null default 480,
  note                   text,
  set_by                 uuid references users(id) on delete set null,
  at                     timestamptz not null default now()
);
create index on compensation (employee_id, effective_from desc);

-- One row per tenant: how late, early, absence, break and overtime are priced.
create table pay_policies (
  org_id                 uuid primary key references organizations(id) on delete cascade,
  late_deduction         text not null default 'none',
  late_per_minute_rate   numeric(10,2) not null default 0,
  late_fixed_amount      numeric(10,2) not null default 0,
  early_out_deduction    text not null default 'none',
  early_per_minute_rate  numeric(10,2) not null default 0,
  early_fixed_amount     numeric(10,2) not null default 0,
  absence_deduction      text not null default 'full-day',
  excess_break_unpaid    boolean not null default true,
  manager_sees_salary    boolean not null default false,
  updated_at             timestamptz not null default now()
);

create table payroll_runs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  month       text not null,                       -- YYYY-MM
  status      payroll_status not null default 'draft',
  -- human corrections, including any made after a lock
  adjustments jsonb not null default '[]'::jsonb,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  locked_at   timestamptz,
  unique (org_id, month)
);

-- ============================================================ travel ======
create table travel_sessions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  employee_id    uuid not null references users(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  attendance_id  uuid references attendance(id) on delete set null,
  date           date not null,
  start_anchor   jsonb not null,
  end_anchor     jsonb,
  purpose        text not null default 'Other',
  note           text,
  vehicle_type   vehicle_type not null default 'none',
  -- metres the sanitiser accepted; drift, teleports and gaps excluded
  distance_meters numeric(12,2) not null default 0,
  -- what a manager settled on, when they edited it
  approved_meters numeric(12,2),
  flags          jsonb not null default '[]'::jsonb,
  status         travel_status not null default 'active',
  decided_by     uuid references users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  selfie         text
);
create index on travel_sessions (employee_id, date desc);
create index on travel_sessions (org_id, status);

alter table location_points
  add constraint points_travel_fk
  foreign key (travel_session_id) references travel_sessions(id) on delete set null;

-- ========================================================= allowances =====
create table petrol_rules (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  name              text not null,
  vehicle_type      vehicle_type not null default 'two-wheeler',
  rate_per_km       numeric(10,2) not null default 0,
  max_daily_km      numeric(10,2),
  max_daily_amount  numeric(12,2),
  approval          approval_mode not null default 'manager',
  -- empty arrays mean "every project" / "everyone"; narrowest scope wins
  project_ids       uuid[] not null default '{}',
  employee_ids      uuid[] not null default '{}',
  effective_from    date not null,
  status            rule_status not null default 'active',
  created_at        timestamptz not null default now()
);
create index on petrol_rules (org_id, status);

create table food_rules (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  name           text not null,
  meal           text not null default 'Breakfast',
  start_minute   int not null,
  end_minute     int not null,
  -- which verified attendance mark opens eligibility
  trigger_event  text not null default 'check-in',
  amount         numeric(12,2) not null default 0,
  project_ids    uuid[] not null default '{}',
  employee_ids   uuid[] not null default '{}',
  shift_ids      uuid[] not null default '{}',
  approval       approval_mode not null default 'auto',
  effective_from date not null,
  status         rule_status not null default 'active',
  created_at     timestamptz not null default now()
);
create index on food_rules (org_id, status);

-- A manager's decision on one earned allowance. The amount is not stored:
-- it is recomputed from the rule, and this row only says approved or not.
create table allowance_decisions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references users(id) on delete cascade,
  date        date not null,
  rule_id     uuid not null references food_rules(id) on delete cascade,
  status      decision_status not null,
  decided_by  uuid references users(id) on delete set null,
  at          timestamptz not null default now(),
  note        text
);
create index on allowance_decisions (employee_id, date);

-- ============================================================== RLS =======
alter table shifts              enable row level security;
alter table shift_assignments   enable row level security;
alter table compensation        enable row level security;
alter table pay_policies        enable row level security;
alter table payroll_runs        enable row level security;
alter table travel_sessions     enable row level security;
alter table petrol_rules        enable row level security;
alter table food_rules          enable row level security;
alter table allowance_decisions enable row level security;

-- True when the caller administers their own organisation's money. Salary and
-- payroll are the one area a manager is not automatically trusted with.
create or replace function is_org_owner()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role = 'admin' from users where auth_id = auth.uid() limit 1), false) $$;

-- ---- shifts & assignments: everyone in the tenant reads, admins write ----
create policy shifts_read on shifts
  for select using (is_superadmin() or org_id = auth_org_id());
create policy shifts_write on shifts
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()))
  with check (org_id = auth_org_id() and is_org_admin());

create policy shift_assign_read on shift_assignments
  for select using (
    is_superadmin()
    or (org_id = auth_org_id()
        and (is_org_admin() or employee_id = (select id from auth_user())))
  );
create policy shift_assign_write on shift_assignments
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()))
  with check (org_id = auth_org_id() and is_org_admin());

-- ---- salary: admins, or the person it belongs to -------------------------
create policy comp_read on compensation
  for select using (
    is_superadmin()
    or (org_id = auth_org_id()
        and (is_org_owner() or employee_id = (select id from auth_user())))
  );
create policy comp_insert on compensation
  for insert with check (org_id = auth_org_id() and is_org_owner());
-- No update or delete policy: salary history is append-only in the database,
-- not merely by convention in the app.

create policy paypolicy_read on pay_policies
  for select using (is_superadmin() or org_id = auth_org_id());
create policy paypolicy_write on pay_policies
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_owner()))
  with check (org_id = auth_org_id() and is_org_owner());

create policy payroll_read on payroll_runs
  for select using (
    is_superadmin() or (org_id = auth_org_id() and is_org_admin())
  );
create policy payroll_write on payroll_runs
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_owner()))
  with check (org_id = auth_org_id() and is_org_owner());

-- ---- travel: a worker owns their own runs; managers review them ----------
create policy travel_read on travel_sessions
  for select using (
    is_superadmin()
    or (org_id = auth_org_id()
        and (is_org_admin() or employee_id = (select id from auth_user())))
  );
create policy travel_insert on travel_sessions
  for insert with check (
    org_id = auth_org_id()
    and (is_org_admin() or employee_id = (select id from auth_user()))
  );
create policy travel_update on travel_sessions
  for update using (
    is_superadmin()
    or (org_id = auth_org_id()
        and (is_org_admin() or employee_id = (select id from auth_user())))
  ) with check (org_id = auth_org_id());

-- ---- allowance rules: read by the tenant, written by admins -------------
create policy petrol_read on petrol_rules
  for select using (is_superadmin() or org_id = auth_org_id());
create policy petrol_write on petrol_rules
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()))
  with check (org_id = auth_org_id() and is_org_admin());

create policy food_read on food_rules
  for select using (is_superadmin() or org_id = auth_org_id());
create policy food_write on food_rules
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()))
  with check (org_id = auth_org_id() and is_org_admin());

create policy allowance_dec_read on allowance_decisions
  for select using (
    is_superadmin()
    or (org_id = auth_org_id()
        and (is_org_admin() or employee_id = (select id from auth_user())))
  );
create policy allowance_dec_write on allowance_decisions
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()))
  with check (org_id = auth_org_id() and is_org_admin());
