-- UI-only dictionaries; writes and generation leases are server-only.
create table if not exists public.website_locales (
  language text primary key, revision text not null, translations jsonb,
  lease_until timestamptz, updated_at timestamptz not null default now()
);
alter table public.website_locales enable row level security;
revoke all on public.website_locales from anon, authenticated;
create or replace function public.claim_website_locale(p_language text,p_revision text)
returns boolean language sql security invoker set search_path=public as $$
  with claimed as (
    insert into public.website_locales(language,revision,lease_until)
    values(p_language,p_revision,now()+interval '2 minutes')
    on conflict(language) do update set revision=excluded.revision,
      translations=null,lease_until=excluded.lease_until
    where (website_locales.revision<>excluded.revision or website_locales.translations is null)
      and (website_locales.lease_until is null or website_locales.lease_until<now())
    returning 1
  ) select exists(select 1 from claimed);
$$;
revoke all on function public.claim_website_locale(text,text) from public,anon,authenticated;
grant execute on function public.claim_website_locale(text,text) to service_role;
