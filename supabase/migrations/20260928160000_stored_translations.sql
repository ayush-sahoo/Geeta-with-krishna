-- Stored verse translations, so meanings show instantly instead of waiting
-- for the AI. Each verse text is built from fixed pieces plus the verse's own
-- meaning (see app.js: CHAPTER_LENS, DEEP_RULES, APPLY_TODAY, REFLECTIONS);
-- every piece is translated once per language and kept here.
--
-- translation_sources: the pieces to pre-translate (seeded from the verses
--   and tools/translation_sources.mjs). Server-only.
-- text_translations:   one row per piece and language, keyed by the SHA-256
--   of the English text. Signed-in users read it; only the server writes.
-- translation-worker (edge function, run every minute by pg_cron) fills the
--   gaps, Hindi and other Indian languages first.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.translation_sources (
  source_hash text primary key,
  source text not null,
  kind text not null,
  priority int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.translation_sources enable row level security;

create table if not exists public.text_translations (
  source_hash text not null,
  language text not null,
  translated text not null,
  created_at timestamptz not null default now(),
  primary key (source_hash, language)
);
alter table public.text_translations enable row level security;
drop policy if exists "signed-in users read translations" on public.text_translations;
create policy "signed-in users read translations" on public.text_translations
  for select to authenticated using (true);
revoke insert, update, delete on public.text_translations from anon, authenticated;
revoke all on public.translation_sources from anon, authenticated;

-- Seed: every verse meaning (same cleanup as app.js cleanTranslation).
insert into public.translation_sources (source_hash, source, kind, priority)
select encode(sha256(convert_to(src, 'UTF8')), 'hex'), src, 'meaning', 0
from (
  select distinct regexp_replace(regexp_replace(coalesce(translation_english, ''), '^\d+\.\d+\.?\s*', ''), '^\s+|\s+$', '', 'g') as src
  from public.gita_verses
) m
where src <> ''
on conflict (source_hash) do nothing;

-- Pieces still missing for a language, up to p_max_chars (at least one).
create or replace function public.next_translation_batch(p_language text, p_max_chars int default 6000)
returns table (source_hash text, source text)
language sql stable security definer set search_path = public
as $$
  with missing as (
    select s.source_hash, s.source,
      sum(length(s.source)) over (order by s.priority desc, s.source_hash) as running
    from translation_sources s
    where not exists (select 1 from text_translations t where t.source_hash = s.source_hash and t.language = p_language)
  )
  select m.source_hash, m.source from missing m
  where m.running <= p_max_chars or m.running = (select min(running) from missing)
  order by m.running;
$$;

-- How many pieces each language still needs.
create or replace function public.translation_missing(p_languages text[])
returns table (language text, missing bigint)
language sql stable security definer set search_path = public
as $$
  select l, (select count(*) from translation_sources s
             where not exists (select 1 from text_translations t where t.source_hash = s.source_hash and t.language = l))
  from unnest(p_languages) as l;
$$;

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

-- The worker proves it was started by the cron job with a token kept in Vault.
create or replace function public.translation_worker_token_ok(p_token text)
returns boolean
language sql stable security definer set search_path = public, vault
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'translation_worker_token' and decrypted_secret = p_token);
$$;

revoke all on function public.next_translation_batch(text, int) from public, anon, authenticated;
revoke all on function public.translation_missing(text[]) from public, anon, authenticated;
revoke all on function public.translation_worker_token_ok(text) from public, anon, authenticated;
revoke all on function public.claim_translation_languages(text[], int, int) from public, anon, authenticated;
grant execute on function public.next_translation_batch(text, int) to service_role;
grant execute on function public.translation_missing(text[]) to service_role;
grant execute on function public.translation_worker_token_ok(text) to service_role;
grant execute on function public.claim_translation_languages(text[], int, int) to service_role;
