import { TASK_TYPE_TO_DB } from '../constants/domain.js';
import { clientColumns, clientSummary, iso, jobColumns, jobSummary, rangeInterval, toolId, userColumns, userSummary } from '../utils/mappers.js';
import { assignments, likePattern } from './clients.repository.js';

/** Task fields → columns. Job/client moves are handled explicitly by the service. */
export const TASK_COLUMNS = {
  title: 'title',
  type: 'task_type',
  status: 'status',
  assigneeId: 'assignee_id',
  description: 'description',
  notes: 'notes',
};

const SELECT = `
  t.id, t.title, t.task_type, t.status, t.assignee_id, t.description, t.notes,
  t.created_by, t.created_at, t.updated_at, t.archived_at,
  ${clientColumns('c')}, ${jobColumns('j')}, ${userColumns('a', 'as_')}, ${userColumns('u', 'cu_')},
  (select count(*)::int from public.ai_workspace_conversations cv where cv.task_id = t.id and cv.archived_at is null) as conversation_count,
  (select count(*)::int from public.ai_workspace_messages m
     join public.ai_workspace_conversations cv on cv.id = m.conversation_id
    where cv.task_id = t.id and cv.archived_at is null) as message_count,
  (select count(*)::int from public.ai_workspace_files f where f.task_id = t.id and f.archived_at is null) as file_count,
  oc.output_count, oc.draft_count, oc.approved_count,
  case when oc.output_count = 0 then 'none' when oc.draft_count > 0 then 'draft' else 'approved' end as approval_status`;

const FROM = `
  from public.ai_workspace_tasks t
  join public.ai_workspace_clients c on c.id = t.client_id
  join public.ai_workspace_jobs j on j.id = t.job_id
  left join public.ai_workspace_users a on a.id = t.assignee_id
  left join public.ai_workspace_users u on u.id = t.created_by
  left join lateral (
    select count(*)::int as output_count,
           count(*) filter (where o.current_version_id is distinct from o.approved_version_id)::int as draft_count,
           count(*) filter (where o.approved_version_id is not null)::int as approved_count
      from public.ai_workspace_outputs o
     where o.task_id = t.id and o.archived_at is null
  ) oc on true`;

const SORTS = {
  updated: 'updated_at desc, id',
  created: 'created_at desc, id',
  name: 'lower(title) asc, id',
  client: 'lower(client_name) asc, updated_at desc, id',
};

/** Maps a task row to the Task DTO. */
export function mapTask(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    jobId: row.job_id,
    title: row.title,
    type: toolId(row.task_type),
    status: row.status,
    assigneeId: row.assignee_id,
    description: row.description,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    archivedAt: iso(row.archived_at),
    client: clientSummary(row),
    job: jobSummary(row),
    assignee: userSummary(row, 'as_'),
    createdByUser: userSummary(row, 'cu_'),
    conversationCount: row.conversation_count,
    messageCount: row.message_count,
    fileCount: row.file_count,
    outputCount: row.output_count,
    draftCount: row.draft_count,
    approvedCount: row.approved_count,
    approvalStatus: row.approval_status,
  };
}

/**
 * Lists tasks with filters, sorting and pagination. Archived tasks are excluded unless includeArchived.
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function listTasks(tx, q) {
  const params = [];
  const where = [];
  const eq = (sql, value) => {
    if (!value || value === 'all') return;
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  eq('t.client_id = ?', q.clientId);
  eq('t.job_id = ?', q.jobId);
  eq('t.task_type = ?', q.type && q.type !== 'all' ? TASK_TYPE_TO_DB[q.type] : null);
  eq('t.assignee_id = ?', q.assigneeId);
  if (q.status === 'open') where.push(`t.status <> 'done'`);
  else eq('t.status = ?', q.status);
  eq('t.updated_at >= now() - ?::interval', rangeInterval(q.dateRange));
  if (!q.includeArchived) where.push('t.archived_at is null');
  if (q.search) {
    params.push(likePattern(q.search));
    const p = `$${params.length}`;
    where.push(`(t.title ilike ${p} or t.description ilike ${p} or c.name ilike ${p} or j.title ilike ${p})`);
  }
  const approval = q.approval && q.approval !== 'all' ? q.approval : null;
  if (approval) params.push(approval);
  params.push(q.limit, q.offset);
  const { rows } = await tx.query(
    `with rows as (
       select ${SELECT} ${FROM}
       ${where.length ? `where ${where.join(' and ')}` : ''}
     )
     select *, count(*) over() as total_count from rows
     ${approval ? `where approval_status = $${params.length - 2}` : ''}
     order by ${SORTS[q.sort] || SORTS.updated}
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: rows.map(mapTask), total: Number(rows[0]?.total_count || 0) };
}

/** Finds one task (archived included) with counts, or null. */
export async function findTask(tx, taskId) {
  const { rows } = await tx.query(`select ${SELECT} ${FROM} where t.id = $1`, [taskId]);
  return rows[0] ? mapTask(rows[0]) : null;
}

/** Returns the minimal task row used for business checks (optionally row-locked), or null. */
export async function taskRow(tx, taskId, { lock = false } = {}) {
  const { rows } = await tx.query(
    `select id, client_id, job_id, title, archived_at from public.ai_workspace_tasks where id = $1${lock ? ' for update' : ''}`,
    [taskId],
  );
  return rows[0] || null;
}

/** Inserts a task and returns its id. `values.type` is the API vocabulary. */
export async function insertTask(tx, values, userId) {
  const { rows } = await tx.query(
    `insert into public.ai_workspace_tasks
       (client_id, job_id, title, task_type, status, assignee_id, description, notes, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) returning id`,
    [
      values.clientId,
      values.jobId,
      values.title,
      TASK_TYPE_TO_DB[values.type],
      values.status ?? 'todo',
      values.assigneeId,
      values.description ?? '',
      values.notes ?? '',
      userId,
    ],
  );
  return rows[0].id;
}

/**
 * Updates whitelisted task columns. `move` (job + client) is applied in the
 * same statement so the composite FK cascades to every child row atomically.
 */
export async function updateTask(tx, taskId, userId, values, { move, extra = [] } = {}) {
  const params = [taskId, userId];
  const mapped = values.type ? { ...values, type: TASK_TYPE_TO_DB[values.type] } : values;
  const sets = [...assignments(TASK_COLUMNS, mapped, params), ...extra, 'updated_by = $2'];
  if (move) {
    params.push(move.jobId, move.clientId);
    sets.push(`job_id = $${params.length - 1}`, `client_id = $${params.length}`);
  }
  await tx.query(`update public.ai_workspace_tasks set ${sets.join(', ')} where id = $1`, params);
}

/** True when `userId` is an active workspace member. */
export async function isActiveMember(tx, userId) {
  const { rows } = await tx.query('select 1 from public.ai_workspace_users where id = $1 and is_active', [userId]);
  return rows.length > 0;
}
