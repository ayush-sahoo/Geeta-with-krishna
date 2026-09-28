-- City/region for page visits (from the site's /api/geo, IP-based), and only
-- tag *new* accounts with a first-visit source: an account created before
-- tracking started must not be credited to a visit from today.

alter table public.site_visits add column if not exists region text, add column if not exists city text;

drop function if exists public.log_visit(text, text, text, text, text, text, text, boolean, text, text);
create or replace function public.log_visit(
  p_visitor_id text, p_path text default null, p_referrer text default null,
  p_utm_source text default null, p_utm_medium text default null,
  p_utm_campaign text default null, p_utm_content text default null,
  p_has_fbclid boolean default false, p_in_app text default null, p_device text default null,
  p_region text default null, p_city text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare h json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
begin
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 64 then return; end if;
  insert into site_visits (visitor_id, path, referrer, utm_source, utm_medium, utm_campaign, utm_content,
                           has_fbclid, in_app, device, country, user_agent, region, city)
  values (p_visitor_id, left(p_path, 200), left(p_referrer, 300), left(p_utm_source, 100), left(p_utm_medium, 100),
          left(p_utm_campaign, 150), left(p_utm_content, 150), coalesce(p_has_fbclid, false),
          left(p_in_app, 30), left(p_device, 30), left(h->>'cf-ipcountry', 8), left(h->>'user-agent', 400),
          left(p_region, 80), left(p_city, 80));
end $$;
revoke all on function public.log_visit(text, text, text, text, text, text, text, boolean, text, text, text, text) from public;
grant execute on function public.log_visit(text, text, text, text, text, text, text, boolean, text, text, text, text) to anon, authenticated;

create or replace function public.set_my_attribution(p_visitor_id text)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare src jsonb;
begin
  if auth.uid() is null or p_visitor_id is null or length(p_visitor_id) > 64 then return; end if;
  -- Only just-created accounts (sign-up tags within seconds; 1h covers the
  -- in-app -> Chrome hand-off). Older accounts predate or aren't from this visit.
  if not exists (select 1 from auth.users where id = auth.uid() and created_at > now() - interval '1 hour') then return; end if;
  select jsonb_build_object('utm_source', v.utm_source, 'utm_medium', v.utm_medium, 'utm_campaign', v.utm_campaign,
           'utm_content', v.utm_content, 'has_fbclid', v.has_fbclid, 'referrer', v.referrer, 'in_app', v.in_app,
           'device', v.device, 'country', v.country, 'region', v.region, 'city', v.city, 'first_visit_at', v.created_at)
    into src
    from site_visits v where v.visitor_id = p_visitor_id order by v.created_at asc limit 1;
  update user_accounts set
    signup_visitor_id = p_visitor_id,
    signup_source = coalesce(src, jsonb_build_object('first_visit_at', null))
  where user_id = auth.uid() and signup_visitor_id is null;
end $$;
revoke all on function public.set_my_attribution(text) from public;
grant execute on function public.set_my_attribution(text) to authenticated;
