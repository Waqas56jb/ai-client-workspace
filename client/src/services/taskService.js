import { apiClient, call, notFound, ServiceError } from './apiClient';
import { getDb, mutate } from './mock/db';
import { countOutputs, logActivity, pickClient, pickJob, pickUser } from './mock/relations';
import { createId, inDateRange, matches, nowIso, sortBy } from '@/lib/utils';

function enrich(db, t) {
  const conversations = db.conversations.filter((c) => c.taskId === t.id);
  const convIds = new Set(conversations.map((c) => c.id));
  const counts = countOutputs(db, (o) => o.taskId === t.id);
  return {
    ...t,
    client: pickClient(db, t.clientId),
    job: pickJob(db, t.jobId),
    assignee: pickUser(db, t.assigneeId),
    createdByUser: pickUser(db, t.createdBy),
    conversationCount: conversations.length,
    messageCount: db.messages.filter((m) => convIds.has(m.conversationId)).length,
    fileCount: db.files.filter((f) => f.taskId === t.id).length,
    outputCount: counts.outputs,
    draftCount: counts.drafts,
    approvedCount: counts.approved,
    approvalStatus: counts.outputs === 0 ? 'none' : counts.drafts > 0 ? 'draft' : 'approved',
  };
}

const SORTS = {
  updated: (l) => sortBy(l, 'updatedAt', 'desc'),
  created: (l) => sortBy(l, 'createdAt', 'desc'),
  name: (l) => sortBy(l, (t) => t.title.toLowerCase(), 'asc'),
  client: (l) => sortBy(l, (t) => t.client?.name?.toLowerCase() || '', 'asc'),
};

export const taskService = {
  /** @param {{ search?, clientId?, jobId?, type?, status?, approval?, assigneeId?, dateRange?, sort? }} params */
  list: (params = {}) =>
    call({
      mock: () => {
        const db = getDb();
        let list = db.tasks.map((t) => enrich(db, t));
        const eq = (key, val) => {
          if (val && val !== 'all') list = list.filter((t) => t[key] === val);
        };
        eq('clientId', params.clientId);
        eq('jobId', params.jobId);
        eq('type', params.type);
        eq('status', params.status);
        eq('assigneeId', params.assigneeId);
        eq('approvalStatus', params.approval);
        if (params.dateRange) list = list.filter((t) => inDateRange(t.updatedAt, params.dateRange));
        if (params.search) list = list.filter((t) => matches(`${t.title} ${t.description} ${t.client?.name} ${t.job?.title}`, params.search));
        return (SORTS[params.sort] || SORTS.updated)(list);
      },
      api: () => apiClient.getAll('/tasks', { params }),
    }),

  get: (id) =>
    call({
      mock: () => {
        const db = getDb();
        const t = db.tasks.find((x) => x.id === id);
        if (!t) throw notFound('Task');
        return enrich(db, t);
      },
      api: () => apiClient.get(`/tasks/${id}`),
    }),

  create: (values) =>
    call({
      mock: () =>
        mutate((db) => {
          const job = db.jobs.find((j) => j.id === values.jobId);
          if (!job) throw new ServiceError('The selected job no longer exists.');
          if (job.clientId !== values.clientId) throw new ServiceError('The selected job does not belong to the selected client.');
          const now = nowIso();
          const task = {
            id: createId('t'),
            status: 'todo',
            description: '',
            notes: '',
            ...values,
            clientId: job.clientId,
            assigneeId: values.assigneeId || null,
            createdAt: now,
            updatedAt: now,
            createdBy: null,
          };
          const act = logActivity(db, { type: 'task_created', resourceType: 'task', resourceId: task.id, clientId: task.clientId, jobId: task.jobId, taskId: task.id, description: `Created task “${task.title}”` });
          task.createdBy = act.userId;
          if (!task.assigneeId) task.assigneeId = act.userId;
          db.tasks.unshift(task);
          job.updatedAt = now;
          return enrich(db, task);
        }),
      api: () => apiClient.post('/tasks', values),
    }),

  update: (id, values) =>
    call({
      mock: () =>
        mutate((db) => {
          const t = db.tasks.find((x) => x.id === id);
          if (!t) throw notFound('Task');
          if (values.jobId && values.jobId !== t.jobId) {
            const job = db.jobs.find((j) => j.id === values.jobId);
            if (!job) throw new ServiceError('The selected job no longer exists.');
            values = { ...values, clientId: job.clientId };
            db.outputs.filter((o) => o.taskId === id).forEach((o) => Object.assign(o, { jobId: job.id, clientId: job.clientId }));
            db.files.filter((f) => f.taskId === id).forEach((f) => Object.assign(f, { jobId: job.id, clientId: job.clientId }));
          }
          Object.assign(t, values, { updatedAt: nowIso() });
          logActivity(db, { type: 'task_updated', resourceType: 'task', resourceId: id, clientId: t.clientId, jobId: t.jobId, taskId: id, description: `Updated task “${t.title}”` });
          return enrich(db, t);
        }),
      api: () => apiClient.patch(`/tasks/${id}`, values),
    }),

  /** Deletes a task with its conversations, outputs, versions and output files. */
  remove: (id) =>
    call({
      mock: () =>
        mutate((db) => {
          const t = db.tasks.find((x) => x.id === id);
          if (!t) throw notFound('Task');
          const convIds = new Set(db.conversations.filter((c) => c.taskId === id).map((c) => c.id));
          const outIds = new Set(db.outputs.filter((o) => o.taskId === id).map((o) => o.id));
          db.tasks = db.tasks.filter((x) => x.id !== id);
          db.conversations = db.conversations.filter((c) => !convIds.has(c.id));
          db.messages = db.messages.filter((m) => !convIds.has(m.conversationId));
          db.outputs = db.outputs.filter((o) => !outIds.has(o.id));
          db.versions = db.versions.filter((v) => !outIds.has(v.outputId));
          db.files = db.files.filter((f) => !(f.taskId === id && f.category === 'output'));
          db.files.filter((f) => f.taskId === id).forEach((f) => (f.taskId = null));
          logActivity(db, { type: 'task_deleted', resourceType: 'task', resourceId: id, clientId: t.clientId, jobId: t.jobId, description: `Deleted task “${t.title}”` });
          return { id, result: 'deleted' };
        }),
      // The API archives tasks (conversations, outputs and approvals are retained).
      api: async () => {
        await apiClient.post(`/tasks/${id}/archive`);
        return { data: { id, result: 'archived' } };
      },
    }),
};
