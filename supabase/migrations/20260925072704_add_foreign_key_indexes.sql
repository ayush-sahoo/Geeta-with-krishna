-- Indexes for foreign keys (exported from the project's migration history).

create index idx_bookmarks_verse_id on public.bookmarks(verse_id);
create index idx_chat_messages_user_id on public.chat_messages(user_id);
create index idx_reading_progress_chapter_id on public.reading_progress(chapter_id);
