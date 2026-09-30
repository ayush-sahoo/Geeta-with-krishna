-- One account row lock serializes renewals, including webhook redeliveries.
-- SECURITY INVOKER: only the existing service_role may execute this RPC.
create or replace function public.apply_annual_payment(
  p_user_id uuid, p_payment_id text, p_payment_link_id text,
  p_amount_paise integer, p_currency text, p_event jsonb
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  account public.user_accounts%rowtype;
  txn public.payment_transactions%rowtype;
  applied_at timestamptz := now();
  expires_at timestamptz;
  already_applied boolean;
begin
  if p_amount_paise <> 100000 or p_currency <> 'INR'
    or coalesce(p_payment_id,'') = '' or coalesce(p_payment_link_id,'') = '' then
    raise exception 'Invalid annual payment';
  end if;
  select * into account from public.user_accounts where user_id = p_user_id for update;
  if not found then raise exception 'Account not found'; end if;

  select * into txn from public.payment_transactions
    where payment_id = p_payment_id or payment_link_id = p_payment_link_id
    order by id limit 1 for update;
  if found then
    if txn.user_id <> p_user_id or (txn.payment_id is not null and txn.payment_id <> p_payment_id) then
      raise exception 'Payment identity mismatch';
    end if;
    if txn.status = 'paid' then
      return jsonb_build_object('duplicate',true,'access_expires_at',account.access_expires_at);
    end if;
  end if;

  -- Recover old webhook deliveries whose entitlement update succeeded but
  -- whose transaction bookkeeping did not. Do not extend access twice.
  already_applied := account.payment_id = p_payment_id;
  if already_applied then
    expires_at := account.access_expires_at;
  else
    expires_at := greatest(applied_at, case when account.payment_status = 'paid' then account.access_expires_at end) + interval '1 year';
  end if;

  if txn.id is not null then
    update public.payment_transactions set status='paid',payment_id=p_payment_id,
      payment_link_id=p_payment_link_id,amount_paise=p_amount_paise,currency=p_currency,
      raw_event=p_event,paid_at=applied_at where id=txn.id;
  else
    insert into public.payment_transactions(user_id,provider,payment_id,payment_link_id,
      amount_paise,currency,status,raw_event,paid_at)
      values(p_user_id,'razorpay',p_payment_id,p_payment_link_id,p_amount_paise,p_currency,'paid',p_event,applied_at);
  end if;

  if not coalesce(already_applied,false) then
    update public.user_accounts set plan_status='annual',payment_status='paid',
      payment_provider='razorpay',payment_id=p_payment_id,payment_link_id=p_payment_link_id,
      amount_paid_paise=p_amount_paise,purchased_at=applied_at,
      access_expires_at=expires_at,updated_at=applied_at where user_id=p_user_id;
  end if;
  return jsonb_build_object('duplicate',coalesce(already_applied,false),
    'unlocked',p_user_id,'access_expires_at',expires_at);
end;
$$;
revoke all on function public.apply_annual_payment(uuid,text,text,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_annual_payment(uuid,text,text,integer,text,jsonb) to service_role;
