-- Checkout steps for the admin dashboard: the plan chosen (card tap and the
-- plan bought), the Razorpay window opening, closed without paying, failing to
-- open, the server failing to create the checkout, a failed payment attempt,
-- and the fallback redirect to the hosted payment page.
create or replace function public.log_event(p_visitor_id text, p_event text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 64 then return; end if;
  if p_event not in ('signin_start', 'google_click', 'google_blocked_in_app', 'open_in_browser',
                     'signup', 'login', 'checkout_click', 'ask_krishna', 'open_verse', 'play_verse', 'paywall_view',
                     'plan_annual', 'plan_quarterly', 'checkout_annual', 'checkout_quarterly',
                     'checkout_open', 'checkout_dismiss', 'checkout_open_failed', 'checkout_create_failed',
                     'checkout_payment_failed', 'checkout_redirect',
                     'tap_hero_ask', 'tap_hero_read', 'tap_offer_free', 'tap_daily_verse', 'tap_topic',
                     'tap_prompt', 'tap_nav_ask', 'tap_nav_explore', 'tap_sign_in', 'ask_typing',
                     'scroll_half', 'scroll_end', 'stay_15s', 'stay_45s') then return; end if;
  insert into site_events (visitor_id, user_id, event) values (p_visitor_id, auth.uid(), p_event);
end $$;
