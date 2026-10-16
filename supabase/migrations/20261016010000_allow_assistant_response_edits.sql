grant update (content, response_options) on public.conversation_messages to authenticated;

create policy "Users can edit their own assistant responses"
  on public.conversation_messages
  for update
  to authenticated
  using (
    role = 'assistant'
    and exists (
      select 1
      from public.conversations
      where conversations.id = conversation_id
        and conversations.user_id = (select auth.uid())
    )
  )
  with check (
    role = 'assistant'
    and exists (
      select 1
      from public.conversations
      where conversations.id = conversation_id
        and conversations.user_id = (select auth.uid())
    )
  );
