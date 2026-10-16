alter table public.profiles
  add column global_prompt text not null default '' check (char_length(global_prompt) <= 8000),
  add column chat_model text not null default 'gpt-6-luna'
    check (chat_model in ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra')),
  add column response_count integer not null default 3 check (response_count between 1 and 3);

grant update (global_prompt, chat_model, response_count) on public.profiles to authenticated;

alter table public.conversation_messages
  add column sequence bigint generated always as identity,
  add column response_options jsonb check (
    response_options is null or
    (jsonb_typeof(response_options) = 'array' and jsonb_array_length(response_options) between 1 and 3)
  ),
  add column context_usage jsonb check (context_usage is null or jsonb_typeof(context_usage) = 'object');

create index conversation_messages_sequence_idx
  on public.conversation_messages (conversation_id, sequence);

grant usage on sequence public.conversation_messages_sequence_seq to authenticated;
