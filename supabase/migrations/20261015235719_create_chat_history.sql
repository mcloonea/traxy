create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_updated_at_idx
  on public.conversations (user_id, updated_at desc);

alter table public.conversations enable row level security;
revoke all on public.conversations from anon, authenticated;
grant select, insert, update, delete on public.conversations to authenticated;

create policy "Users can read their own conversations"
  on public.conversations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own conversations"
  on public.conversations
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own conversations"
  on public.conversations
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own conversations"
  on public.conversations
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) > 0),
  created_at timestamptz not null default now()
);

create index conversation_messages_conversation_created_idx
  on public.conversation_messages (conversation_id, created_at, id);

alter table public.conversation_messages enable row level security;
revoke all on public.conversation_messages from anon, authenticated;
grant select, insert on public.conversation_messages to authenticated;

create policy "Users can read messages in their own conversations"
  on public.conversation_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations
      where conversations.id = conversation_id
        and conversations.user_id = (select auth.uid())
    )
  );

create policy "Users can add messages to their own conversations"
  on public.conversation_messages
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.conversations
      where conversations.id = conversation_id
        and conversations.user_id = (select auth.uid())
    )
  );
