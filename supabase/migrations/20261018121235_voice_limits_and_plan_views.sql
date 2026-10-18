-- One bounded row per account. No direct client access; the server reserves usage.
create table public.voice_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day_start timestamptz not null,
  minute_start timestamptz not null,
  day_calls integer not null default 0,
  minute_calls integer not null default 0,
  day_units integer not null default 0
);
alter table public.voice_usage enable row level security;
revoke all on public.voice_usage from public, anon, authenticated;

create function public.claim_voice_budget(p_user_id uuid, p_units integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v public.voice_usage%rowtype;
begin
  if p_user_id is null or p_units is null or p_units < 1 or p_units > 12000 then return false; end if;
  insert into public.voice_usage(user_id,day_start,minute_start)
    values(p_user_id,date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC',v_now)
    on conflict do nothing;
  select * into v from public.voice_usage where user_id=p_user_id for update;
  if v.day_start < (date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC') then
    v.day_start := date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
    v.day_calls := 0; v.day_units := 0;
  end if;
  if v.minute_start <= v_now - interval '1 minute' then
    v.minute_start := v_now; v.minute_calls := 0;
  end if;
  if v.minute_calls >= 40 or v.day_calls >= 600 or v.day_units + p_units > 120000 then return false; end if;
  update public.voice_usage set day_start=v.day_start, minute_start=v.minute_start,
    day_calls=v.day_calls+1, minute_calls=v.minute_calls+1, day_units=v.day_units+p_units
    where user_id=p_user_id;
  return true;
end $$;
revoke all on function public.claim_voice_budget(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_voice_budget(uuid,integer) to service_role;

-- Talk to Krishna: count opening the Talk section (talk_open) and spoken questions (talk_turn).
create or replace function public.log_event(p_visitor_id text, p_event text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 64 then return; end if;
  if p_event not in ('signin_start', 'google_click', 'google_blocked_in_app', 'open_in_browser',
                     'signup', 'login', 'checkout_click', 'ask_krishna', 'open_verse', 'play_verse', 'paywall_view',
                     'plan_annual', 'plan_monthly', 'checkout_annual', 'checkout_monthly',
                     'plan_quarterly', 'checkout_quarterly',
                     'checkout_open', 'checkout_dismiss', 'checkout_open_failed', 'checkout_create_failed',
                     'checkout_payment_failed', 'checkout_redirect',
                     'tap_hero_ask', 'tap_hero_read', 'tap_offer_free', 'tap_daily_verse', 'tap_topic',
                     'tap_prompt', 'tap_nav_ask', 'tap_nav_explore', 'tap_sign_in', 'ask_typing',
                     'scroll_half', 'scroll_end', 'stay_15s', 'stay_45s', 'hear_krishna', 'plan_view',
                     'talk_open', 'talk_turn') then return; end if;
  insert into site_events (visitor_id, user_id, event) values (p_visitor_id, auth.uid(), p_event);
end $$;
