-- Per-project tracking policy, and the premise kind that makes its checkout
-- rule expressible.
--
-- A project can now say that on-site movement is not recorded at all: the
-- trail begins when a worker leaves the boundary and ends at checkout. That
-- policy only holds together if the shift can be closed somewhere known, so
-- a premise is marked as a site or an office and checkout is accepted at any
-- premise the worker is assigned to.
--
-- Both columns are NOT NULL with defaults that reproduce today's behaviour,
-- so existing rows keep recording the full shift and nothing changes for a
-- project nobody has reconfigured.

create type premise_kind as enum ('site', 'office');
create type tracking_mode as enum ('full-shift', 'outside-only');

alter table projects
  add column kind          premise_kind  not null default 'site',
  add column tracking_mode tracking_mode not null default 'full-shift';

comment on column projects.tracking_mode is
  'full-shift: record from check-in to checkout. outside-only: record nothing '
  'inside the geofence; start at the boundary crossing and run until checkout, '
  'which is then only accepted inside an assigned premise.';

-- Under outside-only a trail is a series of separate excursions. The gap
-- between them is time nobody observed, so the distance across it is not
-- travel that was measured and the route must not be drawn through it.
alter table location_points
  add column segment_start boolean not null default false;

comment on column location_points.segment_start is
  'First fix of a new stretch of recording. Consumers must break the polyline '
  'here and must not accumulate distance from the preceding point.';

-- Finding a worker's premises is now on the checkout path, which runs while
-- someone is standing in a car park waiting for the button to work.
create index on projects (org_id, kind);
