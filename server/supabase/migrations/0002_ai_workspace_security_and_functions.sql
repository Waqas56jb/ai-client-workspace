-- ============================================================================
-- StudioFlow AI — 0002 security model, immutability guards, atomic operations
--
-- ADDITIVE ONLY. Policies, grants and functions apply exclusively to
-- `ai_workspace_` objects. Nothing here changes other projects' tables.
-- ============================================================================

-- ── Membership check ────────────────────────────────────────────────────────
-- A Supabase Auth user is a workspace member only if an ACTIVE profile row
-- exists. An arbitrary authenticated user from another project is NOT a member.
-- SECURITY DEFINER so policies on ai_workspace_users itself do not recurse.
create or replace function public.ai_workspace_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ai_workspace_users u
    where u.id = auth.uid() and u.is_active
  );
$$;

revoke all on function public.ai_workspace_is_member() from public;
revoke all on function public.ai_workspace_is_member() from anon;
grant execute on function public.ai_workspace_is_member() to authenticated;

-- ── Least privilege: no anonymous access to any application table ───────────
alter table public.ai_workspace_users enable row level security;
revoke all on table public.ai_workspace_users from anon;
grant select, insert, update on table public.ai_workspace_users to authenticated;
alter table public.ai_workspace_clients enable row level security;
revoke all on table public.ai_workspace_clients from anon;
grant select, insert, update on table public.ai_workspace_clients to authenticated;
alter table public.ai_workspace_jobs enable row level security;
revoke all on table public.ai_workspace_jobs from anon;
grant select, insert, update on table public.ai_workspace_jobs to authenticated;
alter table public.ai_workspace_tasks enable row level security;
revoke all on table public.ai_workspace_tasks from anon;
grant select, insert, update on table public.ai_workspace_tasks to authenticated;
alter table public.ai_workspace_conversations enable row level security;
revoke all on table public.ai_workspace_conversations from anon;
grant select, insert, update on table public.ai_workspace_conversations to authenticated;
alter table public.ai_workspace_messages enable row level security;
revoke all on table public.ai_workspace_messages from anon;
grant select, insert, update on table public.ai_workspace_messages to authenticated;
alter table public.ai_workspace_files enable row level security;
revoke all on table public.ai_workspace_files from anon;
grant select, insert, update on table public.ai_workspace_files to authenticated;
alter table public.ai_workspace_file_versions enable row level security;
revoke all on table public.ai_workspace_file_versions from anon;
grant select, insert, update on table public.ai_workspace_file_versions to authenticated;
alter table public.ai_workspace_outputs enable row level security;
revoke all on table public.ai_workspace_outputs from anon;
grant select, insert, update on table public.ai_workspace_outputs to authenticated;
alter table public.ai_workspace_output_versions enable row level security;
revoke all on table public.ai_workspace_output_versions from anon;
grant select, insert, update on table public.ai_workspace_output_versions to authenticated;
alter table public.ai_workspace_approvals enable row level security;
revoke all on table public.ai_workspace_approvals from anon;
grant select, insert, update on table public.ai_workspace_approvals to authenticated;
alter table public.ai_workspace_brand_assets enable row level security;
revoke all on table public.ai_workspace_brand_assets from anon;
grant select, insert, update on table public.ai_workspace_brand_assets to authenticated;
alter table public.ai_workspace_image_presets enable row level security;
revoke all on table public.ai_workspace_image_presets from anon;
grant select, insert, update on table public.ai_workspace_image_presets to authenticated;
alter table public.ai_workspace_ai_instructions enable row level security;
revoke all on table public.ai_workspace_ai_instructions from anon;
grant select, insert, update on table public.ai_workspace_ai_instructions to authenticated;
alter table public.ai_workspace_settings enable row level security;
revoke all on table public.ai_workspace_settings from anon;
grant select, insert, update on table public.ai_workspace_settings to authenticated;
alter table public.ai_workspace_activity_logs enable row level security;
revoke all on table public.ai_workspace_activity_logs from anon;
grant select, insert, update on table public.ai_workspace_activity_logs to authenticated;
alter table public.ai_workspace_generation_runs enable row level security;
revoke all on table public.ai_workspace_generation_runs from anon;
grant select, insert, update on table public.ai_workspace_generation_runs to authenticated;

-- Hard deletes are only allowed where nothing historical depends on the row
grant delete on table public.ai_workspace_brand_assets to authenticated;

-- ── Row Level Security policies (members only) ──────────────────────────────
do $$
declare
  t text;
begin
  -- Shared workspace tables: any ACTIVE member may read and write
  foreach t in array array[
    'ai_workspace_clients', 'ai_workspace_jobs', 'ai_workspace_tasks', 'ai_workspace_conversations',
    'ai_workspace_messages', 'ai_workspace_files', 'ai_workspace_file_versions', 'ai_workspace_outputs',
    'ai_workspace_output_versions', 'ai_workspace_approvals', 'ai_workspace_brand_assets',
    'ai_workspace_image_presets', 'ai_workspace_ai_instructions', 'ai_workspace_settings',
    'ai_workspace_activity_logs', 'ai_workspace_generation_runs'
  ] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_member_select') then
      execute format('create policy %I on public.%I for select to authenticated using (public.ai_workspace_is_member())', t || '_member_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_member_insert') then
      execute format('create policy %I on public.%I for insert to authenticated with check (public.ai_workspace_is_member())', t || '_member_insert', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_member_update') then
      execute format('create policy %I on public.%I for update to authenticated using (public.ai_workspace_is_member()) with check (public.ai_workspace_is_member())', t || '_member_update', t);
    end if;
  end loop;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_workspace_brand_assets' and policyname = 'ai_workspace_brand_assets_member_delete') then
    create policy ai_workspace_brand_assets_member_delete on public.ai_workspace_brand_assets
      for delete to authenticated using (public.ai_workspace_is_member());
  end if;

  -- Profiles: members can see the team; each member can update only their own row
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_workspace_users' and policyname = 'ai_workspace_users_member_select') then
    create policy ai_workspace_users_member_select on public.ai_workspace_users
      for select to authenticated using (public.ai_workspace_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_workspace_users' and policyname = 'ai_workspace_users_self_update') then
    create policy ai_workspace_users_self_update on public.ai_workspace_users
      for update to authenticated using (id = auth.uid() and public.ai_workspace_is_member()) with check (id = auth.uid());
  end if;
end;
$$;

-- Users cannot grant themselves membership or change identity fields
revoke insert on table public.ai_workspace_users from authenticated;
revoke update on table public.ai_workspace_users from authenticated;
grant update (display_name, role_title, avatar_colour, avatar_path, last_active_at) on table public.ai_workspace_users to authenticated;

-- Activity is append-only for members
revoke update on table public.ai_workspace_activity_logs from authenticated;
-- Approval history is append-only for members
revoke update on table public.ai_workspace_approvals from authenticated;

-- ── Immutability guards ─────────────────────────────────────────────────────
-- Output versions: content is immutable. Only the approval fields may change,
-- and only from draft → approved.
create or replace function public.ai_workspace_output_versions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ai_workspace: output versions are immutable and cannot be deleted' using errcode = '42501';
  end if;
  if new.output_id is distinct from old.output_id
     or new.version_number is distinct from old.version_number
     or new.content is distinct from old.content
     or new.sections is distinct from old.sections
     or new.missing_info is distinct from old.missing_info
     or new.image_meta is distinct from old.image_meta
     or new.file_version_id is distinct from old.file_version_id
     or new.title is distinct from old.title
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'ai_workspace: output version content is immutable — create a new revision instead' using errcode = '42501';
  end if;
  if old.approval_status = 'approved' and new.approval_status <> 'approved' then
    raise exception 'ai_workspace: an approved version cannot be returned to draft' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.ai_workspace_file_versions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ai_workspace: file versions are immutable and cannot be deleted' using errcode = '42501';
  end if;
  if new.file_id is distinct from old.file_id
     or new.version_number is distinct from old.version_number
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path
     or new.file_checksum is distinct from old.file_checksum
     or new.file_size_bytes is distinct from old.file_size_bytes
     or new.metadata is distinct from old.metadata
     or new.created_at is distinct from old.created_at then
    raise exception 'ai_workspace: file version bytes and metadata are immutable' using errcode = '42501';
  end if;
  if old.approval_status = 'approved' and new.approval_status <> 'approved' then
    raise exception 'ai_workspace: an approved file version cannot be returned to draft' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.ai_workspace_append_only_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Deletes are never allowed. The only permitted UPDATE is a change of the
  -- scope columns (client_id / job_id / task_id) made by the foreign-key
  -- cascades when a job or task is moved, or set to NULL when a referenced row
  -- goes away. Members have no UPDATE privilege on these tables at all.
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['client_id', 'job_id', 'task_id']) = (to_jsonb(old) - array['client_id', 'job_id', 'task_id']) then
    return new;
  end if;
  raise exception 'ai_workspace: % rows are append-only', tg_table_name using errcode = '42501';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ai_workspace_output_versions_immutable' and tgrelid = 'public.ai_workspace_output_versions'::regclass) then
    create trigger ai_workspace_output_versions_immutable before update or delete on public.ai_workspace_output_versions
      for each row execute function public.ai_workspace_output_versions_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ai_workspace_file_versions_immutable' and tgrelid = 'public.ai_workspace_file_versions'::regclass) then
    create trigger ai_workspace_file_versions_immutable before update or delete on public.ai_workspace_file_versions
      for each row execute function public.ai_workspace_file_versions_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ai_workspace_approvals_append_only' and tgrelid = 'public.ai_workspace_approvals'::regclass) then
    create trigger ai_workspace_approvals_append_only before update or delete on public.ai_workspace_approvals
      for each row execute function public.ai_workspace_append_only_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ai_workspace_activity_logs_append_only' and tgrelid = 'public.ai_workspace_activity_logs'::regclass) then
    create trigger ai_workspace_activity_logs_append_only before update or delete on public.ai_workspace_activity_logs
      for each row execute function public.ai_workspace_append_only_guard();
  end if;
end;
$$;

-- ── Atomic operations (SECURITY INVOKER → RLS still applies) ─────────────────

-- Creates the next immutable version of an output. Locks the parent output row
-- so concurrent revisions get distinct version numbers (also backed by the
-- unique (output_id, version_number) constraint).
create or replace function public.ai_workspace_create_output_version(
  p_output_id uuid,
  p_content text default null,
  p_sections jsonb default null,
  p_missing_info jsonb default null,
  p_image_meta jsonb default null,
  p_file_version_id uuid default null,
  p_revision_note text default '',
  p_source_version_id uuid default null
)
returns public.ai_workspace_output_versions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_output public.ai_workspace_outputs;
  v_source public.ai_workspace_output_versions;
  v_next integer;
  v_row public.ai_workspace_output_versions;
begin
  if not public.ai_workspace_is_member() then
    raise exception 'ai_workspace: not a workspace member' using errcode = '42501';
  end if;

  select * into v_output from public.ai_workspace_outputs where id = p_output_id and archived_at is null for update;
  if not found then
    raise exception 'ai_workspace: output not found' using errcode = 'P0002';
  end if;

  if p_source_version_id is not null then
    select * into v_source from public.ai_workspace_output_versions where id = p_source_version_id and output_id = p_output_id;
    if not found then
      raise exception 'ai_workspace: source version does not belong to this output' using errcode = '22023';
    end if;
  elsif v_output.current_version_id is not null then
    select * into v_source from public.ai_workspace_output_versions where id = v_output.current_version_id;
  end if;

  if p_file_version_id is not null and not exists (
    select 1 from public.ai_workspace_file_versions fv
    where fv.id = p_file_version_id and fv.file_id = v_output.file_id
  ) then
    raise exception 'ai_workspace: file version does not belong to this output' using errcode = '22023';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.ai_workspace_output_versions where output_id = p_output_id;

  insert into public.ai_workspace_output_versions (
    output_id, task_id, conversation_id, output_type, title, version_number,
    content, sections, missing_info, image_meta, file_version_id,
    source_version_id, revision_note, approval_status, created_by
  ) values (
    p_output_id, v_output.task_id, v_output.conversation_id, v_output.output_type, v_output.title, v_next,
    coalesce(p_content, v_source.content, ''),
    coalesce(p_sections, v_source.sections),
    coalesce(p_missing_info, v_source.missing_info),
    coalesce(p_image_meta, v_source.image_meta),
    coalesce(p_file_version_id, v_source.file_version_id),
    v_source.id, coalesce(p_revision_note, ''), 'draft', auth.uid()
  )
  returning * into v_row;

  update public.ai_workspace_outputs
     set current_version_id = v_row.id, updated_by = auth.uid()
   where id = p_output_id;

  if v_output.file_id is not null then
    update public.ai_workspace_files
       set updated_by = auth.uid(),
           approval_status = case when v_output.approved_version_id is null then 'draft' else 'approved' end
     where id = v_output.file_id;
  end if;

  return v_row;
end;
$$;

-- Approves one specific immutable output version and moves the output's
-- approved reference to it. Previous approvals stay in history.
create or replace function public.ai_workspace_approve_output_version(
  p_output_id uuid,
  p_version_id uuid,
  p_notes text default ''
)
returns public.ai_workspace_approvals
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_output public.ai_workspace_outputs;
  v_version public.ai_workspace_output_versions;
  v_approval public.ai_workspace_approvals;
begin
  if not public.ai_workspace_is_member() then
    raise exception 'ai_workspace: not a workspace member' using errcode = '42501';
  end if;

  select * into v_output from public.ai_workspace_outputs where id = p_output_id and archived_at is null for update;
  if not found then
    raise exception 'ai_workspace: output not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.ai_workspace_output_versions where id = p_version_id and output_id = p_output_id;
  if not found then
    raise exception 'ai_workspace: version does not belong to this output' using errcode = '22023';
  end if;

  if v_output.approved_version_id = p_version_id then
    raise exception 'ai_workspace: this version is already the approved version' using errcode = '23505';
  end if;

  update public.ai_workspace_output_versions
     set approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_version_id and approval_status = 'draft';

  if v_version.file_version_id is not null then
    update public.ai_workspace_file_versions
       set approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
     where id = v_version.file_version_id and approval_status = 'draft';
  end if;

  insert into public.ai_workspace_approvals (
    client_id, job_id, task_id, output_id, output_version_id, file_id, file_version_id,
    status, approved_by, approved_at, notes
  ) values (
    v_output.client_id, v_output.job_id, v_output.task_id, p_output_id, p_version_id,
    v_output.file_id, v_version.file_version_id, 'approved', auth.uid(), now(), coalesce(p_notes, '')
  )
  returning * into v_approval;

  update public.ai_workspace_outputs
     set approved_version_id = p_version_id, updated_by = auth.uid()
   where id = p_output_id;

  if v_output.file_id is not null then
    update public.ai_workspace_files set approval_status = 'approved', updated_by = auth.uid() where id = v_output.file_id;
  end if;

  return v_approval;
end;
$$;

-- Allocates the next physical file version number for a file (row-locked).
create or replace function public.ai_workspace_next_file_version_number(p_file_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next integer;
begin
  if not public.ai_workspace_is_member() then
    raise exception 'ai_workspace: not a workspace member' using errcode = '42501';
  end if;
  perform 1 from public.ai_workspace_files where id = p_file_id for update;
  if not found then
    raise exception 'ai_workspace: file not found' using errcode = 'P0002';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next from public.ai_workspace_file_versions where file_id = p_file_id;
  return v_next;
end;
$$;

-- Approves a physical file version of a non-output file (uploads/references).
create or replace function public.ai_workspace_approve_file_version(
  p_file_id uuid,
  p_version_id uuid,
  p_notes text default ''
)
returns public.ai_workspace_approvals
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_file public.ai_workspace_files;
  v_approval public.ai_workspace_approvals;
begin
  if not public.ai_workspace_is_member() then
    raise exception 'ai_workspace: not a workspace member' using errcode = '42501';
  end if;
  select * into v_file from public.ai_workspace_files where id = p_file_id and archived_at is null for update;
  if not found then
    raise exception 'ai_workspace: file not found' using errcode = 'P0002';
  end if;
  if v_file.task_id is null then
    raise exception 'ai_workspace: only task files can be approved' using errcode = '22023';
  end if;
  if v_file.output_id is not null then
    raise exception 'ai_workspace: approve generated outputs through their output version' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ai_workspace_file_versions where id = p_version_id and file_id = p_file_id) then
    raise exception 'ai_workspace: version does not belong to this file' using errcode = '22023';
  end if;
  if exists (select 1 from public.ai_workspace_file_versions where id = p_version_id and approval_status = 'approved') then
    raise exception 'ai_workspace: this file version is already approved' using errcode = '23505';
  end if;

  update public.ai_workspace_file_versions
     set approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_version_id;

  insert into public.ai_workspace_approvals (client_id, job_id, task_id, file_id, file_version_id, status, approved_by, notes)
  values (v_file.client_id, v_file.job_id, v_file.task_id, p_file_id, p_version_id, 'approved', auth.uid(), coalesce(p_notes, ''))
  returning * into v_approval;

  update public.ai_workspace_files set approval_status = 'approved', updated_by = auth.uid() where id = p_file_id;
  return v_approval;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.ai_workspace_create_output_version(uuid, text, jsonb, jsonb, jsonb, uuid, text, uuid)',
    'public.ai_workspace_approve_output_version(uuid, uuid, text)',
    'public.ai_workspace_next_file_version_number(uuid)',
    'public.ai_workspace_approve_file_version(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
