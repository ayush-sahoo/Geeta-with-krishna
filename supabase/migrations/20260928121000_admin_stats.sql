-- Report for the admin dashboard. Only the service role can call it; the
-- admin-stats edge function checks the caller is an admin first.
create or replace function public.admin_stats(p_since timestamptz, p_exclude uuid[] default '{}')
returns jsonb
language sql stable security definer set search_path = public, auth
as $$
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
first_touch as (select * from src where rn = 1)
select jsonb_build_object(
  'tracking_since', (select min(created_at) from site_visits),
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
  'timeline', coalesce((select jsonb_agg(x order by x.t) from (
      select date_trunc('hour', created_at) t, count(distinct visitor_id) visitors from v group by 1) x), '[]'::jsonb),
  'users', coalesce((select jsonb_agg(x order by x.signed_up_at desc) from (
      select u2.id, u2.email, u2.raw_user_meta_data->>'full_name' as name,
        u2.raw_app_meta_data->>'provider' as provider, u2.created_at as signed_up_at, u2.last_sign_in_at,
        a.plan_status, a.payment_status, a.access_expires_at, a.purchased_at, a.amount_paid_paise, a.signup_source,
        (select count(*) from payment_transactions t2 where t2.user_id = u2.id) as checkouts,
        (u2.id = any(p_exclude)) as is_test
      from auth.users u2 left join user_accounts a on a.user_id = u2.id
      order by u2.created_at desc limit 500) x), '[]'::jsonb)
);
$$;

revoke all on function public.admin_stats(timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_stats(timestamptz, uuid[]) to service_role;
