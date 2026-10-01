-- Every verified Razorpay webhook event, summarised (no card, bank or UPI ID
-- details), so failed and abandoned payment attempts and their reasons can be
-- seen alongside successful ones. Written only by razorpay-webhook.
create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event text not null,
  user_id text,
  payment_link_id text,
  order_id text,
  payment_id text,
  status text,
  method text,
  amount_paise integer,
  contact_last4 text,
  error_code text,
  error_description text,
  error_source text,
  error_step text,
  error_reason text
);

create index if not exists payment_events_received_at_idx on public.payment_events (received_at desc);
create index if not exists payment_events_order_id_idx on public.payment_events (order_id);

-- Server-only: row-level security on with no policies, so only the service role can read or write.
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;
