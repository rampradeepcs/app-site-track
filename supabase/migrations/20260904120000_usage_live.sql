-- Usage, measured rather than recorded.
--
-- The platform's usage figures — how many people a client has, how many
-- worked this month, check-ins, tracking, storage — came from
-- usage_snapshots, a table nothing writes. The seed filled it for the
-- demonstration; in production it is empty, so the platform owner's
-- dashboard said every client had nobody and did nothing, which is the
-- opposite of the truth and the kind of number that gets acted on.
--
-- The truth is already in the operational tables, so this view counts it:
-- one row per organisation per month, in the exact shape of usage_snapshots,
-- computed when read. security_invoker means the caller's own row-level
-- policies apply underneath — the platform owner sees every client, a
-- client's admin only their own — with nothing new to police.
--
-- "Active" means the person did something that month: checked in, or
-- signed in to the app. Both are real events with timestamps; neither is a
-- guess. Storage is what attachments weigh; photographs inside JSON columns
-- are not measured, so it reads low rather than invented.
--
-- Months run from the organisation's first month to now, capped at twelve,
-- so the history charts have something to draw.

create or replace view public.usage_live
with (security_invoker = true)
as
with months as (
  select o.id as org_id,
         to_char(m, 'YYYY-MM') as month,
         m::date as month_start,
         (m + interval '1 month')::date as month_end
    from organizations o
    cross join lateral generate_series(
      greatest(date_trunc('month', o.created_at),
               date_trunc('month', now()) - interval '11 months'),
      date_trunc('month', now()),
      interval '1 month') as m
),
people as (
  select u.org_id, u.id, u.role, u.status, u.last_sign_in_at
    from public.users u
   where u.org_id is not null
)
select
  mo.org_id,
  mo.month,
  (select count(*) from people p
     where p.org_id = mo.org_id and p.status = 'active')::int as employees,
  (select count(distinct x.who) from (
      select a.employee_id as who from public.attendance a
       where a.org_id = mo.org_id and a.date >= mo.month_start and a.date < mo.month_end
      union
      select p.id from people p
       where p.org_id = mo.org_id
         and p.last_sign_in_at >= mo.month_start and p.last_sign_in_at < mo.month_end
   ) x)::int as active_employees,
  (select count(*) from people p
     where p.org_id = mo.org_id and p.status = 'active' and p.role in ('manager', 'admin'))::int as managers,
  (select count(*) from public.projects pr
     where pr.org_id = mo.org_id and pr.status <> 'completed'
       and pr.created_at < mo.month_end)::int as projects,
  (coalesce((select sum(att.size) from public.project_note_attachments att
              where att.org_id = mo.org_id and att.created_at < mo.month_end), 0)::numeric
   / 1e9) as storage_gb,
  (select count(*) from public.attendance a
     where a.org_id = mo.org_id and a.date >= mo.month_start and a.date < mo.month_end)::int as check_ins,
  (select count(distinct lp.attendance_id) from public.location_points lp
     where lp.org_id = mo.org_id and lp.at >= mo.month_start and lp.at < mo.month_end)::int as tracking_sessions,
  (select count(*) from public.location_points lp
     where lp.org_id = mo.org_id and lp.at >= mo.month_start and lp.at < mo.month_end)::bigint as location_points,
  (select count(*) from public.work_updates w
     where w.org_id = mo.org_id and w.at >= mo.month_start and w.at < mo.month_end)::int as work_updates,
  0::bigint as api_calls,
  0::int as report_runs,
  (select count(distinct (n.author_id, n.created_at::date)) from public.project_notes n
     join people p on p.id = n.author_id and p.role in ('manager', 'admin')
    where n.org_id = mo.org_id and n.created_at >= mo.month_start and n.created_at < mo.month_end)::int
    as active_manager_days,
  (select count(*) from public.attendance a
     where a.org_id = mo.org_id and a.date >= mo.month_start and a.date < mo.month_end
       and (a.check_in->>'geofenceStatus' = 'unknown' or a.check_out->>'geofenceStatus' = 'unknown'))::int
    as gps_errors
from months mo;

comment on view public.usage_live is
  'usage_snapshots, computed from the operational tables at read time: one row per organisation per month, under the caller''s own row-level policies.';

grant select on public.usage_live to authenticated;
