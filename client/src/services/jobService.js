import { apiClient, call, notFound, ServiceError } from './apiClient';
import { getDb, mutate } from './mock/db';
import { countOutputs, logActivity, pickClient, pickUser } from './mock/relations';
import { createId, matches, nowIso, sortBy } from '@/lib/utils';

function enrich(db, j) {
  const tasks = db.tasks.filter((t) => t.jobId === j.id);
  const counts = countOutputs(db, (o) => o.jobId === j.id);
  return {
    ...j,
    client: pickClient(db, j.clientId),
    taskCount: tasks.length,
    doneTaskCount: tasks.filter((t) => t.status === 'done').length,
    fileCount: db.files.filter((f) => f.jobId === j.id).length,
    draftCount: counts.drafts,
    approvedCount: counts.approved,
    outputCount: counts.outputs,
    createdByUser: pickUser(db, j.createdBy),
  };
}

const SORTS = {
  updated: (l) => sortBy(l, 'updatedAt', 'desc'),
  created: (l) => sortBy(l, 'createdAt', 'desc'),
  name: (l) => sortBy(l, (j) => j.title.toLowerCase(), 'asc'),
  deadline: (l) => sortBy(l, (j) => j.deadline || '9999', 'asc'),
};

export const jobService = {
  /** @param {{ search?, clientId?, status?, sort? }} params */
  list: (params = {}) =>
    call({
      mock: () => {
        const db = getDb();
        let list = db.jobs.map((j) => enrich(db, j));
        if (params.clientId && params.clientId !== 'all') list = list.filter((j) => j.clientId === params.clientId);
        if (params.status && params.status !== 'all') list = list.filter((j) => j.status === params.status);
        if (params.search) list = list.filter((j) => matches(`${j.title} ${j.description} ${j.client?.name}`, params.search));
        return (SORTS[params.sort] || SORTS.updated)(list);
      },
      // "All" includes archived jobs (as in demo mode); the HTTP client drops 'all' values, so say so explicitly.
      api: () => apiClient.getAll('/jobs', { params: params.status === 'all' ? { ...params, includeArchived: true } : params }),
    }),

  get: (id) =>
    call({
      mock: () => {
        const db = getDb();
        const j = db.jobs.find((x) => x.id === id);
        if (!j) throw notFound('Job');
        return enrich(db, j);
      },
      api: () => apiClient.get(`/jobs/${id}`),
    }),

  create: (values) =>
    call({
      mock: () =>
        mutate((db) => {
          if (!db.clients.some((c) => c.id === values.clientId)) throw new ServiceError('The selected client no longer exists.');
          const now = nowIso();
          const job = { id: createId('j'), status: 'active', deadline: '', notes: '', ...values, createdAt: now, updatedAt: now, createdBy: null };
          const act = logActivity(db, { type: 'job_created', resourceType: 'job', resourceId: job.id, clientId: job.clientId, jobId: job.id, description: `Created job “${job.title}”` });
          job.createdBy = act.userId;
          db.jobs.unshift(job);
          return enrich(db, job);
        }),
      api: () => apiClient.post('/jobs', values),
    }),

  /**
   * Updates a job. If the client changes, every task, conversation output and file
   * under the job moves with it so task context stays consistent.
   */
  update: (id, values) =>
    call({
      mock: () =>
        mutate((db) => {
          const j = db.jobs.find((x) => x.id === id);
          if (!j) throw notFound('Job');
          const clientChanged = values.clientId && values.clientId !== j.clientId;
          Object.assign(j, values, { updatedAt: nowIso() });
          if (clientChanged) {
            db.tasks.filter((t) => t.jobId === id).forEach((t) => (t.clientId = j.clientId));
            db.outputs.filter((o) => o.jobId === id).forEach((o) => (o.clientId = j.clientId));
            db.files.filter((f) => f.jobId === id).forEach((f) => (f.clientId = j.clientId));
            db.activity.filter((a) => a.jobId === id).forEach((a) => (a.clientId = j.clientId));
          }
          logActivity(db, {
            type: 'job_updated',
            resourceType: 'job',
            resourceId: id,
            clientId: j.clientId,
            jobId: id,
            description: clientChanged ? `Moved job “${j.title}” to a different client` : `Updated job “${j.title}”`,
          });
          return enrich(db, j);
        }),
      api: () => apiClient.patch(`/jobs/${id}`, values),
    }),

  /** Jobs that contain tasks are archived rather than deleted. */
  remove: (id) =>
    call({
      mock: () =>
        mutate((db) => {
          const j = db.jobs.find((x) => x.id === id);
          if (!j) throw notFound('Job');
          if (db.tasks.some((t) => t.jobId === id)) {
            j.status = 'archived';
            j.updatedAt = nowIso();
            logActivity(db, { type: 'job_updated', resourceType: 'job', resourceId: id, clientId: j.clientId, jobId: id, description: `Archived job “${j.title}” (tasks retained)` });
            return { id, result: 'archived' };
          }
          db.jobs = db.jobs.filter((x) => x.id !== id);
          db.files.filter((f) => f.jobId === id).forEach((f) => (f.jobId = null));
          logActivity(db, { type: 'job_deleted', resourceType: 'job', resourceId: id, clientId: j.clientId, description: `Deleted job “${j.title}”` });
          return { id, result: 'deleted' };
        }),
      // The API never hard-deletes jobs: they are archived and their tasks retained.
      api: async () => {
        await apiClient.post(`/jobs/${id}/archive`);
        return { data: { id, result: 'archived' } };
      },
    }),
};
