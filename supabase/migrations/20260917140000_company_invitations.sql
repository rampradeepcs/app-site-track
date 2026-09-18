-- ============================================================================
-- Catch-up 2 of 3: the invitations table.
--
-- Dated just before 20260917150000, which rewrites this table's read policy and
-- therefore could not run without it. That migration is the one that failed on
-- a fresh database with "relation public.company_invitations does not exist".
--
-- The policy itself is deliberately left to 20260917150000 rather than created
-- here and immediately replaced: that file is the canonical statement of who
-- may read an invitation, and stating it twice invites the two copies to drift.
-- Between the two migrations the table is RLS-enabled with no policy, which
-- denies everything — the safe direction to be wrong in for one step of a
-- replay.
--
-- There is no write policy at all, here or later, by design: every write goes
-- through a SECURITY DEFINER RPC in 20260918120000.
-- ============================================================================

create table if not exists company_invitations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  -- Set once we know which identity it is for; null while it is only an address.
  invited_user_id uuid references auth.users(id) on delete set null,
  email           text not null,
  phone           text,
  name            text not null default '',
  role            app_role not null default 'employee',
  department      text not null default '',
  designation     text not null default '',
  project_id      uuid references projects(id) on delete set null,
  shift_id        uuid references shifts(id) on delete set null,
  employment_type text not null default 'full-time',
  status          text not null default 'pending'
                  check (status in ('pending','accepted','declined','expired','cancelled')),
  invited_by      uuid references users(id) on delete set null,
  -- An invitation that never expires is an account somebody can still claim a
  -- year after anybody meant them to.
  expires_at      timestamptz not null default (now() + interval '30 days'),
  accepted_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- One live invitation per address per company. Partial, so that declining and
-- being invited again works and the history of both survives.
create unique index if not exists company_invitations_pending_unique
  on public.company_invitations (org_id, lower(email)) where status = 'pending';
create index if not exists company_invitations_email_idx
  on public.company_invitations (lower(email));
create index if not exists company_invitations_user_idx
  on public.company_invitations (invited_user_id);

alter table company_invitations enable row level security;
