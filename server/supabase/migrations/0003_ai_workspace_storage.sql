-- ============================================================================
-- StudioFlow AI — 0003 private storage bucket
--
-- ADDITIVE ONLY. Creates ONE new private bucket `ai-workspace-files` if it does
-- not already exist. Existing buckets (other projects) are never modified,
-- emptied, reused or deleted. Policies are scoped to this bucket only.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-workspace-files',
  'ai-workspace-files',
  false,                       -- PRIVATE: access only through signed URLs / the backend
  52428800,                    -- 50 MB hard ceiling (the API enforces MAX_UPLOAD_SIZE_MB below this)
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

-- Member-only object policies, scoped to this bucket. The backend uses the
-- service role for storage after its own authorisation checks; these policies
-- are defence in depth for any direct Supabase client access.
-- Wrapped so that a project where the migration role cannot create policies on
-- storage.objects keeps working (the bucket simply stays service-role only).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ai_workspace_files_member_read') then
    create policy ai_workspace_files_member_read on storage.objects
      for select to authenticated
      using (bucket_id = 'ai-workspace-files' and public.ai_workspace_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ai_workspace_files_member_insert') then
    create policy ai_workspace_files_member_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'ai-workspace-files' and public.ai_workspace_is_member());
  end if;
exception
  when insufficient_privilege then
    raise notice 'ai_workspace: skipped storage.objects policies (insufficient privilege); bucket remains private and service-role only';
end;
$$;
