import { clientColumns, clientSummary, iso, userColumns, userSummary } from '../utils/mappers.js';
import { assignments, likePattern } from './clients.repository.js';

/** Job fields → columns (status/archival handled by the service). */
export const JOB_COLUMNS = {
  clientId: 'client_id',
  title: 'title',
  description: 'description',
  status: 'status',
  deadline: 'deadline',
  notes: 'notes',
};

const SELECT = `
  j.id, j.title, j.description, j.status, to_char(j.deadline, 'YYYY-MM-DD') as deadline_text, j.notes,
  j.created_by, j.created_at, j.updated_at, j.archived_at,
  ${clientColumns('c')}, ${userColumns('u', 'cu_')},
  (select count(*)::int from public.ai_workspace_tasks t where t.job_id = j.id and t.archived_at is null) as task_count,
  (select count(*)::int from public.ai_workspace_tasks t where t.job_id = j.id and t.archived_at is null and t.status = 'done') as done_task_count,
  (select count(*)::int from public.ai_workspace_files f where f.job_id = j.id and f.archived_at is null) as file_count,
  oc.output_count, oc.draft_count, oc.approved_count`;

const FROM = `
  from public.ai_workspace_jobs j
  join public.ai_workspace_clients c on c.id = j.client_id
  left join public.ai_workspace_users u on u.id = j.created_by
  left join lateral (
    select count(*)::int as output_count,
           count(*) filter (where o.current_version_id is distinct from o.approved_version_id)::int as draft_count,
           count(*) filter (where o.approved_version_id is not null)::int as approved_count
      from public.ai_workspace_outputs o
     where o.job_id = j.id and o.archived_at is null
  ) oc on true`;

const SORTS = {
  updated: 'j.updated_at desc, j.id',
  created: 'j.created_at desc, j.id',
  name: 'lower(j.title) asc, j.id',
  deadline: 'j.deadline asc nulls last, j.updated_at desc, j.id',
};

/** Maps a job row to the Job DTO. */
export function mapJob(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    description: row.description,
    status: row.status,
    deadline: row.deadline_text || '',
    notes: row.notes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    archivedAt: iso(row.archived_at),
    createdBy: row.created_by,
    client: clientSummary(row),
    taskCount: row.task_count,
    doneTaskCount: row.done_task_count,
    fileCount: row.file_count,
    draftCount: row.draft_count,
    approvedCount: row.approved_count,
    outputCount: row.output_count,
    createdByUser: userSummary(row, 'cu_'),
  };
}

/**
 * Lists jobs. Archived jobs are excluded unless status is 'archived'/'all' or includeArchived.
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function listJobs(tx, { search, clientId, status, includeArchived, sort, limit, offset }) {
  const params = [];
  const where = [];
  const eq = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (clientId && clientId !== 'all') eq('j.client_id = ?', clientId);
  if (status && status !== 'all') eq('j.status = ?', status);
  else if (!includeArchived && status !== 'all') where.push(`j.status <> 'archived'`);
  if (search) {
    params.push(likePattern(search));
    const p = `$${params.length}`;
    where.push(`(j.title ilike ${p} or j.description ilike ${p} or c.name ilike ${p})`);
  }
  params.push(limit, offset);
  const { rows } = await tx.query(
    `select ${SELECT}, count(*) over() as total_count ${FROM}
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by ${SORTS[sort] || SORTS.updated}
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: rows.map(mapJob), total: Number(rows[0]?.total_count || 0) };
}

/** Finds one job (any status) with counts, or null. */
export async function findJob(tx, jobId) {
  const { rows } = await tx.query(`select ${SELECT} ${FROM} where j.id = $1`, [jobId]);
  return rows[0] ? mapJob(rows[0]) : null;
}

/** Returns the minimal job row used for business checks (optionally row-locked), or null. */
export async function jobRow(tx, jobId, { lock = false } = {}) {
  const { rows } = await tx.query(`select id, client_id, title, status from public.ai_workspace_jobs where id = $1${lock ? ' for update' : ''}`, [jobId]);
  return rows[0] || null;
}

/** Inserts a job and returns its id. */
export async function insertJob(tx, values, userId) {
  const { rows } = await tx.query(
    `insert into public.ai_workspace_jobs (client_id, title, description, status, deadline, notes, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $7) returning id`,
    [values.clientId, values.title, values.description ?? '', values.status ?? 'active', values.deadline ?? null, values.notes ?? '', userId],
  );
  return rows[0].id;
}

/**
 * Updates whitelisted job columns. Changing client_id cascades through the
 * composite foreign keys to tasks, conversations, outputs, files, runs and approvals.
 */
export async function updateJob(tx, jobId, userId, values, extra = []) {
  const params = [jobId, userId];
  const sets = [...assignments(JOB_COLUMNS, values, params), ...extra, 'updated_by = $2'];
  await tx.query(`update public.ai_workspace_jobs set ${sets.join(', ')} where id = $1`, params);
}

/** Marks a job as recently worked on (bumps updated_at through the trigger). */
export async function touchJob(tx, jobId, userId) {
  await tx.query('update public.ai_workspace_jobs set updated_by = $2 where id = $1', [jobId, userId]);
}
