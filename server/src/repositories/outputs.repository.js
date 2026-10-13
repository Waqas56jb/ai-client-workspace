import { clientColumns, jobColumns, taskColumns, userColumns } from '../utils/mappers.js';

/**
 * SQL for ai_workspace_outputs. All queries run inside a `withUser`
 * transaction, so RLS applies. Filters are always parameterised; sort columns
 * come from fixed whitelists.
 */

const OUTPUT_SELECT = `
  select o.*,
         ${clientColumns('c')}, c.name as client_sort_name,
         ${jobColumns('j')},
         ${taskColumns('t')},
         ${userColumns('cu', 'creator_')},
         (select count(*)::int from public.ai_workspace_output_versions vc where vc.output_id = o.id) as version_count
    from public.ai_workspace_outputs o
    join public.ai_workspace_clients c on c.id = o.client_id
    join public.ai_workspace_jobs j on j.id = o.job_id
    join public.ai_workspace_tasks t on t.id = o.task_id
    left join public.ai_workspace_users cu on cu.id = o.created_by`;

/** Escapes LIKE wildcards in user search input. */
export const likePattern = (s) => `%${String(s).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** Inserts an output row (current/approved version ids are set later). */
export async function insertOutput(tx, o) {
  const { rows } = await tx.query(
    `insert into public.ai_workspace_outputs
       (client_id, job_id, task_id, conversation_id, tool_type, output_kind, output_type, title, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     returning *`,
    [o.clientId, o.jobId, o.taskId, o.conversationId || null, o.toolType, o.kind, o.outputType, o.title, o.userId],
  );
  return rows[0];
}

export async function setOutputFile(tx, outputId, fileId) {
  await tx.query('update public.ai_workspace_outputs set file_id = $2 where id = $1', [outputId, fileId]);
}

/** Plain output row (no joins), optionally row-locked. Excludes archived outputs. */
export async function findOutputRow(tx, id, { forUpdate = false } = {}) {
  const { rows } = await tx.query(
    `select * from public.ai_workspace_outputs where id = $1 and archived_at is null ${forUpdate ? 'for update' : ''}`,
    [id],
  );
  return rows[0] || null;
}

/** Output row with client/job/task/creator summaries. */
export async function findOutputById(tx, id) {
  const { rows } = await tx.query(`${OUTPUT_SELECT} where o.id = $1 and o.archived_at is null`, [id]);
  return rows[0] || null;
}

export async function findOutputsByIds(tx, ids) {
  if (!ids.length) return [];
  const { rows } = await tx.query(`${OUTPUT_SELECT} where o.id = any($1::uuid[])`, [ids]);
  return rows;
}

export async function updateOutputTitle(tx, id, title, userId) {
  const { rows } = await tx.query(
    'update public.ai_workspace_outputs set title = $2, updated_by = $3 where id = $1 and archived_at is null returning *',
    [id, title, userId],
  );
  return rows[0] || null;
}

const OUTPUT_SORTS = {
  updated: 'o.updated_at desc, o.id',
  created: 'o.created_at desc, o.id',
  title: 'lower(o.title) asc, o.id',
};

/**
 * Lists outputs.
 * @param {object} f — { taskId, conversationId, clientId, jobId, toolType, kind, status, search, sort }
 */
export async function listOutputs(tx, f, { limit, offset }) {
  const where = ['o.archived_at is null'];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (f.taskId) add('o.task_id = ?', f.taskId);
  if (f.conversationId) add('o.conversation_id = ?', f.conversationId);
  if (f.clientId) add('o.client_id = ?', f.clientId);
  if (f.jobId) add('o.job_id = ?', f.jobId);
  if (f.toolType) add('o.tool_type = ?', f.toolType);
  if (f.kind) add('o.output_kind = ?', f.kind);
  if (f.status === 'approved') where.push('o.approved_version_id is not null');
  if (f.status === 'draft') where.push('o.approved_version_id is null');
  if (f.search) {
    add(
      `(o.title ilike ? or exists (select 1 from public.ai_workspace_output_versions sv
         where sv.id = o.current_version_id and (sv.content ilike ? or coalesce(sv.sections::text, '') ilike ?
              or coalesce(sv.image_meta->>'prompt', '') ilike ?)))`,
      likePattern(f.search),
    );
  }
  const whereSql = where.join(' and ');
  const { rows: countRows } = await tx.query(`select count(*)::int as n from public.ai_workspace_outputs o where ${whereSql}`, params);
  const order = OUTPUT_SORTS[f.sort] || OUTPUT_SORTS.updated;
  const { rows } = await tx.query(
    `${OUTPUT_SELECT} where ${whereSql} order by ${order} limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  return { rows, total: countRows[0].n };
}

const APPROVED_SORTS = {
  approved: 'av.approved_at desc, o.id',
  title: 'lower(o.title) asc, o.id',
  client: 'lower(c.name) asc, av.approved_at desc, o.id',
};

/**
 * Outputs that currently have an approved version. Filters (dateRange,
 * approvedBy, search) apply to the APPROVED version, never to newer drafts.
 * @param {object} f — { clientId, jobId, taskId, kind, toolType, approvedBy, interval, search, sort }
 */
export async function listApprovedOutputs(tx, f, { limit, offset }) {
  const where = ['o.archived_at is null', 'o.approved_version_id is not null'];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (f.clientId) add('o.client_id = ?', f.clientId);
  if (f.jobId) add('o.job_id = ?', f.jobId);
  if (f.taskId) add('o.task_id = ?', f.taskId);
  if (f.kind) add('o.output_kind = ?', f.kind);
  if (f.toolType) add('o.tool_type = ?', f.toolType);
  if (f.approvedBy) add('av.approved_by = ?', f.approvedBy);
  if (f.interval) add('av.approved_at >= now() - ?::interval', f.interval);
  if (f.search) {
    add(
      `(o.title ilike ? or c.name ilike ? or j.title ilike ? or t.title ilike ? or av.content ilike ?
        or coalesce(av.sections::text, '') ilike ? or coalesce(av.image_meta->>'prompt', '') ilike ?)`,
      likePattern(f.search),
    );
  }
  const from = `
    from public.ai_workspace_outputs o
    join public.ai_workspace_output_versions av on av.id = o.approved_version_id
    join public.ai_workspace_clients c on c.id = o.client_id
    join public.ai_workspace_jobs j on j.id = o.job_id
    join public.ai_workspace_tasks t on t.id = o.task_id`;
  const whereSql = where.join(' and ');
  const { rows: countRows } = await tx.query(`select count(*)::int as n ${from} where ${whereSql}`, params);
  const order = APPROVED_SORTS[f.sort] || APPROVED_SORTS.approved;
  const { rows: idRows } = await tx.query(
    `select o.id ${from} where ${whereSql} order by ${order} limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  const ids = idRows.map((r) => r.id);
  const rows = await findOutputsByIds(tx, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { rows: ids.map((id) => byId.get(id)).filter(Boolean), total: countRows[0].n };
}
