-- Notifications everywhere, as each person chooses.
--
-- Every notification already became a row in public.notifications — written
-- by the phone that saw the event, or by the database in the same
-- transaction as the change. Nothing else happened to it: the people it was
-- for learned of it at their next refresh, which for a manager waiting on a
-- crew's check-ins could be hours, and never if the app was closed.
--
-- Now each new row fans out twice, from a trigger on that table:
--
--   * live, over Realtime Broadcast, to the open app and site of everyone it
--     is for — on private channels, per company and role and per person,
--     authorised by the policy on realtime.messages below;
--
--   * pushed, through the `push` edge function (called by pg_net), to every
--     device those people have registered: browsers by Web Push, Android by
--     Firebase, iOS by Apple. Each person's own preference for that kind of
--     event decides whether their devices hear about it at all.
--
-- Preferences live on the person (profiles.notification_prefs) so they hold
-- on every device and so the push function, which has no app in front of it,
-- reads the same answer the app does.

create extension if not exists pg_net with schema extensions;

-- Where each notification came from, kept by the database:
--
--   raised_by    whose session wrote it — the bound on how many pushes one
--                person can set off;
--   inserted_at  when it reached the server, which the client cannot choose
--                (`at` is when the event happened on the device, and is the
--                device's to say);
--   from_client  written through the API, rather than by one of the
--                database's own functions — only those are rate-bounded;
--   raised_on    the device that raised it, as its push endpoint, so the
--                push is not sent back to the device that already showed it.
--                The client's to say, and harmless if it lies: it can only
--                keep its own row off one device.
alter table public.notifications
  add column if not exists raised_by   uuid,
  add column if not exists inserted_at timestamptz not null default now(),
  add column if not exists from_client boolean not null default false,
  add column if not exists raised_on   text;

create index if not exists notifications_raised_recent_idx
  on public.notifications (raised_by, inserted_at desc) where from_client;

-- Stamped on every insert whatever the client sent, and never changed after.
-- Security invoker on purpose: current_user is the API's role for a client
-- insert, and the owning role inside a security-definer function.
create or replace function private.stamp_notification()
 returns trigger
 language plpgsql
 set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    new.raised_by   := auth.uid();
    new.inserted_at := clock_timestamp();
    new.from_client := current_user in ('authenticated', 'anon');
    new.raised_on   := left(new.raised_on, 2048);
  else
    new.raised_by   := old.raised_by;
    new.inserted_at := old.inserted_at;
    new.from_client := old.from_client;
    new.raised_on   := old.raised_on;
  end if;
  return new;
end
$$;

drop trigger if exists notifications_stamp on public.notifications;
create trigger notifications_stamp
  before insert or update on public.notifications
  for each row execute function private.stamp_notification();

-- ------------------------------------------------------- 1. preferences --

alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- The category of each kind. Must agree with src/lib/notification-prefs.ts;
-- an unknown kind is "system", which is shown in the feed and kept off
-- devices unless asked for.
create or replace function private.notification_category(p_kind text)
 returns text
 language sql
 immutable
 set search_path to ''
as $$
  select case
    when p_kind in ('check-in', 'check-out', 'late-check-in', 'missing-checkout') then 'attendance'
    when p_kind in ('geofence-exit', 'tracking-interrupted', 'low-accuracy', 'tracking-started') then 'tracking'
    when p_kind = 'work-update' then 'work'
    when p_kind in ('member-invited', 'member-joined', 'member-removed', 'member-restored',
                    'invitation-declined', 'company-renamed', 'company-updated',
                    'project-assigned') then 'team'
    when p_kind = 'reminder' then 'reminders'
    else 'system'
  end
$$;

-- Whether this person's devices should hear about this kind of event. With
-- nothing stored, everything but system chatter does. Anything stored that is
-- not a boolean counts as nothing stored: profiles can be written directly by
-- their owner, and one malformed value must not fail push_recipients — and
-- with it the push — for everyone else the notification is for.
create or replace function private.wants_device(p_prefs jsonb, p_kind text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $$
  select case
    when jsonb_typeof(p_prefs #> array['categories', private.notification_category(p_kind), 'device']) = 'boolean'
      then (p_prefs #>> array['categories', private.notification_category(p_kind), 'device'])::boolean
    else private.notification_category(p_kind) <> 'system'
  end
$$;

create or replace function public.my_notification_prefs()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select coalesce(
    (select notification_prefs from public.profiles where auth_id = (select auth.uid())),
    '{}'::jsonb)
$$;

-- One switch at a time. Saving the whole object let a device that had not
-- yet heard the server's copy — offline at launch, or open for days — write
-- its stale values back over choices made on another device. Only the switch
-- that was touched is written; the rest stays as stored.
create or replace function public.set_my_notification_pref(
  p_category text, p_channel text, p_value boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  me     uuid := auth.uid();
  stored jsonb;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if p_category is null
     or p_category not in ('attendance', 'tracking', 'work', 'team', 'reminders', 'system')
     or p_channel is null or p_channel not in ('inApp', 'device')
     or p_value is null then
    raise exception 'not a notification preference' using errcode = '22023';
  end if;

  insert into public.profiles (auth_id, name, notification_prefs, updated_at)
  values (me, '',
          jsonb_build_object('categories',
            jsonb_build_object(p_category, jsonb_build_object(p_channel, p_value))),
          now())
  on conflict (auth_id) do update
     set notification_prefs = jsonb_set(
           jsonb_set(
             case when jsonb_typeof(public.profiles.notification_prefs -> 'categories') = 'object'
                  then public.profiles.notification_prefs
                  else jsonb_build_object('categories', '{}'::jsonb) end,
             array['categories', p_category],
             case when jsonb_typeof(public.profiles.notification_prefs -> 'categories' -> p_category) = 'object'
                  then public.profiles.notification_prefs -> 'categories' -> p_category
                  else '{}'::jsonb end),
           array['categories', p_category, p_channel],
           to_jsonb(p_value)),
         updated_at = now()
  returning notification_prefs into stored;
  return stored;
end
$$;

revoke execute on function public.my_notification_prefs() from public, anon;
revoke execute on function public.set_my_notification_pref(text, text, boolean) from public, anon;
grant execute on function public.my_notification_prefs() to authenticated;
grant execute on function public.set_my_notification_pref(text, text, boolean) to authenticated;

-- ---------------------------------------------- 2. where to push, per device

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  auth_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null check (platform in ('web', 'fcm', 'apns')),
  -- A browser's push URL, or a phone's FCM / APNs token.
  endpoint     text not null unique,
  p256dh       text,
  auth_secret  text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_subscriptions_web_keys
    check (platform <> 'web' or (p256dh is not null and auth_secret is not null))
);

create index if not exists push_subscriptions_auth_idx on public.push_subscriptions (auth_id);

-- Nobody reads or writes this directly: devices register through the two
-- functions below, and only the push function, as the service role, reads it.
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- The push services browsers actually use. The push function sends a request
-- to whatever URL a subscription names, so only theirs are accepted — not
-- whatever address a client chooses to register.
create or replace function private.is_push_service_url(p_url text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $$
  select p_url ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
$$;

create or replace function public.register_push_subscription(
  p_platform   text,
  p_endpoint   text,
  p_p256dh     text default null,
  p_auth       text default null,
  p_user_agent text default null)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if p_platform not in ('web', 'fcm', 'apns')
     or coalesce(btrim(p_endpoint), '') = ''
     or length(p_endpoint) > 2048
     or (p_platform = 'web' and (not private.is_push_service_url(p_endpoint)
                                 or coalesce(p_p256dh, '') = ''
                                 or coalesce(p_auth, '') = ''))
     -- A phone's token is a token, not a path: hex from Apple, Firebase's
     -- own alphabet from Google.
     or (p_platform = 'apns' and p_endpoint !~ '^[0-9A-Fa-f]{64,200}$')
     or (p_platform = 'fcm' and p_endpoint !~ '^[A-Za-z0-9_:-]{32,}$') then
    raise exception 'not a push subscription' using errcode = '22023';
  end if;
  -- One device, one row: a phone that signs in as somebody else now pushes
  -- to them, not to whoever used it before.
  insert into public.push_subscriptions (auth_id, platform, endpoint, p256dh, auth_secret, user_agent)
  values (me, p_platform, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
     set auth_id      = excluded.auth_id,
         platform     = excluded.platform,
         p256dh       = excluded.p256dh,
         auth_secret  = excluded.auth_secret,
         user_agent   = excluded.user_agent,
         last_seen_at = now();
  -- Ten devices a person, the most recently seen. Nobody has more, and an
  -- unbounded list is a way to make every notification cost thousands of
  -- sends.
  delete from public.push_subscriptions s
   where s.auth_id = me
     and s.id not in (select k.id from public.push_subscriptions k
                       where k.auth_id = me
                       order by k.last_seen_at desc
                       limit 10);
end
$$;

create or replace function public.unregister_push_subscription(p_endpoint text)
 returns void
 language sql
 security definer
 set search_path to ''
as $$
  delete from public.push_subscriptions
   where endpoint = p_endpoint and auth_id = (select auth.uid());
$$;

revoke execute on function public.register_push_subscription(text, text, text, text, text) from public, anon;
revoke execute on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- ----------------------------------------------- 3. the push function's own

-- Where the push function lives, the secret the trigger proves itself with,
-- and the web-push signing keys — made by the function on first use, so the
-- private half is never typed, pasted or sent anywhere.
create table if not exists private.push_config (
  id             int primary key default 1 check (id = 1),
  function_url   text,
  trigger_secret text not null
                 default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  vapid_public   text,
  vapid_private  text,
  updated_at     timestamptz not null default now()
);
alter table private.push_config enable row level security;
revoke all on private.push_config from anon, authenticated;

-- This project's function. Another database running this migration (a branch,
-- a local stack) should point it at its own, or set it null to stay quiet;
-- the trigger skips the push when it is null.
insert into private.push_config (id, function_url)
values (1, 'https://fdxwxcwnzzcsnsxdhzjj.supabase.co/functions/v1/push')
on conflict (id) do nothing;

create or replace function public.push_vapid_public_key()
 returns text
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select vapid_public from private.push_config where id = 1
$$;

create or replace function public.push_service_config()
 returns table (vapid_public text, vapid_private text, trigger_secret text)
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select c.vapid_public, c.vapid_private, c.trigger_secret from private.push_config c where c.id = 1
$$;

-- First writer wins; both callers get the stored pair back.
create or replace function public.push_service_save_vapid(p_public text, p_private text)
 returns table (vapid_public text, vapid_private text, trigger_secret text)
 language plpgsql
 security definer
 set search_path to ''
as $$
#variable_conflict use_column
begin
  update private.push_config c
     set vapid_public = p_public, vapid_private = p_private, updated_at = now()
   where c.id = 1 and c.vapid_public is null;
  return query
    select c.vapid_public, c.vapid_private, c.trigger_secret from private.push_config c where c.id = 1;
end
$$;

-- Who a notification goes to and on which devices: the feed's own rule
-- (src/lib/notify.ts isForMe — the role must match, administrators also
-- reading the managers' feed, and a row that names a person goes to that
-- person only), live members only, each person's device preference for that
-- kind of event, and never back to the device that raised it: it already
-- showed it, and a phone cannot merge the two copies the way a browser does.
-- The raiser's other devices are pushed like anyone's — a reminder fired by
-- the laptop left open in the office must still reach the phone on site.
create or replace function public.push_recipients(p_notification uuid)
 returns table (
   subscription_id uuid, platform text, endpoint text, p256dh text, auth_secret text,
   notification_id uuid, title text, body text, link text, severity text, kind text)
 language sql
 stable
 security definer
 set search_path to ''
as $$
  -- Only what just happened. A phone that was offline all afternoon uploads
  -- its notifications in one go when it reconnects; those belong in the feed,
  -- not in a pocket hours after the fact.
  with n as (
    select * from public.notifications
     where id = p_notification
       and at > now() - interval '15 minutes'
       and at < now() + interval '5 minutes'
  ),
  people as (
    select distinct u.auth_id
      from n
      join public.users u on u.org_id = n.org_id
     where u.auth_id is not null
       and u.status not in ('revoked', 'inactive')
       and (n.user_id is null or u.id = n.user_id)
       and (u.role = n.audience
            or (n.audience = 'manager' and u.role in ('admin', 'superadmin')))
  )
  select s.id, s.platform, s.endpoint, s.p256dh, s.auth_secret,
         n.id, n.title, n.body, n.link, n.severity, n.kind
    from n
    join people p on true
    join public.push_subscriptions s on s.auth_id = p.auth_id
    left join public.profiles pr on pr.auth_id = p.auth_id
   where private.wants_device(coalesce(pr.notification_prefs, '{}'::jsonb), n.kind)
     and (s.platform <> 'web' or private.is_push_service_url(s.endpoint))
     and s.endpoint is distinct from n.raised_on
$$;

create or replace function public.push_subscriptions_gone(p_ids uuid[])
 returns void
 language sql
 security definer
 set search_path to ''
as $$
  delete from public.push_subscriptions where id = any(p_ids);
$$;

revoke execute on function public.push_service_config() from public, anon, authenticated;
revoke execute on function public.push_service_save_vapid(text, text) from public, anon, authenticated;
revoke execute on function public.push_recipients(uuid) from public, anon, authenticated;
revoke execute on function public.push_subscriptions_gone(uuid[]) from public, anon, authenticated;
grant execute on function public.push_service_config() to service_role;
grant execute on function public.push_service_save_vapid(text, text) to service_role;
grant execute on function public.push_recipients(uuid) to service_role;
grant execute on function public.push_subscriptions_gone(uuid[]) to service_role;
grant execute on function public.push_vapid_public_key() to anon, authenticated;

-- ------------------------------------------------- 4. what a row may say --

-- A notification's link opens a screen in this app — a path, never another
-- site. A tapped notification is a trusted surface, and '//elsewhere' would
-- turn it into a redirect. URL parsers drop tabs and newlines before they
-- look, so '/<tab>/elsewhere' is the same thing; no whitespace, control
-- character or backslash anywhere. Not validated against old rows; enforced
-- on new.
alter table public.notifications drop constraint if exists notifications_link_in_app;
alter table public.notifications
  add constraint notifications_link_in_app
  check (link is null
         or (link ~ '^/([^/\\]|$)' and link !~ '[[:cntrl:][:space:]\\]')) not valid;

-- Whether a membership belongs to a company — for the insert policy, which
-- cannot see other companies' rows itself.
create or replace function private.membership_in_org(p_user uuid, p_org uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select exists (select 1 from public.users u where u.id = p_user and u.org_id = p_org)
$$;
revoke execute on function private.membership_in_org(uuid, uuid) from public, anon;
grant execute on function private.membership_in_org(uuid, uuid) to authenticated;

-- A row may name a person only in its own company. Before live delivery this
-- was untidy rather than dangerous — the row sat in the writer's company,
-- where its person could not see it. Now a row naming a person is delivered
-- to them, so naming one from another company would reach across the wall.
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated
  with check (
    org_id = (select private.auth_org_id())
    and (user_id is null or private.membership_in_org(user_id, org_id))
  );

-- ------------------------------------------------------- 5. the fan-out --

create or replace function private.fan_out_notification()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  cfg   record;
  topic text;
begin
  -- A row naming a person goes to that person's own topic — but only when
  -- they are of the row's company. The insert policy already refuses any
  -- other; this holds even for rows written by functions that bypass it.
  topic := case
             when new.user_id is null
               then 'notify:o:' || new.org_id::text || ':' || new.audience::text
             when exists (select 1 from public.users u
                           where u.id = new.user_id and u.org_id = new.org_id)
               then 'notify:u:' || new.user_id::text
           end;

  -- Neither half may fail the insert: the notification is the record, and
  -- live delivery and push are only ways of hearing about it sooner.
  begin
    if topic is not null then
      perform realtime.send(
      jsonb_build_object(
        'id', new.id, 'org_id', new.org_id, 'audience', new.audience,
        'user_id', new.user_id, 'kind', new.kind, 'title', new.title,
        'body', new.body, 'severity', new.severity, 'link', new.link, 'at', new.at),
      'notification', topic, true);
    end if;
  exception when others then
    raise warning 'notification % not broadcast: %', new.id, sqlerrm;
  end;

  -- Pushed only when it just happened, and not as a flood. Nothing stale:
  -- an upload after a day offline belongs in the feed.
  if new.at < now() - interval '15 minutes' or new.at > now() + interval '5 minutes' then
    return null;
  end if;

  -- Rows written through the API come from members' own devices, so this is
  -- the bound on what one member can make other people's phones do: sixty a
  -- minute to any one recipient (a person, or a company's role), six hundred
  -- in all — room for a reminder to a crew of a few hundred, none for a
  -- flood. Counted by when rows reached the server, which the client cannot
  -- choose, and only rows before this one, so a burst is trimmed rather than
  -- lost whole. One member's writes are counted one transaction at a time, so
  -- parallel requests cannot each see an empty count. The database's own
  -- functions (assigning a crew of eighty to a site) are not bounded.
  if new.from_client then
    if new.raised_by is null then
      return null;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('notifications:' || new.raised_by::text, 0));
    if (select count(*) from (
          select 1 from public.notifications x
           where x.from_client
             and x.raised_by = new.raised_by
             and x.inserted_at > clock_timestamp() - interval '1 minute'
             and x.inserted_at < new.inserted_at
             and x.org_id = new.org_id
             and x.audience = new.audience
             and x.user_id is not distinct from new.user_id
           limit 60) recent) >= 60
       or (select count(*) from (
          select 1 from public.notifications x
           where x.from_client
             and x.raised_by = new.raised_by
             and x.inserted_at > clock_timestamp() - interval '1 minute'
             and x.inserted_at < new.inserted_at
           limit 600) recent) >= 600 then
      return null;
    end if;
  end if;

  begin
    select c.function_url, c.trigger_secret into cfg from private.push_config c where c.id = 1;
    if cfg.function_url is not null then
      perform net.http_post(
        url     := cfg.function_url,
        body    := jsonb_build_object('id', new.id),
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-push-secret', cfg.trigger_secret),
        timeout_milliseconds := 10000);
    end if;
  exception when others then
    raise warning 'notification % not pushed: %', new.id, sqlerrm;
  end;
  return null;
end
$$;

drop trigger if exists notifications_fan_out on public.notifications;
create trigger notifications_fan_out
  after insert on public.notifications
  for each row execute function private.fan_out_notification();

-- ------------------------------------------- 6. who may hear which topic --

-- Read in a policy, so it answers only about the caller — and reads the
-- memberships directly, because Realtime has no company header to give the
-- usual "active company" helpers.
create or replace function private.may_receive_topic(p_topic text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select exists (
    select 1
      from public.users u
     where u.auth_id = (select auth.uid())
       and u.status not in ('revoked', 'inactive')
       and (p_topic = 'notify:u:' || u.id::text
            or (u.org_id is not null
                and (p_topic = 'notify:o:' || u.org_id::text || ':' || u.role::text
                     or (u.role in ('admin', 'superadmin')
                         and p_topic = 'notify:o:' || u.org_id::text || ':manager'))))
  )
$$;

revoke execute on function private.may_receive_topic(text) from public, anon;
grant execute on function private.may_receive_topic(text) to authenticated;

drop policy if exists "workfence notifications: receive own topics" on realtime.messages;
create policy "workfence notifications: receive own topics"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'notify:%'
    and (select private.may_receive_topic((select realtime.topic())))
  );
