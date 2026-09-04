-- The product owner's seat, and a subscription for every company.
--
-- Born Creative runs the platform. The person behind hello@borncreative.in
-- signs in like anyone else — with Outlook, this week — and must arrive on
-- the platform screens rather than on a form for founding a company: every
-- client, every sign-in, every subscription and invoice, with the standing to
-- change them. That is the superadmin role. It belongs to no tenant
-- (users_org_required allows exactly this) and every platform policy already
-- recognises it; nobody held it.
--
-- Keyed on the address and linked to whichever auth account carries it, so
-- this can be re-run, and a re-created auth account re-links.
insert into public.users
  (auth_id, org_id, name, employee_code, role, designation, department,
   email, avatar_hue, status, shift_start, shift_end, joined_at)
select a.id, null, 'Born Creative', 'BC-0000', 'superadmin', 'Product Owner',
       'Platform', lower(a.email), 265, 'active', 540, 1080, now()
  from auth.users a
 where lower(a.email) = 'hello@borncreative.in'
   and not exists (
     select 1 from public.users u
      where u.role = 'superadmin' and lower(u.email) = 'hello@borncreative.in');

-- Whatever the identity provider already holds — photo, provider, last
-- sign-in — lands the same way it does for everyone else.
select private.sync_user_from_auth(a.id)
  from auth.users a
 where lower(a.email) = 'hello@borncreative.in';

-- A company without a subscription is a gap the seed left: the first tenant
-- was created before provisioning existed, and every screen that reads its
-- plan, limits or renewal finds nothing. Give it what provisioning would
-- have — the default plan, on the status the organisation already has — so
-- the platform owner has something to manage rather than a blank.
insert into subscriptions (org_id, plan_id, status, cycle, started_at, trial_ends_at, renews_at)
select o.id,
       coalesce(
         (select ps.settings->>'defaultPlanId' from platform_settings ps
           where ps.id = 1
             and exists (select 1 from plans p where p.id = ps.settings->>'defaultPlanId')),
         (select p.id from plans p where not p.archived order by p.monthly_price limit 1)),
       (case o.status
          when 'trial'        then 'trial'
          when 'suspended'    then 'suspended'
          when 'cancelled'    then 'cancelled'
          when 'payment-hold' then 'past-due'
          else 'active' end)::sub_status,
       'monthly'::billing_cycle,
       o.created_at,
       case when o.status = 'trial' then now() + interval '14 days' end,
       now() + interval '30 days'
  from organizations o
 where not exists (select 1 from subscriptions s where s.org_id = o.id);
