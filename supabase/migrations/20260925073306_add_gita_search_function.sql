-- Full-text verse search used by ask-krishna to find relevant verses
-- (exported from the project's migration history).

create index if not exists idx_gita_verses_english_fts
on public.gita_verses using gin (to_tsvector('english', coalesce(translation_english,'')));

create or replace function public.search_gita(search_text text, result_limit int default 5)
returns table (
  id bigint,
  chapter_id smallint,
  verse_number smallint,
  sanskrit text,
  transliteration text,
  translation_english text,
  rank real
)
language sql
security invoker
set search_path = public
as $$
  select
    v.id,
    v.chapter_id,
    v.verse_number,
    v.sanskrit,
    v.transliteration,
    v.translation_english,
    ts_rank(
      to_tsvector('english', coalesce(v.translation_english,'')),
      websearch_to_tsquery('english', search_text)
    ) as rank
  from public.gita_verses v
  where to_tsvector('english', coalesce(v.translation_english,''))
        @@ websearch_to_tsquery('english', search_text)
  order by rank desc, v.chapter_id, v.verse_number
  limit greatest(1, least(result_limit, 10));
$$;

grant execute on function public.search_gita(text,int) to anon, authenticated;
