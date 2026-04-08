-- Add AI Conversations support
create table if not exists ai_conversations (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid, -- Simplified for local dev, can be references organizations(id)
  user_id uuid, -- Simplified for local dev, can be references auth.users(id)
  title text not null default 'Strategic Discussion',
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

-- Enable RLS for conversations
alter table ai_conversations enable row level security;

-- Only creators can see their conversations
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Users can manage their own conversations') then
    create policy "Users can manage their own conversations" on ai_conversations for all using (auth.uid() = user_id);
  end if;
end $$;

-- Update messages table to link to conversations
alter table ai_chat_messages add column if not exists conversation_id uuid references ai_conversations(id) on delete cascade;
create index if not exists idx_ai_messages_conversation on ai_chat_messages(conversation_id);

-- Ensure all current messages have a catch-all conversation if needed (Cleanup)
-- Note: new messages will always have a valid conversation_id from now on
