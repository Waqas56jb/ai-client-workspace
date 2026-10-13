-- ============================================================================
-- StudioFlow AI — 0001 core schema
--
-- ADDITIVE ONLY. Creates application-owned objects, every one prefixed
-- `ai_workspace_`. It does not alter, drop, rename or truncate any existing
-- object, and it does not touch other projects' tables, functions or buckets.
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

-- ── Shared trigger function: maintain updated_at ────────────────────────────
create or replace function public.ai_workspace_update_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Users (profiles for provisioned Supabase Auth users) ────────────────────
-- Membership of the shared workspace = an active row in this table.
create table if not exists public.ai_workspace_users (
  id             uuid primary key references auth.users (id) on delete cascade,
  display_name   text not null check (char_length(display_name) between 1 and 120),
  email          text not null check (char_length(email) between 3 and 320),
  role_title     text not null default 'Team member' check (char_length(role_title) <= 80),
  avatar_colour  text not null default '#6257E8' check (avatar_colour ~ '^#[0-9A-Fa-f]{6}$'),
  avatar_path    text,
  is_active      boolean not null default true,
  last_active_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ai_workspace_users_email_key unique (email)
);

-- ── Clients ─────────────────────────────────────────────────────────────────
create table if not exists public.ai_workspace_clients (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null check (char_length(name) between 2 and 80),
  slug                       text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  industry                   text not null default '' check (char_length(industry) <= 80),
  description                text not null default '' check (char_length(description) <= 1000),
  business_address           text not null default '' check (char_length(business_address) <= 240),
  contact_name               text not null default '' check (char_length(contact_name) <= 80),
  contact_email              text not null default '' check (char_length(contact_email) <= 320),
  contact_phone              text not null default '' check (char_length(contact_phone) <= 40),
  website                    text not null default '' check (char_length(website) <= 300),
  internal_notes             text not null default '' check (char_length(internal_notes) <= 2000),
  logo_file_id               uuid,
  -- brand identity
  primary_colour             text not null default '#6257E8' check (primary_colour ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$'),
  secondary_colour           text not null default '#8B7CFF' check (secondary_colour ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$'),
  accent_colour              text not null default '#FFC531' check (accent_colour ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$'),
  background_colour          text not null default '#FFFFFF' check (background_colour ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$'),
  font_family                text not null default '' check (char_length(font_family) <= 80),
  heading_font               text not null default '' check (char_length(heading_font) <= 80),
  body_font                  text not null default '' check (char_length(body_font) <= 80),
  brand_guidelines           text not null default '' check (char_length(brand_guidelines) <= 4000),
  -- business information shown in generated copy
  business_name              text not null default '' check (char_length(business_name) <= 160),
  business_phone             text not null default '' check (char_length(business_phone) <= 40),
  business_email             text not null default '' check (char_length(business_email) <= 320),
  business_website           text not null default '' check (char_length(business_website) <= 300),
  -- writing preferences: tone, formality, spelling, useWords, avoidWords, formatting, instructions
  writing_preferences        jsonb not null default '{}'::jsonb check (jsonb_typeof(writing_preferences) = 'object'),
  -- approved business terms (used verbatim)
  approved_warranty_wording  text not null default '' check (char_length(approved_warranty_wording) <= 4000),
  standard_disclaimers       text not null default '' check (char_length(standard_disclaimers) <= 4000),
  standard_terms             text not null default '' check (char_length(standard_terms) <= 4000),
  legal_wording              text not null default '' check (char_length(legal_wording) <= 4000),
  -- additional information
  reference_notes            text not null default '' check (char_length(reference_notes) <= 4000),
  product_info               text not null default '' check (char_length(product_info) <= 4000),
  target_audience            text not null default '' check (char_length(target_audience) <= 1000),
  image_style                text not null default '' check (char_length(image_style) <= 1000),
  other_instructions         text not null default '' check (char_length(other_instructions) <= 4000),
  status                     text not null default 'active' check (status in ('active', 'prospect', 'archived')),
  created_by                 uuid references public.ai_workspace_users (id) on delete set null,
  updated_by                 uuid references public.ai_workspace_users (id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  archived_at                timestamptz,
  constraint ai_workspace_clients_slug_key unique (slug),
  constraint ai_workspace_clients_archived_chk check ((status = 'archived') = (archived_at is not null))
);

-- ── Jobs ────────────────────────────────────────────────────────────────────
create table if not exists public.ai_workspace_jobs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.ai_workspace_clients (id) on delete restrict,
  title       text not null check (char_length(title) between 2 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  status      text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'archived')),
  deadline    date,
  notes       text not null default '' check (char_length(notes) <= 2000),
  created_by  uuid references public.ai_workspace_users (id) on delete set null,
  updated_by  uuid references public.ai_workspace_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  -- target for composite FKs that keep child rows on the same client
  constraint ai_workspace_jobs_id_client_key unique (id, client_id)
);

-- ── Tasks ───────────────────────────────────────────────────────────────────
-- (job_id, client_id) → jobs(id, client_id) guarantees the task's client is the
-- job's client. ON UPDATE CASCADE moves tasks with their job when a job is
-- reassigned to another client.
create table if not exists public.ai_workspace_tasks (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null,
  job_id      uuid not null,
  title       text not null check (char_length(title) between 2 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  notes       text not null default '' check (char_length(notes) <= 2000),
  task_type   text not null check (task_type in ('writing_editing', 'image_creation', 'advertising_copy', 'vehicle_description', 'general')),
  status      text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done')),
  assignee_id uuid references public.ai_workspace_users (id) on delete set null,
  created_by  uuid references public.ai_workspace_users (id) on delete set null,
  updated_by  uuid references public.ai_workspace_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint ai_workspace_tasks_job_client_fkey foreign key (job_id, client_id)
    references public.ai_workspace_jobs (id, client_id) on update cascade on delete restrict,
  constraint ai_workspace_tasks_scope_key unique (id, job_id, client_id)
);

-- ── Conversations ───────────────────────────────────────────────────────────
create table if not exists public.ai_workspace_conversations (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null,
  job_id      uuid not null,
  task_id     uuid not null,
  title       text not null default 'New conversation' check (char_length(title) between 1 and 120),
  tool_type   text check (tool_type in ('writing_editing', 'image_creation', 'advertising_copy', 'vehicle_description')),
  created_by  uuid references public.ai_workspace_users (id) on delete set null,
  updated_by  uuid references public.ai_workspace_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint ai_workspace_conversations_task_scope_fkey foreign key (task_id, job_id, client_id)
    references public.ai_workspace_tasks (id, job_id, client_id) on update cascade on delete restrict,
  constraint ai_workspace_conversations_scope_key unique (id, task_id)
);

-- ── Messages ────────────────────────────────────────────────────────────────
create table if not exists public.ai_workspace_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_workspace_conversations (id) on delete restrict,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null default '' check (char_length(content) <= 100000),
  message_type    text not null default 'prompt' check (message_type in ('prompt', 'response', 'clarification', 'error', 'status')),
  -- UI metadata: outputIds, options, requestOptions, attachmentIds, generationId, resolved …
  metadata        jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by      uuid references public.ai_workspace_users (id) on delete set null,
  created_at      timestamptz not null default now(),
  search_vector   tsvector generated always as (to_tsvector('simple', coalesce(content, ''))) stored
);

-- ── Files (metadata only — bytes live in Supabase Storage) ──────────────────
create table if not exists public.ai_workspace_files (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.ai_workspace_clients (id) on delete restrict,
  job_id             uuid,
  task_id            uuid,
  conversation_id    uuid references public.ai_workspace_conversations (id) on delete set null,
  output_id          uuid,
  file_name          text not null check (char_length(file_name) between 1 and 255),
  original_file_name text not null default '' check (char_length(original_file_name) <= 255),
  description        text not null default '' check (char_length(description) <= 1000),
  storage_bucket     text not null default 'ai-workspace-files',
  storage_path       text,
  mime_type          text not null check (char_length(mime_type) <= 160),
  file_size_bytes    bigint not null default 0 check (file_size_bytes >= 0),
  file_checksum      text check (file_checksum is null or file_checksum ~ '^[0-9a-f]{64}$'),
  file_category      text not null check (file_category in ('image', 'document', 'text', 'other')),
  source_type        text not null check (source_type in ('reference', 'attachment', 'generated', 'logo')),
  approval_status    text not null default 'none' check (approval_status in ('none', 'draft', 'approved')),
  current_version_id uuid,
  created_by         uuid references public.ai_workspace_users (id) on delete set null,
  updated_by         uuid references public.ai_workspace_users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz,
  search_vector      tsvector generated always as (to_tsvector('simple', coalesce(file_name, '') || ' ' || coalesce(description, ''))) stored,
  constraint ai_workspace_files_job_client_fkey foreign key (job_id, client_id)
    references public.ai_workspace_jobs (id, client_id) on update cascade on delete restrict,
  constraint ai_workspace_files_task_scope_fkey foreign key (task_id, job_id, client_id)
    references public.ai_workspace_tasks (id, job_id, client_id) on update cascade on delete restrict,
  constraint ai_workspace_files_task_requires_job_chk check (task_id is null or job_id is not null),
  constraint ai_workspace_files_storage_path_key unique (storage_bucket, storage_path)
);

-- ── File versions (immutable physical versions) ─────────────────────────────
create table if not exists public.ai_workspace_file_versions (
  id               uuid primary key default gen_random_uuid(),
  file_id          uuid not null references public.ai_workspace_files (id) on delete restrict,
  version_number   integer not null check (version_number >= 1),
  storage_bucket   text not null default 'ai-workspace-files',
  storage_path     text not null,
  file_name        text not null check (char_length(file_name) between 1 and 255),
  mime_type        text not null,
  file_size_bytes  bigint not null check (file_size_bytes >= 0),
  file_checksum    text not null check (file_checksum ~ '^[0-9a-f]{64}$'),
  -- image pipeline details: requested/actual dimensions, strategy, original path …
  metadata         jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  revision_note    text not null default '' check (char_length(revision_note) <= 500),
  approval_status  text not null default 'draft' check (approval_status in ('draft', 'approved')),
  approved_by      uuid references public.ai_workspace_users (id) on delete set null,
  approved_at      timestamptz,
  created_by       uuid references public.ai_workspace_users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint ai_workspace_file_versions_number_key unique (file_id, version_number),
  constraint ai_workspace_file_versions_path_key unique (storage_bucket, storage_path)
);

-- ── Outputs (logical generated work) and immutable output versions ──────────
-- An output is one piece of work (an email, an ad set, a listing, an image).
-- Each revision is a new row in ai_workspace_output_versions. Image versions
-- point at the physical file version that holds the final pixels.
create table if not exists public.ai_workspace_outputs (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null,
  job_id              uuid not null,
  task_id             uuid not null,
  conversation_id     uuid references public.ai_workspace_conversations (id) on delete set null,
  tool_type           text not null check (tool_type in ('writing_editing', 'image_creation', 'advertising_copy', 'vehicle_description')),
  output_kind         text not null check (output_kind in ('text', 'image')),
  output_type         text not null check (output_type in ('email', 'sms', 'whatsapp', 'other', 'advertising', 'vehicle', 'image')),
  title               text not null check (char_length(title) between 1 and 160),
  file_id             uuid references public.ai_workspace_files (id) on delete set null,
  current_version_id  uuid,
  approved_version_id uuid,
  created_by          uuid references public.ai_workspace_users (id) on delete set null,
  updated_by          uuid references public.ai_workspace_users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  constraint ai_workspace_outputs_task_scope_fkey foreign key (task_id, job_id, client_id)
    references public.ai_workspace_tasks (id, job_id, client_id) on update cascade on delete restrict
);

create table if not exists public.ai_workspace_output_versions (
  id                uuid primary key default gen_random_uuid(),
  output_id         uuid not null references public.ai_workspace_outputs (id) on delete restrict,
  task_id           uuid not null references public.ai_workspace_tasks (id) on delete restrict,
  conversation_id   uuid references public.ai_workspace_conversations (id) on delete set null,
  output_type       text not null,
  title             text not null,
  version_number    integer not null check (version_number >= 1),
  content           text not null default '' check (char_length(content) <= 100000),
  sections          jsonb check (sections is null or jsonb_typeof(sections) = 'array'),
  missing_info      jsonb check (missing_info is null or jsonb_typeof(missing_info) = 'array'),
  image_meta        jsonb check (image_meta is null or jsonb_typeof(image_meta) = 'object'),
  file_version_id   uuid references public.ai_workspace_file_versions (id) on delete restrict,
  source_version_id uuid references public.ai_workspace_output_versions (id) on delete set null,
  revision_note     text not null default '' check (char_length(revision_note) <= 500),
  approval_status   text not null default 'draft' check (approval_status in ('draft', 'approved')),
  approved_by       uuid references public.ai_workspace_users (id) on delete set null,
  approved_at       timestamptz,
  created_by        uuid references public.ai_workspace_users (id) on delete set null,
  created_at        timestamptz not null default now(),
  search_vector     tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(sections::text, ''))
  ) stored,
  constraint ai_workspace_output_versions_number_key unique (output_id, version_number),
  constraint ai_workspace_output_versions_approval_chk check ((approval_status = 'approved') = (approved_at is not null))
);

-- Deferred FKs from outputs to their current/approved versions (added once)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_workspace_outputs_current_version_fkey') then
    alter table public.ai_workspace_outputs
      add constraint ai_workspace_outputs_current_version_fkey foreign key (current_version_id)
      references public.ai_workspace_output_versions (id) on delete restrict deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_workspace_outputs_approved_version_fkey') then
    alter table public.ai_workspace_outputs
      add constraint ai_workspace_outputs_approved_version_fkey foreign key (approved_version_id)
      references public.ai_workspace_output_versions (id) on delete restrict deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_workspace_files_output_fkey') then
    alter table public.ai_workspace_files
      add constraint ai_workspace_files_output_fkey foreign key (output_id)
      references public.ai_workspace_outputs (id) on delete set null deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_workspace_files_current_version_fkey') then
    alter table public.ai_workspace_files
      add constraint ai_workspace_files_current_version_fkey foreign key (current_version_id)
      references public.ai_workspace_file_versions (id) on delete restrict deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_workspace_clients_logo_file_fkey') then
    alter table public.ai_workspace_clients
      add constraint ai_workspace_clients_logo_file_fkey foreign key (logo_file_id)
      references public.ai_workspace_files (id) on delete set null deferrable initially deferred;
  end if;
end;
$$;

-- ── Approvals (history is append-only) ──────────────────────────────────────
create table if not exists public.ai_workspace_approvals (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  job_id            uuid not null,
  task_id           uuid not null,
  output_id         uuid references public.ai_workspace_outputs (id) on delete restrict,
  output_version_id uuid references public.ai_workspace_output_versions (id) on delete restrict,
  file_id           uuid references public.ai_workspace_files (id) on delete restrict,
  file_version_id   uuid references public.ai_workspace_file_versions (id) on delete restrict,
  status            text not null default 'approved' check (status in ('draft', 'approved')),
  approved_by       uuid references public.ai_workspace_users (id) on delete set null,
  approved_at       timestamptz not null default now(),
  notes             text not null default '' check (char_length(notes) <= 1000),
  created_at        timestamptz not null default now(),
  constraint ai_workspace_approvals_task_scope_fkey foreign key (task_id, job_id, client_id)
    references public.ai_workspace_tasks (id, job_id, client_id) on update cascade on delete restrict,
  constraint ai_workspace_approvals_target_chk check (output_version_id is not null or file_version_id is not null)
);

-- ── Brand assets (logos, reference images, guideline documents) ─────────────
create table if not exists public.ai_workspace_brand_assets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.ai_workspace_clients (id) on delete restrict,
  asset_type  text not null check (asset_type in ('logo', 'reference_image', 'guideline_document', 'reference_document', 'other')),
  title       text not null default '' check (char_length(title) <= 160),
  description text not null default '' check (char_length(description) <= 1000),
  file_id     uuid not null references public.ai_workspace_files (id) on delete restrict,
  metadata    jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by  uuid references public.ai_workspace_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ai_workspace_brand_assets_file_key unique (file_id)
);

-- ── Image presets ───────────────────────────────────────────────────────────
create table if not exists public.ai_workspace_image_presets (
  id                          uuid primary key default gen_random_uuid(),
  seed_key                    text,
  name                        text not null check (char_length(name) between 2 and 60),
  description                 text not null default '' check (char_length(description) <= 300),
  client_id                   uuid references public.ai_workspace_clients (id) on delete set null,
  width_px                    integer not null check (width_px between 64 and 8192),
  height_px                   integer not null check (height_px between 64 and 8192),
  resize_strategy             text not null default 'cover' check (resize_strategy in ('cover', 'contain', 'fill')),
  background_instructions     text not null default '' check (char_length(background_instructions) <= 200),
  layout_instructions         text not null default '' check (char_length(layout_instructions) <= 2000),
  font_instructions           text not null default '' check (char_length(font_instructions) <= 2000),
  brand_colour_instructions   text not null default '' check (char_length(brand_colour_instructions) <= 1000),
  logo_placement_instructions text not null default '' check (char_length(logo_placement_instructions) <= 500),
  safe_area_instructions      text not null default '' check (char_length(safe_area_instructions) <= 500),
  is_starter                  boolean not null default false,
  is_custom                   boolean not null default false,
  is_active                   boolean not null default true,
  created_by                  uuid references public.ai_workspace_users (id) on delete set null,
  updated_by                  uuid references public.ai_workspace_users (id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint ai_workspace_image_presets_seed_key unique (seed_key)
);

-- ── AI tool instructions ────────────────────────────────────────────────────
create table if not exists public.ai_workspace_ai_instructions (
  id                     uuid primary key default gen_random_uuid(),
  tool_type              text not null check (tool_type in ('writing_editing', 'image_creation', 'advertising_copy', 'vehicle_description')),
  name                   text not null check (char_length(name) between 2 and 80),
  description            text not null default '' check (char_length(description) <= 500),
  system_instruction     text not null check (char_length(system_instruction) between 20 and 8000),
  output_rules           text not null default '' check (char_length(output_rules) <= 4000),
  formatting_preferences text not null default '' check (char_length(formatting_preferences) <= 4000),
  additional_constraints text not null default '' check (char_length(additional_constraints) <= 4000),
  -- [{ id, input, output }] — example input/output pairs kept together so they stay aligned
  examples               jsonb not null default '[]'::jsonb check (jsonb_typeof(examples) = 'array'),
  -- validated server-side against an allowlist (model, max_output_tokens, quality …)
  model_configuration    jsonb not null default '{}'::jsonb check (jsonb_typeof(model_configuration) = 'object'),
  is_active              boolean not null default true,
  version                integer not null default 1 check (version >= 1),
  created_by             uuid references public.ai_workspace_users (id) on delete set null,
  updated_by             uuid references public.ai_workspace_users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ai_workspace_ai_instructions_tool_key unique (tool_type)
);

-- ── Workspace settings (single row) ─────────────────────────────────────────
create table if not exists public.ai_workspace_settings (
  id                          smallint primary key default 1 check (id = 1),
  workspace_name              text not null default 'Main Workspace' check (char_length(workspace_name) between 1 and 80),
  general_writing_preferences text not null default '' check (char_length(general_writing_preferences) <= 4000),
  default_tone                text not null default 'Professional' check (char_length(default_tone) <= 40),
  default_spelling_convention text not null default 'British English' check (char_length(default_spelling_convention) <= 40),
  default_image_preset_id     uuid references public.ai_workspace_image_presets (id) on delete set null,
  date_format                 text not null default 'd MMM yyyy' check (char_length(date_format) <= 40),
  default_file_view           text not null default 'grid' check (default_file_view in ('grid', 'list')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.ai_workspace_users (id) on delete set null
);

-- ── Activity log ────────────────────────────────────────────────────────────
create table if not exists public.ai_workspace_activity_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.ai_workspace_users (id) on delete set null,
  action_type   text not null check (char_length(action_type) <= 60),
  resource_type text not null check (char_length(resource_type) <= 40),
  resource_id   text,
  client_id     uuid references public.ai_workspace_clients (id) on delete set null,
  job_id        uuid references public.ai_workspace_jobs (id) on delete set null,
  task_id       uuid references public.ai_workspace_tasks (id) on delete set null,
  description   text not null check (char_length(description) <= 500),
  metadata      jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at    timestamptz not null default now()
);

-- ── Generation runs (AI request lifecycle; no secrets, no hidden reasoning) ─
create table if not exists public.ai_workspace_generation_runs (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  job_id            uuid not null,
  task_id           uuid not null,
  conversation_id   uuid not null references public.ai_workspace_conversations (id) on delete restrict,
  tool_type         text not null check (tool_type in ('writing_editing', 'image_creation', 'advertising_copy', 'vehicle_description')),
  provider          text not null default 'openai' check (provider in ('openai')),
  model             text not null check (char_length(model) <= 80),
  status            text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  input_message_id  uuid references public.ai_workspace_messages (id) on delete set null,
  output_message_id uuid references public.ai_workspace_messages (id) on delete set null,
  idempotency_key   text check (idempotency_key is null or char_length(idempotency_key) between 8 and 120),
  request_options   jsonb not null default '{}'::jsonb check (jsonb_typeof(request_options) = 'object'),
  output_metadata   jsonb not null default '{}'::jsonb check (jsonb_typeof(output_metadata) = 'object'),
  error_code        text check (error_code is null or char_length(error_code) <= 80),
  error_message     text check (error_message is null or char_length(error_message) <= 500),
  created_by        uuid references public.ai_workspace_users (id) on delete set null,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  constraint ai_workspace_generation_runs_task_scope_fkey foreign key (task_id, job_id, client_id)
    references public.ai_workspace_tasks (id, job_id, client_id) on update cascade on delete restrict,
  constraint ai_workspace_generation_runs_idem_key unique (created_by, idempotency_key)
);

-- ── Search vectors on core records ──────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_workspace_clients' and column_name = 'search_vector') then
    alter table public.ai_workspace_clients add column search_vector tsvector generated always as (
      to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(industry, '') || ' ' || coalesce(description, '') || ' ' || coalesce(contact_name, '') || ' ' || coalesce(slug, ''))
    ) stored;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_workspace_jobs' and column_name = 'search_vector') then
    alter table public.ai_workspace_jobs add column search_vector tsvector generated always as (
      to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(notes, ''))
    ) stored;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_workspace_tasks' and column_name = 'search_vector') then
    alter table public.ai_workspace_tasks add column search_vector tsvector generated always as (
      to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(notes, ''))
    ) stored;
  end if;
end;
$$;

-- ── Indexes ─────────────────────────────────────────────────────────────────
create index if not exists ai_workspace_clients_status_idx on public.ai_workspace_clients (status, updated_at desc);
create index if not exists ai_workspace_clients_search_idx on public.ai_workspace_clients using gin (search_vector);
create index if not exists ai_workspace_jobs_client_idx on public.ai_workspace_jobs (client_id, updated_at desc);
create index if not exists ai_workspace_jobs_status_idx on public.ai_workspace_jobs (status);
create index if not exists ai_workspace_jobs_search_idx on public.ai_workspace_jobs using gin (search_vector);
create index if not exists ai_workspace_tasks_job_idx on public.ai_workspace_tasks (job_id, updated_at desc);
create index if not exists ai_workspace_tasks_client_idx on public.ai_workspace_tasks (client_id);
create index if not exists ai_workspace_tasks_status_idx on public.ai_workspace_tasks (status, task_type);
create index if not exists ai_workspace_tasks_search_idx on public.ai_workspace_tasks using gin (search_vector);
create index if not exists ai_workspace_conversations_task_idx on public.ai_workspace_conversations (task_id, updated_at desc);
create index if not exists ai_workspace_messages_conversation_idx on public.ai_workspace_messages (conversation_id, created_at);
create index if not exists ai_workspace_messages_search_idx on public.ai_workspace_messages using gin (search_vector);
create index if not exists ai_workspace_files_client_idx on public.ai_workspace_files (client_id, updated_at desc);
create index if not exists ai_workspace_files_task_idx on public.ai_workspace_files (task_id);
create index if not exists ai_workspace_files_job_idx on public.ai_workspace_files (job_id);
create index if not exists ai_workspace_files_output_idx on public.ai_workspace_files (output_id);
create index if not exists ai_workspace_files_search_idx on public.ai_workspace_files using gin (search_vector);
create index if not exists ai_workspace_file_versions_file_idx on public.ai_workspace_file_versions (file_id, version_number desc);
create index if not exists ai_workspace_outputs_task_idx on public.ai_workspace_outputs (task_id, updated_at desc);
create index if not exists ai_workspace_outputs_conversation_idx on public.ai_workspace_outputs (conversation_id);
create index if not exists ai_workspace_outputs_approved_idx on public.ai_workspace_outputs (approved_version_id) where approved_version_id is not null;
create index if not exists ai_workspace_output_versions_output_idx on public.ai_workspace_output_versions (output_id, version_number desc);
create index if not exists ai_workspace_output_versions_search_idx on public.ai_workspace_output_versions using gin (search_vector);
create index if not exists ai_workspace_approvals_output_idx on public.ai_workspace_approvals (output_id, approved_at desc);
create unique index if not exists ai_workspace_approvals_output_version_uidx on public.ai_workspace_approvals (output_version_id) where output_version_id is not null and status = 'approved';
create unique index if not exists ai_workspace_approvals_file_version_uidx on public.ai_workspace_approvals (file_version_id) where file_version_id is not null and output_version_id is null and status = 'approved';
create index if not exists ai_workspace_brand_assets_client_idx on public.ai_workspace_brand_assets (client_id);
create index if not exists ai_workspace_image_presets_client_idx on public.ai_workspace_image_presets (client_id);
create index if not exists ai_workspace_activity_logs_created_idx on public.ai_workspace_activity_logs (created_at desc);
create index if not exists ai_workspace_activity_logs_client_idx on public.ai_workspace_activity_logs (client_id, created_at desc);
create index if not exists ai_workspace_activity_logs_job_idx on public.ai_workspace_activity_logs (job_id, created_at desc);
create index if not exists ai_workspace_activity_logs_task_idx on public.ai_workspace_activity_logs (task_id, created_at desc);
create index if not exists ai_workspace_generation_runs_task_idx on public.ai_workspace_generation_runs (task_id, started_at desc);
create index if not exists ai_workspace_generation_runs_active_idx on public.ai_workspace_generation_runs (created_by, status) where status in ('queued', 'running');

-- ── updated_at triggers ─────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'ai_workspace_users', 'ai_workspace_clients', 'ai_workspace_jobs', 'ai_workspace_tasks',
    'ai_workspace_conversations', 'ai_workspace_files', 'ai_workspace_outputs', 'ai_workspace_brand_assets',
    'ai_workspace_image_presets', 'ai_workspace_ai_instructions', 'ai_workspace_settings'
  ] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.ai_workspace_update_updated_at()',
        t || '_set_updated_at', t
      );
    end if;
  end loop;
end;
$$;
