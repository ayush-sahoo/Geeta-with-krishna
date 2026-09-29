-- Only accounts created in the last hour are tagged with a signup source (the
-- same final definition is in 20260928124625_visit_city.sql).

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
