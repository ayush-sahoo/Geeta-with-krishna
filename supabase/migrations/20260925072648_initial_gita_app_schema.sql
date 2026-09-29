-- Original schema: Gita content (chapters, verses, topics) and per-user data.
-- Exported from the project's migration history (it was applied before
-- migrations were kept in this repo).

create extension if not exists pgcrypto;

create table public.gita_chapters (
  id smallint primary key check (id between 1 and 18),
  name_sanskrit text not null,
  name_english text not null,
  name_hindi text,
  summary_english text,
  summary_hindi text,
  verse_count smallint not null check (verse_count > 0),
  created_at timestamptz not null default now()
);

create table public.gita_verses (
  id bigint generated always as identity primary key,
  chapter_id smallint not null references public.gita_chapters(id) on delete cascade,
  verse_number smallint not null check (verse_number > 0),
  sanskrit text not null,
  transliteration text,
  translation_english text,
  translation_hindi text,
  simple_explanation_english text,
  simple_explanation_hindi text,
  practical_takeaway_english text,
  practical_takeaway_hindi text,
  created_at timestamptz not null default now(),
  unique (chapter_id, verse_number)
);

create table public.verse_topics (
  id bigint generated always as identity primary key,
  verse_id bigint not null references public.gita_verses(id) on delete cascade,
  topic text not null,
  unique (verse_id, topic)
);

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_language text not null default 'english' check (preferred_language in ('english','hindi')),
  daily_verse_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  verse_id bigint not null references public.gita_verses(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, verse_id)
);

create table public.reading_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chapter_id smallint not null references public.gita_chapters(id),
  verse_number smallint not null check (verse_number > 0),
  updated_at timestamptz not null default now()
);

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  cited_verses jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_gita_verses_chapter on public.gita_verses(chapter_id, verse_number);
create index idx_verse_topics_topic on public.verse_topics(topic);
create index idx_bookmarks_user on public.bookmarks(user_id, created_at desc);
create index idx_chat_threads_user on public.chat_threads(user_id, updated_at desc);
create index idx_chat_messages_thread on public.chat_messages(thread_id, created_at);

alter table public.gita_chapters enable row level security;
alter table public.gita_verses enable row level security;
alter table public.verse_topics enable row level security;
alter table public.user_preferences enable row level security;
alter table public.bookmarks enable row level security;
alter table public.reading_progress enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

grant select on public.gita_chapters, public.gita_verses, public.verse_topics to anon, authenticated;
grant select, insert, update, delete on public.user_preferences, public.bookmarks, public.reading_progress, public.chat_threads, public.chat_messages to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "public_read_chapters" on public.gita_chapters
for select to anon, authenticated using (true);

create policy "public_read_verses" on public.gita_verses
for select to anon, authenticated using (true);

create policy "public_read_topics" on public.verse_topics
for select to anon, authenticated using (true);

create policy "preferences_select_own" on public.user_preferences
for select to authenticated using ((select auth.uid()) = user_id);
create policy "preferences_insert_own" on public.user_preferences
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "preferences_update_own" on public.user_preferences
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "preferences_delete_own" on public.user_preferences
for delete to authenticated using ((select auth.uid()) = user_id);

create policy "bookmarks_select_own" on public.bookmarks
for select to authenticated using ((select auth.uid()) = user_id);
create policy "bookmarks_insert_own" on public.bookmarks
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "bookmarks_update_own" on public.bookmarks
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "bookmarks_delete_own" on public.bookmarks
for delete to authenticated using ((select auth.uid()) = user_id);

create policy "progress_select_own" on public.reading_progress
for select to authenticated using ((select auth.uid()) = user_id);
create policy "progress_insert_own" on public.reading_progress
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "progress_update_own" on public.reading_progress
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "progress_delete_own" on public.reading_progress
for delete to authenticated using ((select auth.uid()) = user_id);

create policy "threads_select_own" on public.chat_threads
for select to authenticated using ((select auth.uid()) = user_id);
create policy "threads_insert_own" on public.chat_threads
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "threads_update_own" on public.chat_threads
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "threads_delete_own" on public.chat_threads
for delete to authenticated using ((select auth.uid()) = user_id);

create policy "messages_select_own" on public.chat_messages
for select to authenticated using ((select auth.uid()) = user_id);
create policy "messages_insert_own" on public.chat_messages
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.chat_threads t
    where t.id = thread_id and t.user_id = (select auth.uid())
  )
);
create policy "messages_delete_own" on public.chat_messages
for delete to authenticated using ((select auth.uid()) = user_id);
