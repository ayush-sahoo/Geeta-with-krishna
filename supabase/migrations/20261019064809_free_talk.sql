-- Talk to Krishna: one free spoken turn for accounts without Annual Access.
-- Claimed by ask-krishna before the turn and refunded if it fails.
alter table public.user_accounts add column free_talks_used integer not null default 0;

create function public.claim_free_talk(p_user_id uuid)
returns boolean
language sql security definer set search_path = public
as $$
  with claimed as (
    update user_accounts set free_talks_used = free_talks_used + 1
    where user_id = p_user_id and free_talks_used < 1
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create function public.refund_free_talk(p_user_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update user_accounts set free_talks_used = free_talks_used - 1
  where user_id = p_user_id and free_talks_used > 0;
$$;

revoke all on function public.claim_free_talk(uuid) from public, anon, authenticated;
revoke all on function public.refund_free_talk(uuid) from public, anon, authenticated;
grant execute on function public.claim_free_talk(uuid) to service_role;
grant execute on function public.refund_free_talk(uuid) to service_role;
