-- Run in the SQL editor. All test changes roll back; no real payment is sent.
begin;
do $$
declare
  uid uuid;
  first jsonb;
  second jsonb;
  replay jsonb;
  expiry timestamptz;
  seed text := 'regression_' || gen_random_uuid()::text;
begin
  select a.user_id into uid from public.user_accounts a join auth.users u on u.id=a.user_id
    where u.email='xyz@gmail.com' limit 1;
  if uid is null then raise exception 'Test account missing'; end if;
  first := public.apply_annual_payment(uid,seed||'_a',seed||'_link_a',100000,'INR','{}');
  second := public.apply_annual_payment(uid,seed||'_b',seed||'_link_b',100000,'INR','{}');
  if (second->>'access_expires_at')::timestamptz <> (first->>'access_expires_at')::timestamptz + interval '1 year' then
    raise exception 'Second renewal did not add a year';
  end if;
  replay := public.apply_annual_payment(uid,seed||'_a',seed||'_link_a',100000,'INR','{}');
  if not (replay->>'duplicate')::boolean or replay->>'access_expires_at' <> second->>'access_expires_at' then
    raise exception 'Old duplicate extended or changed entitlement';
  end if;
  begin
    perform public.apply_annual_payment(uid,seed||'_bad',seed||'_badlink',100000,'USD','{}');
    raise exception 'Wrong currency accepted';
  exception when others then
    if sqlerrm <> 'Invalid annual payment' then raise; end if;
  end;
  begin
    perform public.apply_annual_payment(uid,seed||'_different',seed||'_link_a',100000,'INR','{}');
    raise exception 'Conflicting identity accepted';
  exception when others then
    if sqlerrm <> 'Payment identity mismatch' then raise; end if;
  end;
  select access_expires_at into expiry from public.user_accounts where user_id=uid;
  if expiry <> (second->>'access_expires_at')::timestamptz then raise exception 'Failed request changed entitlement'; end if;
end;
$$;
select 'renewal, old duplicate, currency rejection and identity rejection passed' as result;
rollback;
