import { getDatabase } from '../config/db.js';
import { ACTIVITY } from '../constants/domain.js';
import { logActivity } from '../repositories/activity.repository.js';
import { listActivity } from '../repositories/activityQuery.repository.js';
import { clientRow, countClientBoundWork, CROSS_CLIENT_MOVE_MESSAGE, LIST_PAGING } from '../repositories/clients.repository.js';
import { listFiles } from '../repositories/dashboard.repository.js';
import { withPreviews } from './dashboard.service.js';
import * as repo from '../repositories/jobs.repository.js';
import { listTasks } from '../repositories/tasks.repository.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { pageMeta, pagination } from '../utils/mappers.js';

async function requireJob(tx, jobId, opts) {
  const row = await repo.jobRow(tx, jobId, opts);
  if (!row) throw notFound('Job');
  return row;
}

async function loadJob(tx, jobId) {
  const job = await repo.findJob(tx, jobId);
  if (!job) throw notFound('Job');
  return job;
}

/** Ensures the target client exists and accepts new work. */
async function requireOpenClient(tx, clientId) {
  const client = await clientRow(tx, clientId);
  if (!client) throw badRequest('The selected client no longer exists.', [{ path: 'clientId', message: 'Client not found.' }]);
  if (client.status === 'archived') {
    throw badRequest('The selected client is archived. Restore it before adding work to it.', [{ path: 'clientId', message: 'Client is archived.' }]);
  }
  return client;
}

/** Paginated job list. @returns {{ items, meta }} */
export function listJobs(userId, query) {
  const page = pagination(query, LIST_PAGING);
  return getDatabase().withUser(userId, async (tx) => {
    const { items, total } = await repo.listJobs(tx, { ...query, limit: page.limit, offset: page.offset });
    return { items, meta: pageMeta(page, total) };
  });
}

/** One job (archived included) with counts. */
export function getJob(userId, jobId) {
  return getDatabase().withUser(userId, (tx) => loadJob(tx, jobId));
}

/** Creates a job under an existing, non-archived client. */
export function createJob(userId, body) {
  return getDatabase().withUser(userId, async (tx) => {
    await requireOpenClient(tx, body.clientId);
    const jobId = await repo.insertJob(tx, body, userId);
    await logActivity(tx, {
      userId,
      type: ACTIVITY.JOB_CREATED,
      resourceType: 'job',
      resourceId: jobId,
      clientId: body.clientId,
      jobId,
      description: `Created job “${body.title}”`,
    });
    return loadJob(tx, jobId);
  });
}

/**
 * Updates a job. Moving it to another client cascades (composite FKs, ON UPDATE
 * CASCADE) to its tasks, conversations, outputs, files and generation runs in
 * the same statement. Activity history is append-only and keeps its original scope.
 */
export function updateJob(userId, jobId, body) {
  return getDatabase().withUser(userId, async (tx) => {
    const current = await requireJob(tx, jobId, { lock: true });
    const moving = body.clientId && body.clientId !== current.client_id;
    if (moving) {
      await requireOpenClient(tx, body.clientId);
      if (await countClientBoundWork(tx, { jobId })) throw conflict(CROSS_CLIENT_MOVE_MESSAGE);
    }
    await repo.updateJob(tx, jobId, userId, body, body.status ? ['archived_at = null'] : []);
    const title = body.title || current.title;
    await logActivity(tx, {
      userId,
      type: ACTIVITY.JOB_UPDATED,
      resourceType: 'job',
      resourceId: jobId,
      clientId: body.clientId || current.client_id,
      jobId,
      description: moving ? `Moved job “${title}” to a different client` : `Updated job “${title}”`,
      metadata: moving ? { fields: Object.keys(body), fromClientId: current.client_id } : { fields: Object.keys(body) },
    });
    return loadJob(tx, jobId);
  });
}

/** Archives a job (idempotent). Its tasks and history are retained. */
export function archiveJob(userId, jobId) {
  return getDatabase().withUser(userId, async (tx) => {
    const current = await requireJob(tx, jobId, { lock: true });
    if (current.status !== 'archived') {
      await repo.updateJob(tx, jobId, userId, { status: 'archived' }, ['archived_at = now()']);
      await logActivity(tx, {
        userId,
        type: ACTIVITY.JOB_UPDATED,
        resourceType: 'job',
        resourceId: jobId,
        clientId: current.client_id,
        jobId,
        description: `Archived job “${current.title}” (tasks retained)`,
      });
    }
    return loadJob(tx, jobId);
  });
}

/** DELETE /jobs/:id — jobs are archived, never hard-deleted. */
export async function removeJob(userId, jobId) {
  await archiveJob(userId, jobId);
  return { id: jobId, result: 'archived' };
}

/** Tasks of one job (paginated, archived excluded). */
export function jobTasks(userId, jobId, query) {
  const page = pagination(query, LIST_PAGING);
  return getDatabase().withUser(userId, async (tx) => {
    await requireJob(tx, jobId);
    const { items, total } = await listTasks(tx, { jobId, limit: page.limit, offset: page.offset });
    return { items, meta: pageMeta(page, total) };
  });
}

/** Files of one job (paginated). */
export async function jobFiles(userId, jobId, query) {
  const page = pagination(query, LIST_PAGING);
  const listing = await getDatabase().withUser(userId, async (tx) => {
    await requireJob(tx, jobId);
    return listFiles(tx, { jobId, limit: page.limit, offset: page.offset });
  });
  return { items: await withPreviews(listing), meta: pageMeta(page, listing.total) };
}

/** Activity timeline of one job. */
export function jobActivity(userId, jobId, { limit } = {}) {
  return getDatabase().withUser(userId, async (tx) => {
    await requireJob(tx, jobId);
    return listActivity(tx, { jobId, limit });
  });
}
