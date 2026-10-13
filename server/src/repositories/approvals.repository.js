import { clientColumns, jobColumns, taskColumns, userColumns } from '../utils/mappers.js';

/**
 * SQL for the append-only approval history. Approvals are only created through
 * `ai_workspace_approve_output_version` / `ai_workspace_approve_file_version`.
 */

const APPROVAL_SELECT = `
  select a.*,
         ov.version_number as output_version_number,
         fv.version_number as file_version_number,
         o.title as output_title, o.output_kind, o.approved_version_id as output_approved_version_id,
         f.file_name as file_name, f.approval_status as file_approval_status,
         ${clientColumns('c')},
         ${jobColumns('j')},
         ${taskColumns('t')},
         ${userColumns('au', 'approver_')}
    from public.ai_workspace_approvals a
    join public.ai_workspace_clients c on c.id = a.client_id
    join public.ai_workspace_jobs j on j.id = a.job_id
    join public.ai_workspace_tasks t on t.id = a.task_id
    left join public.ai_workspace_output_versions ov on ov.id = a.output_version_id
    left join public.ai_workspace_file_versions fv on fv.id = a.file_version_id
    left join public.ai_workspace_outputs o on o.id = a.output_id
    left join public.ai_workspace_files f on f.id = a.file_id
    left join public.ai_workspace_users au on au.id = a.approved_by`;

export async function approveOutputVersion(tx, outputId, versionId, notes) {
  const { rows } = await tx.query('select * from public.ai_workspace_approve_output_version($1, $2, $3)', [outputId, versionId, notes || '']);
  return rows[0];
}

export async function approveFileVersion(tx, fileId, versionId, notes) {
  const { rows } = await tx.query('select * from public.ai_workspace_approve_file_version($1, $2, $3)', [fileId, versionId, notes || '']);
  return rows[0];
}

export async function findApprovalById(tx, id) {
  const { rows } = await tx.query(`${APPROVAL_SELECT} where a.id = $1`, [id]);
  return rows[0] || null;
}

/** Approval history of one output, newest first. */
export async function listApprovalsForOutput(tx, outputId) {
  const { rows } = await tx.query(`${APPROVAL_SELECT} where a.output_id = $1 order by a.approved_at desc, a.created_at desc`, [outputId]);
  return rows;
}

/**
 * Lists approvals with filters.
 * @param {object} q — { clientId, jobId, taskId, outputId, fileId, approvedBy, interval }
 */
export async function listApprovals(tx, q, { limit, offset }) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (q.clientId) add('a.client_id = ?', q.clientId);
  if (q.jobId) add('a.job_id = ?', q.jobId);
  if (q.taskId) add('a.task_id = ?', q.taskId);
  if (q.outputId) add('a.output_id = ?', q.outputId);
  if (q.fileId) add('a.file_id = ?', q.fileId);
  if (q.approvedBy) add('a.approved_by = ?', q.approvedBy);
  if (q.interval) add('a.approved_at >= now() - ?::interval', q.interval);
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const { rows: countRows } = await tx.query(`select count(*)::int as n from public.ai_workspace_approvals a ${whereSql}`, params);
  const { rows } = await tx.query(
    `${APPROVAL_SELECT} ${whereSql} order by a.approved_at desc, a.created_at desc limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  return { rows, total: countRows[0].n };
}
