import { clientColumns, clientSummary, iso, jobColumns, jobSummary, taskColumns, taskSummary, userColumns, userSummary } from '../utils/mappers.js';

/** Maps an activity row (with joined summaries) to the Activity DTO. */
function mapActivity(row) {
  const fileId = row.file_id || row.output_file_id;
  let resourceExists = true;
  if (row.resource_type === 'output') resourceExists = Boolean(row.output_id);
  else if (row.resource_type === 'file') resourceExists = Boolean(row.file_id);
  return {
    id: row.id,
    type: row.action_type,
    userId: row.user_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    clientId: row.a_client_id,
    jobId: row.a_job_id,
    taskId: row.a_task_id,
    description: row.description,
    createdAt: iso(row.created_at),
    user: userSummary(row, 'us_'),
    client: clientSummary(row),
    job: jobSummary(row),
    task: taskSummary(row),
    file: fileId
      ? { id: fileId, name: row.file_id ? row.file_name : row.output_file_name, kind: row.file_id ? row.file_category : row.output_file_category }
      : null,
    resourceExists,
  };
}

/**
 * Reads the activity timeline, newest first.
 * @param {{ clientId?, jobId?, taskId?, userId?, type?, limit? }} filters
 */
export async function listActivity(tx, { clientId, jobId, taskId, userId, type, limit = 50 } = {}) {
  const params = [];
  const where = [];
  const eq = (column, value) => {
    if (!value || value === 'all') return;
    params.push(value);
    where.push(`${column} = $${params.length}`);
  };
  eq('a.client_id', clientId);
  eq('a.job_id', jobId);
  eq('a.task_id', taskId);
  eq('a.user_id', userId);
  eq('a.action_type', type);
  params.push(limit);
  const { rows } = await tx.query(
    `select a.id, a.action_type, a.user_id, a.resource_type, a.resource_id, a.description, a.created_at,
            a.client_id as a_client_id, a.job_id as a_job_id, a.task_id as a_task_id,
            ${userColumns('u', 'us_')}, ${clientColumns('c')}, ${jobColumns('j')}, ${taskColumns('t')},
            fr.id as file_id, fr.file_name, fr.file_category,
            o.id as output_id, fo.id as output_file_id, fo.file_name as output_file_name, fo.file_category as output_file_category
       from public.ai_workspace_activity_logs a
       left join public.ai_workspace_users u on u.id = a.user_id
       left join public.ai_workspace_clients c on c.id = a.client_id
       left join public.ai_workspace_jobs j on j.id = a.job_id
       left join public.ai_workspace_tasks t on t.id = a.task_id
       left join public.ai_workspace_files fr on a.resource_type = 'file' and fr.id::text = a.resource_id
       left join public.ai_workspace_outputs o on a.resource_type = 'output' and o.id::text = a.resource_id
       left join public.ai_workspace_files fo on fo.id = o.file_id
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by a.created_at desc, a.id
      limit $${params.length}`,
    params,
  );
  return rows.map(mapActivity);
}
