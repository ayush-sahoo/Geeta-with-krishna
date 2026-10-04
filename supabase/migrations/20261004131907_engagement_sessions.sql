-- Engagement for the admin dashboard: who tried the free chat, who tried to
-- open or listen to a shloka, and how long people actually spend on the site.
--
-- site_sessions: one row per page load. app.js reports the seconds the page has
-- been visible every 30 s and when the tab is hidden, so a session's length is
-- the time someone was actually looking at it (not a tab left open).
create table if not exists public.site_sessions (
  session_id text primary key,
  visitor_id text not null,
  user_id uuid,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active_seconds integer not null default 0
);
create index if not exists site_sessions_started_idx on public.site_sessions (started_at desc);
create index if not exists site_sessions_visitor_idx on public.site_sessions (visitor_id);
alter table public.site_sessions enable row level security;

create or replace function public.log_session(p_session_id text, p_visitor_id text, p_seconds integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_session_id is null or length(p_session_id) < 8 or length(p_session_id) > 64 then return; end if;
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 64 then return; end if;
  if p_seconds is null or p_seconds < 0 then return; end if;
  insert into site_sessions (session_id, visitor_id, user_id, active_seconds)
  values (p_session_id, p_visitor_id, auth.uid(), least(p_seconds, 14400))
  on conflict (session_id) do update
    set active_seconds = greatest(site_sessions.active_seconds, least(excluded.active_seconds, 14400)),
        last_seen_at = now(),
        user_id = coalesce(excluded.user_id, site_sessions.user_id)
    -- A session id belongs to the visitor that started it.
    where site_sessions.visitor_id = excluded.visitor_id;
end $$;
revoke all on function public.log_session(text, text, integer) from public;
grant execute on function public.log_session(text, text, integer) to anon, authenticated;

-- play_verse: tapped the play button on a verse (the shloka chant + meaning).
-- open_verse (already allowed) is now logged when someone taps a verse, even
-- if they are shown the plans instead.
create or replace function public.log_event(p_visitor_id text, p_event text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 64 then return; end if;
  if p_event not in ('signin_start', 'google_click', 'google_blocked_in_app', 'open_in_browser',
                     'signup', 'login', 'checkout_click', 'ask_krishna', 'open_verse', 'play_verse', 'paywall_view',
                     'tap_hero_ask', 'tap_hero_read', 'tap_offer_free', 'tap_daily_verse', 'tap_topic',
                     'tap_prompt', 'tap_nav_ask', 'tap_nav_explore', 'tap_sign_in', 'ask_typing',
                     'scroll_half', 'scroll_end', 'stay_15s', 'stay_45s') then return; end if;
  insert into site_events (visitor_id, user_id, event) values (p_visitor_id, auth.uid(), p_event);
end $$;

-- admin_stats gains:
--   engagement: people who tried the free chat / opened a verse / played a
--     shloka, and time on site (median, average, share over 1 and 3 minutes)
--     for everyone and for each of those groups;
--   engaged: the latest 200 visitors who tried the chat or a verse, with what
--     they did, how long they stayed, where they came from and whether they
--     signed up or paid.
-- Test accounts (p_exclude) and the browsers they used are left out of both.
create or replace function public.admin_stats(p_since timestamptz, p_exclude uuid[] default '{}'::uuid[])
returns jsonb
language sql stable security definer
set search_path to 'public', 'auth'
as $function$
with
v as (select * from site_visits where created_at >= p_since),
e as (select * from site_events where created_at >= p_since),
u as (select * from auth.users where created_at >= p_since and not (id = any(p_exclude))),
t as (select * from payment_transactions where created_at >= p_since and not (user_id = any(p_exclude))),
p as (select * from payment_transactions where status = 'paid' and paid_at >= p_since and not (user_id = any(p_exclude))),
src as (
  select visitor_id,
    coalesce(nullif(utm_source, ''),
             case when has_fbclid then 'facebook (ad click)' end,
             case when in_app is not null then lower(in_app) || ' app' end,
             nullif(split_part(split_part(referrer, '://', 2), '/', 1), ''),
             'direct') as source,
    coalesce(nullif(utm_campaign, ''), '(none)') as campaign,
    coalesce(nullif(utm_content, ''), '(none)') as ad,
    row_number() over (partition by visitor_id order by created_at) as rn
  from v
),
first_touch as (select * from src where rn = 1),
test_visitors as (
  select visitor_id from site_events where user_id = any(p_exclude)
  union select visitor_id from site_sessions where user_id = any(p_exclude)
  union select signup_visitor_id from user_accounts where user_id = any(p_exclude) and signup_visitor_id is not null
),
people as (
  select visitor_id,
    count(*) filter (where event = 'ask_krishna') as asked,
    bool_or(event = 'open_verse') as opened_verse,
    bool_or(event = 'play_verse') as played,
    max(created_at) as last_at
  from e where visitor_id not in (select visitor_id from test_visitors)
  group by visitor_id
),
sess as (
  select visitor_id, sum(active_seconds) as seconds, count(*) as sessions
  from site_sessions
  where started_at >= p_since and visitor_id not in (select visitor_id from test_visitors)
  group by visitor_id
),
pv as (
  select s.visitor_id, s.seconds, coalesce(pe.asked, 0) > 0 as asked, coalesce(pe.opened_verse, false) as opened, coalesce(pe.played, false) as played
  from sess s left join people pe using (visitor_id)
),
seg as (
  select 'all' as grp, * from pv
  union all select 'asked', * from pv where asked
  union all select 'opened_verse', * from pv where opened
  union all select 'played', * from pv where played
  union all select 'neither', * from pv where not asked and not opened and not played
)
select jsonb_build_object(
  'tracking_since', (select min(created_at) from site_visits),
  'sessions_since', (select min(started_at) from site_sessions),
  'funnel', jsonb_build_object(
    'visitors', (select count(distinct visitor_id) from v),
    'page_views', (select count(*) from v),
    'signin_start', (select count(distinct visitor_id) from e where event in ('signin_start', 'google_click')),
    'signups', (select count(*) from u),
    'checkout', (select count(distinct user_id) from t),
    'purchases', (select count(*) from p),
    'revenue_paise', (select coalesce(sum(amount_paise), 0) from p)
  ),
  'events', coalesce((select jsonb_object_agg(event, n) from (select event, count(distinct visitor_id) n from e group by event) x), '{}'::jsonb),
  'engagement', jsonb_build_object(
    'asked', (select count(*) from people where asked > 0),
    'questions', (select coalesce(sum(asked), 0) from people),
    'opened_verse', (select count(*) from people where opened_verse),
    'played', (select count(*) from people where played),
    'groups', coalesce((select jsonb_object_agg(grp, x) from (
        select grp, jsonb_build_object(
          'people', count(*),
          'median_s', round(percentile_cont(0.5) within group (order by seconds)),
          'avg_s', round(avg(seconds)),
          'over_1m', count(*) filter (where seconds >= 60),
          'over_3m', count(*) filter (where seconds >= 180)) x
        from seg group by grp) g), '{}'::jsonb)
  ),
  'engaged', coalesce((select jsonb_agg(x order by x.last_at desc) from (
      select pe.visitor_id, pe.last_at, pe.asked, pe.opened_verse, pe.played,
        s.seconds, s.sessions,
        ft.source, ft.campaign,
        (select jsonb_build_object('city', v2.city, 'region', v2.region, 'country', v2.country, 'device', v2.device, 'in_app', v2.in_app)
           from site_visits v2 where v2.visitor_id = pe.visitor_id order by v2.created_at limit 1) as place,
        a.email, a.phone, a.payment_status,
        (a.user_id is not null) as signed_up
      from people pe
      left join sess s using (visitor_id)
      left join first_touch ft using (visitor_id)
      left join lateral (
        select ua.user_id, ua.email, ua.phone, ua.payment_status from user_accounts ua
        where ua.signup_visitor_id = pe.visitor_id
           or ua.user_id = (select e2.user_id from site_events e2 where e2.visitor_id = pe.visitor_id and e2.user_id is not null order by e2.created_at desc limit 1)
        order by ua.created_at limit 1) a on true
      where pe.asked > 0 or pe.opened_verse or pe.played
      order by pe.last_at desc limit 200) x), '[]'::jsonb),
  'sources', coalesce((select jsonb_agg(x order by x.visitors desc) from (
      select ft.source, count(*) visitors,
        count(a.user_id) filter (where a.created_at >= p_since) signups,
        count(a.user_id) filter (where a.payment_status = 'paid') paid
      from first_touch ft left join user_accounts a on a.signup_visitor_id = ft.visitor_id and not (a.user_id = any(p_exclude))
      group by ft.source) x), '[]'::jsonb),
  'campaigns', coalesce((select jsonb_agg(x order by x.visitors desc) from (
      select ft.campaign, ft.ad, count(*) visitors,
        count(a.user_id) signups, count(a.user_id) filter (where a.payment_status = 'paid') paid
      from first_touch ft left join user_accounts a on a.signup_visitor_id = ft.visitor_id and not (a.user_id = any(p_exclude))
      where ft.campaign <> '(none)' or ft.ad <> '(none)'
      group by ft.campaign, ft.ad) x), '[]'::jsonb),
  'browsers', coalesce((select jsonb_agg(x order by x.visitors desc) from (
      select coalesce(in_app, case device when 'android' then 'Android browser' when 'ios' then 'iPhone browser' else 'Desktop' end) browser,
             count(distinct visitor_id) visitors from v group by 1) x), '[]'::jsonb),
  'countries', coalesce((select jsonb_agg(x order by x.visitors desc) from (
      select coalesce(country, '??') country, count(distinct visitor_id) visitors from v group by 1 order by 2 desc limit 8) x), '[]'::jsonb),
  'cities', coalesce((select jsonb_agg(x order by x.visitors desc) from (
      select city, region, country, count(distinct visitor_id) visitors from v where city is not null
      group by 1, 2, 3 order by 4 desc limit 12) x), '[]'::jsonb),
  'timeline', coalesce((select jsonb_agg(x order by x.t) from (
      select date_trunc('hour', created_at) t, count(distinct visitor_id) visitors from v group by 1) x), '[]'::jsonb),
  'users', coalesce((select jsonb_agg(x order by x.signed_up_at desc) from (
      select u2.id, u2.email, u2.phone, u2.raw_user_meta_data->>'full_name' as name,
        u2.raw_app_meta_data->>'provider' as provider, u2.created_at as signed_up_at, u2.last_sign_in_at,
        a.plan_status, a.payment_status, a.access_expires_at, a.purchased_at, a.amount_paid_paise, a.signup_source,
        (select count(*) from payment_transactions t2 where t2.user_id = u2.id) as checkouts,
        (u2.id = any(p_exclude)) as is_test
      from auth.users u2 left join user_accounts a on a.user_id = u2.id
      order by u2.created_at desc limit 500) x), '[]'::jsonb)
);
$function$;
revoke all on function public.admin_stats(timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_stats(timestamptz, uuid[]) to service_role;
