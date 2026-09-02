-- A boundary with a negative radius admits nobody.
--
-- Attendance is decided by whether someone stands inside the boundary, so a
-- radius of -500 is not a smaller site: it is a site nobody can ever check in
-- to, and nothing says so. The check-in button simply refuses, all day, for
-- everyone, and the reason is a number in a JSON column that no screen shows.
--
-- Only admins can edit projects, so this was never a way in — it is a way to
-- break a site by accident and spend a morning working out why.
--
-- Written to tolerate the shapes that legitimately have no radius: a polygon
-- boundary carries its points instead, and the constraint only has an opinion
-- when a radius is actually present.

alter table public.projects
  drop constraint if exists projects_geofence_radius_positive;

alter table public.projects
  add constraint projects_geofence_radius_positive
  check (
    geofence is null
    or (geofence->>'radius') is null
    or (geofence->>'radius')::numeric > 0
  );

comment on constraint projects_geofence_radius_positive on public.projects is
  'A circular boundary needs a positive radius; a non-positive one admits nobody.';
