create table public.word_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  content text not null check (char_length(btrim(content)) between 1 and 10000),
  tags text[] not null default '{}',
  search_document tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(tags) <= 20)
);

create index word_tracks_user_created_at_idx
  on public.word_tracks (user_id, created_at desc);

create index word_tracks_tags_idx
  on public.word_tracks using gin (tags);

create index word_tracks_search_document_idx
  on public.word_tracks using gin (search_document);

alter table public.word_tracks enable row level security;
revoke all on public.word_tracks from anon, authenticated;
grant select, insert, update, delete on public.word_tracks to authenticated;

create policy "Users can read their own word tracks"
  on public.word_tracks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own word tracks"
  on public.word_tracks
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own word tracks"
  on public.word_tracks
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own word tracks"
  on public.word_tracks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create function private.set_word_track_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_word_track_updated_at() from public, anon, authenticated;

create trigger set_word_tracks_updated_at
  before update on public.word_tracks
  for each row execute function private.set_word_track_updated_at();
