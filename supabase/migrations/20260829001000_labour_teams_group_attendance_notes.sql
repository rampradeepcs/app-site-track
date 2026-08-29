-- ============================================================================
-- Labour teams, group attendance and project notes.
--
-- The shift from managing individuals to managing gangs, given the same
-- treatment as everything before it: tenant-scoped tables, RLS as the real
-- boundary, and no derived state stored.
--
-- Three things here are stricter than the rest of the schema, and each is
-- enforced in the database rather than trusted to a client:
--
--   * A group attendance capture may only be written by someone entitled to
--     take one — an admin or manager, or the site engineer actually named on
--     a team for that project. The whole feature exists to make attendance
--     harder to fake, so the authority to record it cannot be a client-side
--     check.
--   * Individual attendance rows point at the capture that produced them.
--     The evidence and the register are one hop apart, permanently.
--   * Project note visibility is a database rule. A note marked
--     "management" is invisible to a labourer's session because the policy
--     says so, not because a screen filtered it — a commercial note reaching
--     a subcontractor's crew is the failure that actually costs something.
-- ============================================================================

-- ---------------------------------------------------------------- enums ----
create type labour_team_status   as enum ('active','paused','completed','archived');
create type team_member_status   as enum ('active','inactive','on-leave','transferred','completed');
create type face_detection_status as enum ('detected','not-detected');
create type face_match_status    as enum ('matched','low-confidence','unmatched','manual');
create type group_att_status     as enum ('draft','confirmed','discarded');
create type geofence_check       as enum ('inside','outside','unknown');
create type note_priority        as enum ('low','normal','important','critical');
create type note_visibility      as enum ('management','managers-engineers','project-team','selected');
create type note_status          as enum ('open','done','archived');

-- ------------------------------------------- columns on existing tables ----
-- A day marked from a group photo says so, and says which photo. Nullable:
-- every attendance row written before group capture existed reads as "a
-- person checked themselves in", which is what it was.
alter table attendance
  add column if not exists group_attendance_id uuid,
  add column if not exists marked_by_team_id   uuid;

-- ======================================================== labour teams =====
create table labour_teams (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  name             text not null,
  -- Free text, not an enum. A site with a False Ceiling gang should not be
  -- told by its software that its own trade is not a real one.
  type             text not null,
  code             text not null,
  leader_id        uuid references users(id) on delete set null,
  site_engineer_id uuid references users(id) on delete set null,
  supervisor_id    uuid references users(id) on delete set null,
  description      text,
  status           labour_team_status not null default 'active',
  start_date       date,
  end_date         date,
  work_zone_id     text,
  shift_id         uuid,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, code)
);
create index on labour_teams (org_id);
create index on labour_teams (project_id);

-- Membership is a dated spell, not a column on the worker. The question a
-- manager asks is nearly always historical — who was in this gang in March —
-- and overwriting a team id answers none of them.
create table labour_team_members (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id) on delete cascade,
  team_id                uuid not null references labour_teams(id) on delete cascade,
  employee_id            uuid not null references users(id) on delete cascade,
  joined_at              timestamptz not null default now(),
  left_at                timestamptz,
  status                 team_member_status not null default 'active',
  transferred_to_team_id uuid references labour_teams(id) on delete set null
);
create index on labour_team_members (org_id);
create index on labour_team_members (team_id);
create index on labour_team_members (employee_id);
-- One open spell per worker per team. Closed spells may repeat freely.
create unique index labour_team_members_open_unique
  on labour_team_members (team_id, employee_id)
  where left_at is null;

-- ==================================================== group attendance =====
create table group_attendance (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  team_id          uuid not null references labour_teams(id) on delete cascade,
  shift_id         uuid,
  site_engineer_id uuid not null references users(id) on delete restrict,
  -- One row may carry several frames: a large gang does not fit in one.
  photos           jsonb not null default '[]'::jsonb,
  captured_at      timestamptz not null default now(),
  lat              double precision,
  lng              double precision,
  geofence_status  geofence_check not null default 'unknown',
  face_count       integer not null default 0,
  matched_count    integer not null default 0,
  status           group_att_status not null default 'draft',
  confirmed_by     uuid references users(id) on delete set null,
  confirmed_at     timestamptz,
  note             text
);
create index on group_attendance (org_id);
create index on group_attendance (project_id, captured_at desc);
create index on group_attendance (team_id, captured_at desc);

-- What the software saw, what it guessed, and what the reviewer decided —
-- stored as four separate facts because they are four separate claims.
-- Collapsing detection into identity is how a register ends up asserting
-- something the software never established.
create table group_attendance_members (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  group_attendance_id uuid not null references group_attendance(id) on delete cascade,
  employee_id         uuid not null references users(id) on delete cascade,
  detection_status    face_detection_status not null,
  match_status        face_match_status not null,
  attendance_status   text not null check (attendance_status in ('present','absent')),
  review_status       text not null check (review_status in ('proposed','confirmed','corrected')),
  -- Euclidean distance of the winning descriptor. Kept for audit: it is the
  -- only way to review later how strong a claimed match actually was.
  distance            double precision,
  attendance_id       uuid references attendance(id) on delete set null,
  unique (group_attendance_id, employee_id)
);
create index on group_attendance_members (org_id);
create index on group_attendance_members (group_attendance_id);
create index on group_attendance_members (employee_id);

alter table attendance
  add constraint attendance_group_fk
  foreign key (group_attendance_id) references group_attendance(id) on delete set null;

-- ======================================================== project notes ====
create table project_notes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  author_id     uuid not null references users(id) on delete restrict,
  title         text not null,
  body          text not null default '',
  category      text not null default 'General',
  priority      note_priority not null default 'normal',
  -- Default-closed. A note nobody chose an audience for reaches the people
  -- running the job, not the whole site.
  visibility    note_visibility not null default 'managers-engineers',
  visible_to    uuid[] not null default '{}',
  status        note_status not null default 'open',
  due_date      date,
  remind_at     timestamptz,
  reminder_sent boolean not null default false,
  pinned        boolean not null default false,
  lat           double precision,
  lng           double precision,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on project_notes (org_id);
create index on project_notes (project_id, pinned desc, created_at desc);

create table project_note_attachments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  note_id    uuid not null references project_notes(id) on delete cascade,
  file       text not null,
  name       text not null,
  type       text not null check (type in ('image','pdf','document','voice')),
  size       bigint not null default 0,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index on project_note_attachments (org_id);
create index on project_note_attachments (note_id);

-- =============================================================== RLS =======
alter table labour_teams             enable row level security;
alter table labour_team_members      enable row level security;
alter table group_attendance         enable row level security;
alter table group_attendance_members enable row level security;
alter table project_notes            enable row level security;
alter table project_note_attachments enable row level security;

-- True when the caller runs a gang on this project. Workfence has no site
-- engineer role, so the authority is derived from the assignment: you are one
-- if a team on that project names you. Take them off the team and the
-- capability goes with it.
create or replace function is_site_engineer(p_project uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from labour_teams t
    where t.project_id = p_project
      and t.status <> 'archived'
      and t.site_engineer_id = (select id from auth_user())
  )
$$;

-- ---- teams: the tenant reads, managers write -----------------------------
create policy teams_read on labour_teams
  for select using (is_superadmin() or org_id = auth_org_id());
create policy teams_write on labour_teams
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()))
  with check (org_id = auth_org_id() and is_org_admin());

create policy team_members_read on labour_team_members
  for select using (is_superadmin() or org_id = auth_org_id());
create policy team_members_write on labour_team_members
  for all using (is_superadmin() or (org_id = auth_org_id() and is_org_admin()))
  with check (org_id = auth_org_id() and is_org_admin());

-- ---- group attendance: managers, or the named site engineer --------------
create policy group_att_read on group_attendance
  for select using (is_superadmin() or org_id = auth_org_id());
create policy group_att_insert on group_attendance
  for insert with check (
    org_id = auth_org_id()
    and (is_org_admin() or is_site_engineer(project_id))
    -- You may only file a capture as yourself.
    and site_engineer_id = (select id from auth_user())
  );
create policy group_att_update on group_attendance
  for update using (
    org_id = auth_org_id() and (is_org_admin() or is_site_engineer(project_id))
  );
-- No delete policy: a capture is evidence for a register, and evidence is not
-- something the app is allowed to quietly remove.

create policy group_att_members_read on group_attendance_members
  for select using (is_superadmin() or org_id = auth_org_id());
create policy group_att_members_write on group_attendance_members
  for all using (
    is_superadmin()
    or (org_id = auth_org_id()
        and exists (
          select 1 from group_attendance g
          where g.id = group_attendance_id
            and (is_org_admin() or is_site_engineer(g.project_id))
        ))
  )
  with check (
    org_id = auth_org_id()
    and exists (
      select 1 from group_attendance g
      where g.id = group_attendance_id
        and (is_org_admin() or is_site_engineer(g.project_id))
    )
  );

-- ---- notes: visibility is a database rule --------------------------------
create policy notes_read on project_notes
  for select using (
    is_superadmin()
    or (
      org_id = auth_org_id()
      and (
        author_id = (select id from auth_user())
        or is_org_owner()
        or case visibility
             when 'management'         then is_org_admin()
             when 'managers-engineers' then is_org_admin() or is_site_engineer(project_id)
             when 'project-team'       then
               is_org_admin()
               or exists (
                 select 1 from project_members pm
                 where pm.project_id = project_notes.project_id
                   and pm.user_id = (select id from auth_user())
               )
             when 'selected'           then (select id from auth_user()) = any (visible_to)
             -- Unknown visibility resolves closed, never open.
             else is_org_admin()
           end
      )
    )
  );

create policy notes_insert on project_notes
  for insert with check (
    org_id = auth_org_id()
    and author_id = (select id from auth_user())
    and (is_org_admin() or is_site_engineer(project_id))
  );
create policy notes_update on project_notes
  for update using (
    org_id = auth_org_id()
    and (is_org_admin() or author_id = (select id from auth_user()))
  );
create policy notes_delete on project_notes
  for delete using (
    org_id = auth_org_id()
    and (is_org_admin() or author_id = (select id from auth_user()))
  );

-- Attachments inherit the note's audience exactly. Anything looser would be a
-- way to read a note you cannot read.
create policy note_attach_read on project_note_attachments
  for select using (
    is_superadmin()
    or exists (select 1 from project_notes n where n.id = note_id)
  );
create policy note_attach_write on project_note_attachments
  for all using (
    org_id = auth_org_id()
    and exists (
      select 1 from project_notes n
      where n.id = note_id
        and (is_org_admin() or n.author_id = (select id from auth_user()))
    )
  )
  with check (
    org_id = auth_org_id()
    and created_by = (select id from auth_user())
    and exists (
      select 1 from project_notes n
      where n.id = note_id
        and (is_org_admin() or n.author_id = (select id from auth_user()))
    )
  );
