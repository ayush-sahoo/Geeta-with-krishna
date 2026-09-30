-- Engagement events, to see where ad visitors stop: taps on the home page and
-- Ask screen, starting to type a question, scroll depth and time on page.
-- Each is logged at most once per page load by app.js. First-party only.
create or replace function public.log_event(p_visitor_id text, p_event text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 64 then return; end if;
  if p_event not in ('signin_start', 'google_click', 'google_blocked_in_app', 'open_in_browser',
                     'signup', 'login', 'checkout_click', 'ask_krishna', 'open_verse', 'paywall_view',
                     'tap_hero_ask', 'tap_hero_read', 'tap_offer_free', 'tap_daily_verse', 'tap_topic',
                     'tap_prompt', 'tap_nav_ask', 'tap_nav_explore', 'tap_sign_in', 'ask_typing',
                     'scroll_half', 'scroll_end', 'stay_15s', 'stay_45s') then return; end if;
  insert into site_events (visitor_id, user_id, event) values (p_visitor_id, auth.uid(), p_event);
end $$;
