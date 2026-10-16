create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  openai_response_id text not null unique,
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  total_tokens integer not null check (total_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  created_at timestamptz not null default now(),
  check (total_tokens = input_tokens + output_tokens),
  check (cached_input_tokens <= input_tokens),
  check (cache_write_tokens <= input_tokens),
  check (reasoning_tokens <= output_tokens)
);

create index ai_usage_user_created_at_idx
  on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
grant insert on public.ai_usage to service_role;
grant usage on sequence public.ai_usage_id_seq to service_role;

create policy "Users can read their own AI usage"
  on public.ai_usage
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create function private.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(btrim(new.raw_user_meta_data ->> 'name'), ''))
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.create_profile_for_new_user() from public, anon, authenticated;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function private.create_profile_for_new_user();

insert into public.profiles (id, display_name)
select id, nullif(btrim(raw_user_meta_data ->> 'name'), '')
from auth.users
on conflict (id) do nothing;
