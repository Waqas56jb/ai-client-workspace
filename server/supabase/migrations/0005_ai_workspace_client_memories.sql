-- ============================================================================
-- StudioFlow AI — 0005 client memory (what the assistant remembers per client)
--
-- ADDITIVE ONLY: one new table, its index, RLS policies and grants, all named
-- ai_workspace_*. Nothing existing is altered.
--
-- A memory is a short fact the user stated about a client ("EV Auto signs emails
-- as Sarah, HR Manager"). It is used in every chat for THAT client only, and the
-- team can see and delete memories (Clients → client → Memory). Deleting is a
-- real delete, so a forgotten fact is gone.
-- ============================================================================

create table if not exists public.ai_workspace_client_memories (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.ai_workspace_clients (id) on delete cascade,
  category text not null default 'fact',
  fact text not null,
  source_conversation_id uuid references public.ai_workspace_conversations (id) on delete set null,
  source_message_id uuid references public.ai_workspace_messages (id) on delete set null,
  created_by uuid references public.ai_workspace_users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ai_workspace_client_memories_fact_len check (char_length(fact) between 1 and 500),
  constraint ai_workspace_client_memories_category_chk check (category in ('fact', 'person', 'preference', 'brand_voice', 'business_rule', 'decision'))
);

create index if not exists ai_workspace_client_memories_client_idx on public.ai_workspace_client_memories (client_id, created_at);

alter table public.ai_workspace_client_memories enable row level security;
revoke all on table public.ai_workspace_client_memories from anon;
grant select, insert, delete on table public.ai_workspace_client_memories to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_workspace_client_memories' and policyname = 'ai_workspace_client_memories_member_select') then
    create policy ai_workspace_client_memories_member_select on public.ai_workspace_client_memories
      for select to authenticated using (public.ai_workspace_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_workspace_client_memories' and policyname = 'ai_workspace_client_memories_member_insert') then
    create policy ai_workspace_client_memories_member_insert on public.ai_workspace_client_memories
      for insert to authenticated with check (public.ai_workspace_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_workspace_client_memories' and policyname = 'ai_workspace_client_memories_member_delete') then
    create policy ai_workspace_client_memories_member_delete on public.ai_workspace_client_memories
      for delete to authenticated using (public.ai_workspace_is_member());
  end if;
end;
$$;
