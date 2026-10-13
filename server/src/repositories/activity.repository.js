/**
 * Central activity log. Every module records events through `logActivity` inside
 * the same transaction as the change it describes. Never put secrets, tokens or
 * confidential file content in `description` or `metadata`.
 */
export async function logActivity(tx, { userId, type, resourceType, resourceId = null, clientId = null, jobId = null, taskId = null, description, metadata = {} }) {
  const { rows } = await tx.query(
    `insert into public.ai_workspace_activity_logs
       (user_id, action_type, resource_type, resource_id, client_id, job_id, task_id, description, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id, created_at`,
    [userId, type, resourceType, resourceId ? String(resourceId) : null, clientId, jobId, taskId, String(description).slice(0, 500), metadata],
  );
  return rows[0];
}
