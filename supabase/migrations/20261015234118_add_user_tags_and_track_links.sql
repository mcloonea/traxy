create table public.user_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create unique index user_tags_user_name_idx
  on public.user_tags (user_id, lower(name));

alter table public.word_tracks
  add constraint word_tracks_user_id_id_key unique (user_id, id);

create table public.word_track_tags (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id, tag_id),
  foreign key (user_id, track_id)
    references public.word_tracks (user_id, id) on delete cascade,
  foreign key (user_id, tag_id)
    references public.user_tags (user_id, id) on delete cascade
);

create index word_track_tags_tag_lookup_idx
  on public.word_track_tags (user_id, tag_id, track_id);

alter table public.user_tags enable row level security;
alter table public.word_track_tags enable row level security;

revoke all on public.user_tags, public.word_track_tags from anon, authenticated;
grant select, insert, update, delete on public.user_tags to authenticated;
grant select, insert, delete on public.word_track_tags to authenticated;

create policy "Users can manage their own tags"
  on public.user_tags
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can read their own track tags"
  on public.word_track_tags
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can assign their own track tags"
  on public.word_track_tags
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can remove their own track tags"
  on public.word_track_tags
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Preserve any tags created before the tag catalog was added.
insert into public.user_tags (user_id, name)
select distinct on (tracks.user_id, lower(cleaned.name)) tracks.user_id, cleaned.name
from public.word_tracks as tracks
cross join lateral (
  select regexp_replace(btrim(old_tag), '^#', '') as name
  from unnest(tracks.tags) as old_tag
) as cleaned
where cleaned.name <> ''
order by tracks.user_id, lower(cleaned.name), cleaned.name
on conflict do nothing;

insert into public.word_track_tags (user_id, track_id, tag_id)
select tracks.user_id, tracks.id, tags.id
from public.word_tracks as tracks
cross join lateral unnest(tracks.tags) as old_tag
join public.user_tags as tags
  on tags.user_id = tracks.user_id
  and lower(tags.name) = lower(regexp_replace(btrim(old_tag), '^#', ''))
where btrim(old_tag) <> ''
on conflict do nothing;

alter table public.word_tracks drop column tags;
