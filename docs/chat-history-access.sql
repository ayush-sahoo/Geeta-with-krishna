-- Applied when enabling website chat history. TRUNCATE bypasses row policies;
-- browser roles must never have this privilege on account-owned chat tables.
revoke truncate on public.chat_threads, public.chat_messages from anon, authenticated;
