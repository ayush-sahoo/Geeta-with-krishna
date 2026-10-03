-- A short per-account lease while create-payment-link talks to Razorpay, so a
-- retried or parallel request waits and then reuses the checkout the first one
-- created instead of creating a second payable order or link. The lease
-- expires by itself if a request dies.
alter table public.user_accounts add column if not exists checkout_lease_until timestamptz;

create or replace function public.claim_checkout_lease(p_user_id uuid, p_seconds int default 20)
returns boolean
language sql security definer set search_path = public
as $$
  with claimed as (
    update user_accounts set checkout_lease_until = now() + make_interval(secs => p_seconds)
    where user_id = p_user_id and (checkout_lease_until is null or checkout_lease_until < now())
    returning 1
  ) select exists (select 1 from claimed);
$$;

create or replace function public.release_checkout_lease(p_user_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update user_accounts set checkout_lease_until = null where user_id = p_user_id;
$$;

revoke all on function public.claim_checkout_lease(uuid, int) from public, anon, authenticated;
revoke all on function public.release_checkout_lease(uuid) from public, anon, authenticated;
grant execute on function public.claim_checkout_lease(uuid, int) to service_role;
grant execute on function public.release_checkout_lease(uuid) to service_role;
