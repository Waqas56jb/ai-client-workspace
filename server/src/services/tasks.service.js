import { getDatabase } from '../config/db.js';
import { ACTIVITY } from '../constants/domain.js';
import { logActivity } from '../repositories/activity.repository.js';
import { listActivity } from '../repositories/activityQuery.repository.js';
import { clientRow, countClientBoundWork, CROSS_CLIENT_MOVE_MESSAGE, LIST_PAGING } from '../repositories/clients.repository.js';
import { listFiles } from '../repositories/dashboard.repository.js';
import { withPreviews } from './dashboard.service.js';
import { jobRow, touchJob } from '../repositories/jobs.repository.js';
import * as repo from '../repositories/tasks.repository.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { pageMeta, pagination } from '../utils/mappers.js';

const JOB_CLIENT_MISMATCH = 'The selected job does not belong to the selected client.';

async function requireTask(tx, taskId, opts) {
  const row = await repo.taskRow(tx, taskId, opts);
  if (!row) throw notFound('Task');
  return row;
}

async function loadTask(tx, taskId) {
  const task = await repo.findTask(tx, taskId);
  if (!task) throw notFound('Task');
  return task;
}

/** Resolves a job that can receive tasks (exists, not archived, client not archived). */
async function requireOpenJob(tx, jobId) {
  const job = await jobRow(tx, jobId);
  if (!job) throw badRequest('The selected job no longer exists.', [{ path: 'jobId', message: 'Job not found.' }]);
  if (job.status === 'archived') throw badRequest('The selected job is archived. Restore it before adding tasks.', [{ path: 'jobId', message: 'Job is archived.' }]);
  const client = await clientRow(tx, job.client_id);
  if (client?.status === 'archived') throw badRequest('The job’s client is archived. Restore the client first.', [{ path: 'clientId', message: 'Client is archived.' }]);
  return job;
}

async function requireAssignee(tx, assigneeId) {
  if (assigneeId && !(await repo.isActiveMember(tx, assigneeId))) {
    throw badRequest('The assignee must be an active team member.', [{ path: 'assigneeId', message: 'Choose an active team member.' }]);
  }
}

/** Paginated task list. @returns {{ items, meta }} */
export function listTasks(userId, query) {
  const page = pagination(query, LIST_PAGING);
  return getDatabase().withUser(userId, async (tx) => {
    const { items, total } = await repo.listTasks(tx, { ...query, limit: page.limit, offset: page.offset });
    return { items, meta: pageMeta(page, total) };
  });
}

/** One task (archived included) with counts. */
export function getTask(userId, taskId) {
  return getDatabase().withUser(userId, (tx) => loadTask(tx, taskId));
}

/**
 * Creates a task. The job must belong to the given client (also enforced by
 * the composite foreign key). The assignee defaults to the creator.
 */
export function createTask(userId, body) {
  return getDatabase().withUser(userId, async (tx) => {
    const job = await requireOpenJob(tx, body.jobId);
    if (job.client_id !== body.clientId) throw badRequest(JOB_CLIENT_MISMATCH, [{ path: 'jobId', message: JOB_CLIENT_MISMATCH }]);
    const assigneeId = body.assigneeId || userId;
    await requireAssignee(tx, assigneeId);
    const taskId = await repo.insertTask(tx, { ...body, assigneeId }, userId);
    await touchJob(tx, job.id, userId);
    await logActivity(tx, {
      userId,
      type: ACTIVITY.TASK_CREATED,
      resourceType: 'task',
      resourceId: taskId,
      clientId: job.client_id,
      jobId: job.id,
      taskId,
      description: `Created task “${body.title}”`,
    });
    return loadTask(tx, taskId);
  });
}

/** Works out a job/client move requested by a PATCH body, or null when none. */
async function resolveMove(tx, current, body) {
  if (body.jobId && body.jobId !== current.job_id) {
    const job = await requireOpenJob(tx, body.jobId);
    if (body.clientId && body.clientId !== job.client_id) throw badRequest(JOB_CLIENT_MISMATCH, [{ path: 'jobId', message: JOB_CLIENT_MISMATCH }]);
    if (job.client_id !== current.client_id && (await countClientBoundWork(tx, { taskId: current.id }))) {
      throw conflict(CROSS_CLIENT_MOVE_MESSAGE);
    }
    return { jobId: job.id, clientId: job.client_id };
  }
  if (body.clientId && body.clientId !== current.client_id) {
    throw badRequest('To change the client, move the task to one of that client’s jobs.', [{ path: 'clientId', message: JOB_CLIENT_MISMATCH }]);
  }
  return null;
}

/**
 * Updates a task. Moving to another job updates job_id and client_id in one
 * statement, which cascades to conversations, outputs, files, runs and approvals.
 */
export function updateTask(userId, taskId, body) {
  return getDatabase().withUser(userId, async (tx) => {
    const current = await requireTask(tx, taskId, { lock: true });
    const move = await resolveMove(tx, current, body);
    if (body.assigneeId) await requireAssignee(tx, body.assigneeId);
    const { jobId: _jobId, clientId: _clientId, ...values } = body;
    await repo.updateTask(tx, taskId, userId, values, { move });
    await logActivity(tx, {
      userId,
      type: ACTIVITY.TASK_UPDATED,
      resourceType: 'task',
      resourceId: taskId,
      clientId: move?.clientId || current.client_id,
      jobId: move?.jobId || current.job_id,
      taskId,
      description: move ? `Moved task “${body.title || current.title}” to another job` : `Updated task “${body.title || current.title}”`,
      metadata: move ? { fields: Object.keys(body), fromJobId: current.job_id } : { fields: Object.keys(body) },
    });
    return loadTask(tx, taskId);
  });
}

/** Archives a task (idempotent). Conversations, outputs and history are retained. */
export function archiveTask(userId, taskId) {
  return getDatabase().withUser(userId, async (tx) => {
    const current = await requireTask(tx, taskId, { lock: true });
    if (!current.archived_at) {
      await repo.updateTask(tx, taskId, userId, {}, { extra: ['archived_at = now()'] });
      await logActivity(tx, {
        userId,
        type: ACTIVITY.TASK_UPDATED,
        resourceType: 'task',
        resourceId: taskId,
        clientId: current.client_id,
        jobId: current.job_id,
        taskId,
        description: `Archived task “${current.title}”`,
      });
    }
    return loadTask(tx, taskId);
  });
}

/** DELETE /tasks/:id — tasks are archived, never hard-deleted. */
export async function removeTask(userId, taskId) {
  await archiveTask(userId, taskId);
  return { id: taskId, result: 'archived' };
}

/** Files attached to or generated in one task (paginated). */
export async function taskFiles(userId, taskId, query) {
  const page = pagination(query, LIST_PAGING);
  const listing = await getDatabase().withUser(userId, async (tx) => {
    await requireTask(tx, taskId);
    return listFiles(tx, { taskId, limit: page.limit, offset: page.offset });
  });
  return { items: await withPreviews(listing), meta: pageMeta(page, listing.total) };
}

/** Activity timeline of one task. */
export function taskActivity(userId, taskId, { limit } = {}) {
  return getDatabase().withUser(userId, async (tx) => {
    await requireTask(tx, taskId);
    return listActivity(tx, { taskId, limit });
  });
}
