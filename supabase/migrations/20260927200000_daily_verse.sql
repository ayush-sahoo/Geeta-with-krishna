-- Verse of the day: free for everyone (anon included), one curated verse per
-- day that changes at midnight India time. SECURITY DEFINER so it keeps
-- working if gita_verses is later restricted to paying users.
drop function if exists public.get_daily_verse();
create function public.get_daily_verse()
returns table(id bigint, chapter_id smallint, verse_number smallint, sanskrit text, transliteration text, translation_english text)
language sql
stable
security definer
set search_path = public
as $$
  with refs as (
    select t.c, t.v, t.n from unnest(
      array[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,3,3,3,3,3,3,3,4,4,4,4,4,5,5,5,5,6,6,6,6,6,6,6,6,7,7,8,9,9,9,9,10,10,11,12,12,12,12,12,13,14,15,15,16,16,16,16,17,17,18,18,18,18,18,18,18],
      array[14,20,22,23,27,38,40,47,48,50,55,56,62,63,70,71,8,19,21,27,30,35,37,7,8,18,38,39,10,18,22,29,5,6,17,19,26,30,32,35,7,19,7,22,26,27,29,8,20,33,13,14,15,18,19,28,22,7,15,1,2,3,21,15,16,46,47,58,63,65,66,78]
    ) with ordinality as t(c, v, n)
  ),
  pick as (
    -- Step through the list by 29 (coprime with 72) so consecutive days jump
    -- between chapters instead of walking through them in order.
    select c, v from refs
    where n - 1 = ((((now() at time zone 'Asia/Kolkata')::date - date '2026-01-01') * 29) % 72 + 72) % 72
  )
  select g.id, g.chapter_id, g.verse_number, g.sanskrit, g.transliteration, g.translation_english
  from gita_verses g join pick p on g.chapter_id = p.c and g.verse_number = p.v;
$$;

revoke all on function public.get_daily_verse() from public;
grant execute on function public.get_daily_verse() to anon, authenticated;
