-- ============================================================================
-- "Management only" notes mean admins, not managers.
--
-- The visibility option is labelled "Owners, admins and payroll. Not managers
-- on site." — but the policy resolved it with is_org_admin(), which counts
-- managers too. So a site supervisor could read a retention dispute or a
-- payment note that the interface had just promised them they could not see.
--
-- Caught by impersonating each role against the live policy rather than by
-- reading it: the site engineer came back with three notes where the design
-- called for two.
-- ============================================================================

drop policy if exists notes_read on project_notes;

create policy notes_read on project_notes
  for select using (
    is_superadmin()
    or (
      org_id = auth_org_id()
      and (
        author_id = (select id from auth_user())
        or is_org_owner()
        or case visibility
             -- Admins only. is_org_owner() is role = 'admin'; is_org_admin()
             -- would let managers in, which is the bug this replaces.
             when 'management'         then is_org_owner()
             when 'managers-engineers' then is_org_admin() or is_site_engineer(project_id)
             when 'project-team'       then
               is_org_admin()
               or exists (
                 select 1 from project_members pm
                 where pm.project_id = project_notes.project_id
                   and pm.user_id = (select id from auth_user())
               )
             when 'selected'           then (select id from auth_user()) = any (visible_to)
             else is_org_owner()
           end
      )
    )
  );
