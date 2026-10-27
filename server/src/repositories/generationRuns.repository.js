import { iso, toolId, userColumns, userSummary } from '../utils/mappers.js';

/**
 * SQL for the AI module: generation runs plus the read-only context lookups
 * the AI flow needs (task → job → client scope, attachments, outputs).
 *
 * Every function takes an open `tx` from `withUser` (RLS applies) except
 * `failInterruptedRuns`, which is used only by the start-up reconciliation.
 */

const RUN_COLUMNS = `r.id, r.client_id, r.job_id, r.task_id, r.conversation_id, r.tool_type, r.provider, r.model, r.status,
  r.input_message_id, r.output_message_id, r.idempotency_key, r.request_options, r.output_metadata,
  r.error_code, r.error_message, r.created_by, r.started_at, r.completed_at`;

// ── Runs ───────────────────────────────────────────────────────────────────────

export async function insertRun(tx, { id, task, conversationId, toolType, model, inputMessageId, idempotencyKey, requestOptions, userId }) {
  const { rows } = await tx.query(
    `insert into public.ai_workspace_generation_runs as r
       (id, client_id, job_id, task_id, conversation_id, tool_type, model, status, input_message_id, idempotency_key, request_options, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10, $11)
     returning ${RUN_COLUMNS}`,
    [id, task.client_id, task.job_id, task.id, conversationId, toolType, model, inputMessageId, idempotencyKey || null, requestOptions, userId],
  );
  return rows[0];
}

export async function getRun(tx, id) {
  const { rows } = await tx.query(`select ${RUN_COLUMNS} from public.ai_workspace_generation_runs r where r.id = $1`, [id]);
  return rows[0] || null;
}

export async function findRunByIdempotencyKey(tx, userId, key) {
  const { rows } = await tx.query(
    `select ${RUN_COLUMNS} from public.ai_workspace_generation_runs r where r.created_by = $1 and r.idempotency_key = $2`,
    [userId, key],
  );
  return rows[0] || null;
}

/** Serialises concurrent start requests of one user inside the transaction. */
export async function lockUserRuns(tx, userId) {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`ai_runs:${userId}`]);
}

export async function countActiveRuns(tx, userId) {
  const { rows } = await tx.query(
    `select count(*)::int as n from public.ai_workspace_generation_runs where created_by = $1 and status in ('queued', 'running')`,
    [userId],
  );
  return rows[0].n;
}

/** Runs of a conversation that are still waiting or working. */
export async function countActiveRunsInConversation(tx, conversationId) {
  const { rows } = await tx.query(
    `select count(*)::int as n from public.ai_workspace_generation_runs where conversation_id = $1 and status in ('queued', 'running')`,
    [conversationId],
  );
  return rows[0].n;
}

/** queued → running. Returns null when the run is no longer queued. */
export async function markRunning(tx, id) {
  const { rows } = await tx.query(
    `update public.ai_workspace_generation_runs r set status = 'running' where r.id = $1 and r.status = 'queued' returning ${RUN_COLUMNS}`,
    [id],
  );
  return rows[0] || null;
}

export async function markSucceeded(tx, id, { outputMessageId, outputMetadata, model }) {
  const { rows } = await tx.query(
    `update public.ai_workspace_generation_runs r
        set status = 'succeeded', output_message_id = $2, output_metadata = $3, model = coalesce($4, r.model),
            error_code = null, error_message = null, completed_at = now()
      where r.id = $1 and r.status = 'running' returning ${RUN_COLUMNS}`,
    [id, outputMessageId, outputMetadata, model || null],
  );
  return rows[0] || null;
}

export async function markFailed(tx, id, { errorCode, errorMessage, outputMessageId = null }) {
  const { rows } = await tx.query(
    `update public.ai_workspace_generation_runs r
        set status = 'failed', error_code = $2, error_message = $3, output_message_id = coalesce($4, r.output_message_id), completed_at = now()
      where r.id = $1 and r.status in ('queued', 'running') returning ${RUN_COLUMNS}`,
    [id, String(errorCode).slice(0, 80), String(errorMessage).slice(0, 500), outputMessageId],
  );
  return rows[0] || null;
}

/** failed → queued for a retry with the stored input. */
export async function requeueRun(tx, id) {
  const { rows } = await tx.query(
    `update public.ai_workspace_generation_runs r
        set status = 'queued', error_code = null, error_message = null, output_message_id = null,
            output_metadata = '{}'::jsonb, completed_at = null, started_at = now()
      where r.id = $1 and r.status = 'failed' returning ${RUN_COLUMNS}`,
    [id],
  );
  return rows[0] || null;
}

/** Most recent successful run that produced (or revised) an output. */
export async function findRunForOutput(tx, outputId) {
  const { rows } = await tx.query(
    `select ${RUN_COLUMNS} from public.ai_workspace_generation_runs r
      where r.status = 'succeeded' and r.output_metadata -> 'outputIds' @> jsonb_build_array($1::text)
      order by r.started_at asc limit 1`,
    [outputId],
  );
  return rows[0] || null;
}

/**
 * Reconciliation (system connection — see generationQueue.js): queued/running
 * runs that can never finish because the process that owned them is gone.
 * A run is reconciled when it started before `startedBefore` (it belongs to a
 * previous process) or more than `olderThanSeconds` ago (longer than any run can
 * take), and it is not owned by this process (`excludeIds`).
 */
export async function failInterruptedRuns(tx, { olderThanSeconds = 900, startedBefore = null, excludeIds = [] } = {}) {
  const { rows } = await tx.query(
    `update public.ai_workspace_generation_runs
        set status = 'failed', error_code = 'INTERRUPTED',
            error_message = 'The server restarted before this request finished. Retry to send it again.', completed_at = now()
      where status in ('queued', 'running')
        and (started_at < now() - make_interval(secs => $1) or ($2::timestamptz is not null and started_at < $2::timestamptz))
        and not (id = any($3::uuid[]))
      returning id, conversation_id, tool_type, created_by`,
    [olderThanSeconds, startedBefore, excludeIds],
  );
  return rows;
}

/** Fails specific queued/running runs (graceful shutdown of the owning process). */
export async function failRunsById(tx, ids) {
  const { rows } = await tx.query(
    `update public.ai_workspace_generation_runs
        set status = 'failed', error_code = 'INTERRUPTED',
            error_message = 'The server restarted before this request finished. Retry to send it again.', completed_at = now()
      where status in ('queued', 'running') and id = any($1::uuid[])
      returning id, conversation_id, tool_type, created_by`,
    [ids],
  );
  return rows;
}

export async function setRunOutputMessage(tx, id, messageId) {
  await tx.query('update public.ai_workspace_generation_runs set output_message_id = $2 where id = $1', [id, messageId]);
}

export function toRunDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    generationId: row.id,
    status: row.status,
    tool: toolId(row.tool_type),
    model: row.model,
    taskId: row.task_id,
    jobId: row.job_id,
    clientId: row.client_id,
    conversationId: row.conversation_id,
    inputMessageId: row.input_message_id,
    outputMessageId: row.output_message_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
  };
}

// ── Context lookups (RLS-scoped) ───────────────────────────────────────────────

/** Task + its job + its client (only the task's own client). */
export async function getTaskScope(tx, taskId) {
  const { rows } = await tx.query(
    `select to_jsonb(t) as task, to_jsonb(j) as job, to_jsonb(c) - 'search_vector' as client
       from public.ai_workspace_tasks t
       join public.ai_workspace_jobs j on j.id = t.job_id and j.client_id = t.client_id
       join public.ai_workspace_clients c on c.id = t.client_id
      where t.id = $1 and t.archived_at is null`,
    [taskId],
  );
  if (!rows[0]) return null;
  const strip = (o) => {
    if (!o) return o;
    const { search_vector: _sv, ...rest } = o;
    return rest;
  };
  return { task: strip(rows[0].task), job: strip(rows[0].job), client: strip(rows[0].client) };
}

export async function getWorkspaceSettings(tx) {
  const { rows } = await tx.query(
    `select general_writing_preferences, default_tone, default_spelling_convention from public.ai_workspace_settings where id = 1`,
  );
  const s = rows[0];
  if (!s) return null;
  const out = {};
  if (s.general_writing_preferences) out.writingPreferences = s.general_writing_preferences;
  if (s.default_spelling_convention) out.spelling = s.default_spelling_convention;
  if (s.default_tone) out.defaultTone = s.default_tone;
  return out;
}

/** File rows with the storage path of their current physical version. */
export async function getFilesWithPaths(tx, ids) {
  if (!ids?.length) return [];
  const { rows } = await tx.query(
    `select f.id, f.client_id, f.job_id, f.task_id, f.file_name, f.mime_type, f.file_category, f.source_type,
            f.file_size_bytes, coalesce(fv.storage_path, f.storage_path) as object_path
       from public.ai_workspace_files f
       left join public.ai_workspace_file_versions fv on fv.id = f.current_version_id
      where f.id = any($1::uuid[]) and f.archived_at is null`,
    [ids],
  );
  return rows;
}

export async function createConversation(tx, { task, toolType, title, userId }) {
  const { rows } = await tx.query(
    `insert into public.ai_workspace_conversations (client_id, job_id, task_id, title, tool_type, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $6) returning id`,
    [task.client_id, task.job_id, task.id, title, toolType, userId],
  );
  return rows[0].id;
}

export async function touchConversation(tx, id, { toolType, userId }) {
  await tx.query(
    `update public.ai_workspace_conversations set updated_at = now(), tool_type = coalesce(tool_type, $2), updated_by = coalesce($3, updated_by) where id = $1`,
    [id, toolType || null, userId || null],
  );
}

/** Conversation DTO (same shape as the conversations module). */
export async function getConversationDto(tx, id) {
  const { rows } = await tx.query(
    `select c.id, c.task_id, c.title, c.tool_type, c.created_at, c.updated_at, c.created_by, ${userColumns('u', 'u_')},
            (select count(*)::int from public.ai_workspace_messages m where m.conversation_id = c.id) as message_count,
            (select count(*)::int from public.ai_workspace_outputs o where o.conversation_id = c.id and o.archived_at is null) as output_count,
            lm.role as last_role, lm.content as last_content, lm.created_at as last_created_at
       from public.ai_workspace_conversations c
       left join public.ai_workspace_users u on u.id = c.created_by
       left join lateral (
         select role, content, created_at from public.ai_workspace_messages m
          where m.conversation_id = c.id order by created_at desc, id desc limit 1
       ) lm on true
      where c.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    taskId: r.task_id,
    title: r.title,
    tool: toolId(r.tool_type),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    createdBy: r.created_by,
    messageCount: r.message_count,
    outputCount: r.output_count,
    lastMessage: r.last_role ? { role: r.last_role, content: String(r.last_content || '').slice(0, 90), createdAt: iso(r.last_created_at) } : null,
    createdByUser: userSummary(r, 'u_'),
  };
}

/** An output with its current version (used by revise/edit/regenerate). */
export async function getOutputWithCurrentVersion(tx, outputId) {
  const { rows } = await tx.query(
    `select o.id, o.client_id, o.job_id, o.task_id, o.conversation_id, o.tool_type, o.output_kind, o.output_type, o.title,
            o.file_id, o.current_version_id,
            v.id as version_id, v.version_number, v.content, v.sections, v.missing_info, v.image_meta, v.file_version_id,
            fv.storage_path as version_object_path
       from public.ai_workspace_outputs o
       left join public.ai_workspace_output_versions v on v.id = o.current_version_id
       left join public.ai_workspace_file_versions fv on fv.id = v.file_version_id
      where o.id = $1 and o.archived_at is null`,
    [outputId],
  );
  return rows[0] || null;
}

export async function getOutputVersion(tx, outputId, versionId) {
  const { rows } = await tx.query(
    `select v.id as version_id, v.version_number, v.content, v.sections, v.missing_info, v.image_meta, v.file_version_id,
            fv.storage_path as version_object_path
       from public.ai_workspace_output_versions v
       left join public.ai_workspace_file_versions fv on fv.id = v.file_version_id
      where v.id = $1 and v.output_id = $2`,
    [versionId, outputId],
  );
  return rows[0] || null;
}

export async function markTaskInProgress(tx, taskId, userId) {
  await tx.query(
    `update public.ai_workspace_tasks set status = 'in_progress', updated_by = $2 where id = $1 and status = 'todo'`,
    [taskId, userId],
  );
}

/** The writing format most recently used in a conversation (conversation memory), or null. */
export async function lastWritingFormat(tx, conversationId) {
  const { rows } = await tx.query(
    `select r.request_options -> 'options' ->> 'format' as format
       from public.ai_workspace_generation_runs r
       left join public.ai_workspace_messages m on m.id = r.input_message_id
      where r.conversation_id = $1 and r.tool_type = 'writing_editing'
        and r.request_options -> 'options' ->> 'format' in ('email', 'sms', 'whatsapp', 'other')
        and m.metadata ->> 'supersededAt' is null
      order by r.started_at desc limit 1`,
    [conversationId],
  );
  return rows[0]?.format || null;
}

/**
 * Gives a conversation the title of its first result (instead of the raw first
 * prompt), so the chat history reads well. Later results never rename it.
 */
export async function titleConversationFromFirstOutput(tx, conversationId, title, newOutputIds) {
  await tx.query(
    `update public.ai_workspace_conversations c set title = left($2, 120)
      where c.id = $1
        and not exists (select 1 from public.ai_workspace_outputs o where o.conversation_id = $1 and not (o.id = any($3::uuid[])))`,
    [conversationId, title, newOutputIds],
  );
}
