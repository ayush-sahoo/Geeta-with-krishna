-- Run against a local/test database after migrations. Rolls back all fixtures.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000081'),('00000000-0000-4000-8000-000000000082');
do $$
declare u uuid := '00000000-0000-4000-8000-000000000081'; i integer;
begin
  for i in 1..40 loop
    if not public.claim_voice_budget(u,100) then raise exception 'allowed request rejected'; end if;
  end loop;
  if public.claim_voice_budget(u,100) then raise exception 'minute limit bypass'; end if;
  if not public.claim_voice_budget('00000000-0000-4000-8000-000000000082',100) then raise exception 'other account blocked'; end if;
  update public.voice_usage set minute_start=clock_timestamp()-interval '2 minutes' where user_id=u;
  if not public.claim_voice_budget(u,100) then raise exception 'minute did not reset'; end if;
  update public.voice_usage set day_units=120000 where user_id=u;
  if public.claim_voice_budget(u,1) then raise exception 'character limit bypass'; end if;
  update public.voice_usage set day_start=day_start-interval '1 day' where user_id=u;
  if not public.claim_voice_budget(u,100) then raise exception 'daily reset failed'; end if;
  update public.voice_usage set day_calls=600 where user_id=u;
  if public.claim_voice_budget(u,100) then raise exception 'daily request limit bypass'; end if;
  if public.claim_voice_budget(u,-1) or public.claim_voice_budget(u,null) then raise exception 'invalid units accepted'; end if;
  if has_function_privilege('authenticated','public.claim_voice_budget(uuid,integer)','execute')
    or has_function_privilege('anon','public.claim_voice_budget(uuid,integer)','execute') then raise exception 'client can reserve other accounts quota'; end if;
end $$;
rollback;
