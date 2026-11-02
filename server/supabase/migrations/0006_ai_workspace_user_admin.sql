-- Workspace administrators manage members from the Team page: add accounts,
-- set passwords and remove members. Additive only.
--
--   is_admin   — may manage other members (set by provisioning or another administrator).
--   is_managed — the Supabase Auth account was created by this workspace, so an
--                administrator may set its password or block it. Accounts linked from
--                another project on the same Supabase instance stay FALSE and are never touched.
--   removed_at — the member was removed: inactive, hidden from the team list, sign-in blocked.
--                Their past work keeps its author (activity history is append-only).
alter table public.ai_workspace_users add column if not exists is_admin boolean not null default false;
alter table public.ai_workspace_users add column if not exists is_managed boolean not null default false;
alter table public.ai_workspace_users add column if not exists removed_at timestamptz;

-- Members can still update only their own display columns (column grants from 0002);
-- none of the new columns is granted, so nobody can make themselves an administrator.
