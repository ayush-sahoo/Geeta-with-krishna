-- First-party analytics for the admin dashboard.
-- The site records its own page visits and key funnel events (crawlers don't
-- run JavaScript, so bot traffic is excluded by construction), and each new
-- account is tagged with the ad/UTM source of the visitor who created it.
-- Tables are only reachable through the functions below; direct API access
-- is closed by RLS with no policies.

create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  visitor_id text not null,
  created_at timestamptz not null default now(),
  path text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  has_fbclid boolean not null default false,
  in_app text,
  device text,
  country text,
  user_agent text
);
create index if not exists site_visits_created_idx on public.site_visits (created_at desc);
create index if not exists site_visits_visitor_idx on public.site_visits (visitor_id, created_at);
alter table public.site_visits enable row level security;

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  visitor_id text not null,
  user_id uuid,
  created_at timestamptz not null default now(),
  event text not null
);
create index if not exists site_events_created_idx on public.site_events (created_at desc);
create index if not exists site_events_event_idx on public.site_events (event, created_at desc);
alter table public.site_events enable row level security;

alter table public.user_accounts
  add column if not exists signup_visitor_id text,
  add column if not exists signup_source jsonb;

-- Record one page visit. Callable by anyone; inputs are length-limited and the
-- country and user agent come from the request headers, not the caller.
create or replace function public.log_visit(
  p_visitor_id text, p_path text default null, p_referrer text default null,
  p_utm_source text default null, p_utm_medium text default null,
  p_utm_campaign text default null, p_utm_content text default null,
  p_has_fbclid boolean default false, p_in_app text default null, p_device text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare h json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
begin
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 64 then return; end if;
  insert into site_visits (visitor_id, path, referrer, utm_source, utm_medium, utm_campaign, utm_content,
                           has_fbclid, in_app, device, country, user_agent)
  values (p_visitor_id, left(p_path, 200), left(p_referrer, 300), left(p_utm_source, 100), left(p_utm_medium, 100),
          left(p_utm_campaign, 150), left(p_utm_content, 150), coalesce(p_has_fbclid, false),
          left(p_in_app, 30), left(p_device, 30), left(h->>'cf-ipcountry', 8), left(h->>'user-agent', 400));
end $$;

-- Record a funnel event (signin_start, signup, checkout_click, ...).
create or replace function public.log_event(p_visitor_id text, p_event text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 64 then return; end if;
  if p_event not in ('signin_start', 'google_click', 'google_blocked_in_app', 'open_in_browser',
                     'signup', 'login', 'checkout_click', 'ask_krishna', 'open_verse', 'paywall_view') then return; end if;
  insert into site_events (visitor_id, user_id, event) values (p_visitor_id, auth.uid(), p_event);
end $$;

-- Tag the signed-in user's account with the source of their first visit.
-- Only fills an empty tag, so a later login never overwrites attribution.
create or replace function public.set_my_attribution(p_visitor_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare src jsonb;
begin
  if auth.uid() is null or p_visitor_id is null or length(p_visitor_id) > 64 then return; end if;
  select jsonb_build_object('utm_source', v.utm_source, 'utm_medium', v.utm_medium, 'utm_campaign', v.utm_campaign,
           'utm_content', v.utm_content, 'has_fbclid', v.has_fbclid, 'referrer', v.referrer, 'in_app', v.in_app,
           'device', v.device, 'country', v.country, 'first_visit_at', v.created_at)
    into src
    from site_visits v where v.visitor_id = p_visitor_id order by v.created_at asc limit 1;
  update user_accounts set
    signup_visitor_id = p_visitor_id,
    signup_source = coalesce(src, jsonb_build_object('first_visit_at', null))
  where user_id = auth.uid() and signup_visitor_id is null;
end $$;

revoke all on function public.log_visit(text, text, text, text, text, text, text, boolean, text, text) from public;
revoke all on function public.log_event(text, text) from public;
revoke all on function public.set_my_attribution(text) from public;
grant execute on function public.log_visit(text, text, text, text, text, text, text, boolean, text, text) to anon, authenticated;
grant execute on function public.log_event(text, text) to anon, authenticated;
grant execute on function public.set_my_attribution(text) to authenticated;
