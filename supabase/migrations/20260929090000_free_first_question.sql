-- One free Ask Krishna question per account, so new visitors can try the
-- guide after a free sign-up before being asked to pay. ask-krishna claims
-- the question atomically before calling the AI and refunds it if the AI
-- fails; get-my-access reports whether it is still available.

alter table public.user_accounts
  add column if not exists free_questions_used int not null default 0;

create or replace function public.claim_free_question(p_user_id uuid, p_limit int default 1)
returns boolean
language sql security definer set search_path = public
as $$
  with claimed as (
    update user_accounts set free_questions_used = free_questions_used + 1
    where user_id = p_user_id and free_questions_used < p_limit
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function public.refund_free_question(p_user_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update user_accounts set free_questions_used = free_questions_used - 1
  where user_id = p_user_id and free_questions_used > 0;
$$;

revoke all on function public.claim_free_question(uuid, int) from public, anon, authenticated;
revoke all on function public.refund_free_question(uuid) from public, anon, authenticated;
grant execute on function public.claim_free_question(uuid, int) to service_role;
grant execute on function public.refund_free_question(uuid) to service_role;
