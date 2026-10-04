-- Delivery of the server-side Meta Purchase per paid payment, so a rejected or
-- timed-out send is retried (by razorpay-webhook on a repeat delivery and by
-- the meta-purchase-retry function every 10 minutes) until Meta accepts it.
alter table public.payment_transactions
  add column if not exists meta_sent_at timestamptz,
  add column if not exists meta_attempts integer not null default 0,
  add column if not exists meta_last_error text,
  add column if not exists meta_next_try_at timestamptz;

-- Payments before this: reported by the pixel, or sent by hand on 4 Oct 2026.
update public.payment_transactions set meta_sent_at = coalesce(paid_at, now())
  where status = 'paid' and meta_sent_at is null;

create index if not exists payment_transactions_meta_pending_idx
  on public.payment_transactions (paid_at) where status = 'paid' and meta_sent_at is null;

-- Shared secret for the scheduled call (kept in the vault, never in code).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'meta_retry_token') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'meta_retry_token', 'x-worker-token for meta-purchase-retry');
  end if;
end $$;

create or replace function public.meta_retry_token_ok(p_token text)
returns boolean
language sql stable security definer
set search_path to 'public', 'vault'
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'meta_retry_token' and decrypted_secret = p_token);
$$;
revoke all on function public.meta_retry_token_ok(text) from public, anon, authenticated;
grant execute on function public.meta_retry_token_ok(text) to service_role;

select cron.schedule('meta-purchase-retry', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://bkwvuckznpaawmqrjjgk.supabase.co/functions/v1/meta-purchase-retry',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-worker-token', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_retry_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
