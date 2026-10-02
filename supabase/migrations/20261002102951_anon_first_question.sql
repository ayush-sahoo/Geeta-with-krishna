-- One free Ask Krishna question before sign-up. Each browser (visitor id) gets
-- one answer; per-network and daily caps bound the AI cost if someone clears
-- their browser or scripts requests. Only the hashed IP is stored.
create table if not exists public.anon_questions (
  visitor_id text primary key,
  ip_hash text not null,
  asked_at timestamptz not null default now()
);
create index if not exists anon_questions_ip_idx on public.anon_questions (ip_hash, asked_at desc);
create index if not exists anon_questions_asked_at_idx on public.anon_questions (asked_at desc);
alter table public.anon_questions enable row level security;
revoke all on public.anon_questions from anon, authenticated;

-- Returns 'ok' when the question may be answered, otherwise why not:
-- 'used' (this browser already asked), 'network' or 'daily' (a cap was hit).
create or replace function public.claim_anon_question(
  p_visitor_id text, p_ip_hash text, p_per_network int default 10, p_per_day int default 300)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('claim_anon_question'));
  if exists (select 1 from anon_questions where visitor_id = p_visitor_id) then return 'used'; end if;
  if (select count(*) from anon_questions where ip_hash = p_ip_hash and asked_at > now() - interval '24 hours') >= p_per_network then return 'network'; end if;
  if (select count(*) from anon_questions where asked_at > now() - interval '24 hours') >= p_per_day then return 'daily'; end if;
  insert into anon_questions (visitor_id, ip_hash) values (p_visitor_id, p_ip_hash);
  return 'ok';
end;
$$;

-- Gives the question back when no answer could be produced.
create or replace function public.refund_anon_question(p_visitor_id text)
returns void
language sql security definer set search_path = public
as $$
  delete from anon_questions where visitor_id = p_visitor_id;
$$;

revoke all on function public.claim_anon_question(text, text, int, int) from public, anon, authenticated;
revoke all on function public.refund_anon_question(text) from public, anon, authenticated;
grant execute on function public.claim_anon_question(text, text, int, int) to service_role;
grant execute on function public.refund_anon_question(text) to service_role;
