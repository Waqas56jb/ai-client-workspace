# Database migrations — review & apply safely

The Supabase database is **shared with other projects**. These migrations are written to be strictly additive and to touch only objects named `ai_workspace_*` (plus one private storage bucket, `ai-workspace-files`).

## What each migration creates

| File | Creates |
| --- | --- |
| `0001_ai_workspace_core.sql` | 17 tables (`ai_workspace_users`, `_clients`, `_jobs`, `_tasks`, `_conversations`, `_messages`, `_files`, `_file_versions`, `_outputs`, `_output_versions`, `_approvals`, `_brand_assets`, `_image_presets`, `_ai_instructions`, `_settings`, `_activity_logs`, `_generation_runs`), their constraints, full-text search columns, indexes, and `updated_at` triggers backed by `ai_workspace_update_updated_at()`. |
| `0002_ai_workspace_security_and_functions.sql` | `ai_workspace_is_member()`, Row Level Security + member-only policies on every application table, least-privilege grants (no `anon` access), immutability triggers for versions/approvals/activity, and the atomic functions `ai_workspace_create_output_version`, `ai_workspace_approve_output_version`, `ai_workspace_next_file_version_number`, `ai_workspace_approve_file_version`. |
| `0003_ai_workspace_storage.sql` | The **private** bucket `ai-workspace-files` (only if absent) and two member-only read/insert policies on `storage.objects` scoped to that bucket. |

The runner additionally creates `ai_workspace_schema_migrations` to record what has been applied (name + checksum).

Nothing is dropped, truncated, renamed or altered outside `ai_workspace_*`. No extensions are created (`gen_random_uuid()` is built into PostgreSQL 13+). No trigger is added to `auth.users` — workspace membership is provisioned explicitly.

## Integrity rules enforced by the database

- **Client/job/task consistency:** composite foreign keys (`(job_id, client_id) → jobs(id, client_id)`, `(task_id, job_id, client_id) → tasks(...)`) make it impossible for a task, conversation, output, file, approval or generation run to point at a job or task of a different client. `ON UPDATE CASCADE` moves children when a job is reassigned.
- **Immutable history:** output and file versions cannot be edited or deleted (only draft → approved), and approvals and activity are append-only.
- **Unique version numbers:** `unique (output_id, version_number)` and `unique (file_id, version_number)`, with row-locked allocation in the SQL functions.
- **Membership:** RLS lets only users with an *active* `ai_workspace_users` row read or write data. Other Supabase users on the same instance see nothing.

## Procedure

1. **Back up first.** On a paid plan, confirm a recent daily backup or enable PITR in *Database → Backups*. On the free plan, take a manual `pg_dump` of the database.
2. **Inspect (read-only):** `npm run db:inspect`. This runs in a READ ONLY transaction that is rolled back.
3. **Dry run:** `npm run db:migrate`. This prints the preflight result and the plan, and changes nothing.
4. **Review** the plan and the SQL files.
5. **Apply:** `npm run db:migrate -- --apply`. Each file runs in its own transaction and is recorded with its checksum.
6. **Seed configuration:** `npm run db:seed`. This adds the four AI instruction templates, six starter presets and the settings row only if they're missing. It never overwrites anything and creates no users.
7. **Provision members:** `npm run users:provision -- --email … --name "…" --role "…"`.

The runner refuses to continue when:
- a file fails the static safety check (`scripts/lib/migrationSafety.js`)
- `ai_workspace_*` tables exist without migration history
- a public bucket already uses the id `ai-workspace-files`
- an already-applied file has been modified

Migrations are **never** run on application start.

## Changing the schema later

Add a new numbered file such as `0004_….sql`. Never edit an applied file, because its checksum is verified. Keep new changes additive. Any destructive change needs explicit human approval and a separate, manually reviewed procedure.
