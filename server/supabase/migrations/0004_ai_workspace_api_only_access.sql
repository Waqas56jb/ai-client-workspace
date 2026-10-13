-- ============================================================================
-- StudioFlow AI — 0004 API-only data access + re-approval of earlier versions
--
-- ADDITIVE ONLY (create or replace of two ai_workspace_* functions).
--
-- 1. Data API lockdown. Supabase exposes `public` through its REST/RPC Data API,
--    so a member could previously use their own access token to read and write
--    ai_workspace_* tables directly, bypassing the API's validation, audit log
--    and approval rules. Membership now also requires the transaction-local
--    setting `ai_workspace.via_api = 'on'`, which only the API sets (inside the
--    same transaction that switches to the `authenticated` role). Requests that
--    arrive through the Data API cannot set it, so every RLS policy (including
--    the storage.objects policies for the private bucket) denies them.
--
-- 2. Re-approving a version that was approved earlier (e.g. v1 after v2) makes
--    it the current approved version again. Its original approval record is kept
--    (the history is append-only and one approval record exists per version);
--    the API logs the change in the activity history.
-- ============================================================================

create or replace function public.ai_workspace_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_setting('ai_workspace.via_api', true), '') = 'on'
     and exists (
       select 1 from public.ai_workspace_users u
       where u.id = auth.uid() and u.is_active
     );
$$;

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

  if v_version.approval_status = 'approved' then
    -- Approved before: reinstate it as the current approved version, keep its original approval record.
    select * into v_approval from public.ai_workspace_approvals
     where output_version_id = p_version_id and status = 'approved'
     order by approved_at desc limit 1;
  else
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
  end if;

  update public.ai_workspace_outputs
     set approved_version_id = p_version_id, updated_by = auth.uid()
   where id = p_output_id;

  if v_output.file_id is not null then
    update public.ai_workspace_files set approval_status = 'approved', updated_by = auth.uid() where id = v_output.file_id;
  end if;

  return v_approval;
end;
$$;
