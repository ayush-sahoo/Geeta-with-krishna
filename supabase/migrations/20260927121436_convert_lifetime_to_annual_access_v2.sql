-- Lifetime access became 1-year Annual Access (exported from the project's
-- migration history).

alter table public.user_accounts
  add column if not exists access_expires_at timestamptz;

alter table public.user_accounts
  drop constraint if exists user_accounts_plan_status_check;

update public.user_accounts
set
  plan_status = case when payment_status = 'paid' then 'annual' else 'free' end,
  access_expires_at = case
    when payment_status = 'paid' then coalesce(purchased_at, now()) + interval '1 year'
    else null
  end,
  updated_at = now()
where plan_status = 'lifetime';

alter table public.user_accounts
  add constraint user_accounts_plan_status_check
  check (plan_status = any (array['free'::text,'annual'::text]));
