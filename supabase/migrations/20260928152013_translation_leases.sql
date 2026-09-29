-- Translation worker language leases (the same final definitions are in
-- 20260928151756_stored_translations.sql).

-- Each worker run claims a few languages for p_lease_seconds so overlapping
-- runs never translate the same text twice. Returns the claimed languages,
-- in the order given, skipping finished and already-claimed ones.
create table if not exists public.translation_leases (
  language text primary key,
  leased_until timestamptz not null
);
alter table public.translation_leases enable row level security;

create or replace function public.claim_translation_languages(p_languages text[], p_count int, p_lease_seconds int)
returns text[]
language plpgsql security definer set search_path = public
as $$
declare lang text; claimed text[] := '{}';
begin
  foreach lang in array p_languages loop
    exit when coalesce(array_length(claimed, 1), 0) >= p_count;
    continue when not exists (
      select 1 from translation_sources s
      where not exists (select 1 from text_translations t where t.source_hash = s.source_hash and t.language = lang));
    insert into translation_leases (language, leased_until) values (lang, now() + make_interval(secs => p_lease_seconds))
    on conflict (language) do update set leased_until = excluded.leased_until
      where translation_leases.leased_until < now();
    if found then claimed := claimed || lang; end if;
  end loop;
  return claimed;
end $$;

revoke all on function public.claim_translation_languages(text[], int, int) from public, anon, authenticated;
grant execute on function public.claim_translation_languages(text[], int, int) to service_role;
