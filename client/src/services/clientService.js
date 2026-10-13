import { apiClient, call, notFound, ServiceError } from './apiClient';
import { getDb, mutate } from './mock/db';
import { countOutputs, logActivity, pickUser } from './mock/relations';
import { EMPTY_BRAND } from '@/lib/brandDefaults';
import { createId, matches, nowIso, sortBy } from '@/lib/utils';

function enrich(db, c) {
  const jobs = db.jobs.filter((j) => j.clientId === c.id);
  const tasks = db.tasks.filter((t) => t.clientId === c.id);
  const files = db.files.filter((f) => f.clientId === c.id);
  const counts = countOutputs(db, (o) => o.clientId === c.id);
  const lastActivity = db.activity.find((a) => a.clientId === c.id);
  return {
    ...c,
    jobCount: jobs.length,
    activeJobCount: jobs.filter((j) => j.status === 'active').length,
    taskCount: tasks.length,
    fileCount: files.length,
    draftCount: counts.drafts,
    approvedCount: counts.approved,
    lastActivityAt: lastActivity?.createdAt && lastActivity.createdAt > c.updatedAt ? lastActivity.createdAt : c.updatedAt,
    createdByUser: pickUser(db, c.createdBy),
  };
}

const SORTS = {
  recent: (list) => sortBy(list, 'lastActivityAt', 'desc'),
  name: (list) => sortBy(list, (c) => c.name.toLowerCase(), 'asc'),
  created: (list) => sortBy(list, 'createdAt', 'desc'),
  jobs: (list) => sortBy(list, 'jobCount', 'desc'),
};

export const clientService = {
  /** @param {{ search?: string, status?: string, sort?: 'recent'|'name'|'created'|'jobs', includeArchived?: boolean }} params */
  list: (params = {}) =>
    call({
      mock: () => {
        const db = getDb();
        let list = db.clients.map((c) => enrich(db, c));
        if (params.status && params.status !== 'all') list = list.filter((c) => c.status === params.status);
        else if (!params.includeArchived) list = list.filter((c) => c.status !== 'archived');
        if (params.search) list = list.filter((c) => matches(`${c.name} ${c.industry} ${c.slug}`, params.search));
        return (SORTS[params.sort] || SORTS.recent)(list);
      },
      api: () => apiClient.getAll('/clients', { params }),
    }),

  get: (id) =>
    call({
      mock: () => {
        const db = getDb();
        const c = db.clients.find((x) => x.id === id);
        if (!c) throw notFound('Client');
        return enrich(db, c);
      },
      api: () => apiClient.get(`/clients/${id}`),
    }),

  create: (values) =>
    call({
      mock: () =>
        mutate((db) => {
          if (db.clients.some((c) => c.slug === values.slug)) throw new ServiceError('Another client already uses this identifier.', { code: 'duplicate_slug' });
          const now = nowIso();
          const client = {
            id: createId('c'),
            status: 'active',
            ...values,
            createdAt: now,
            updatedAt: now,
            createdBy: null,
            brand: {
              ...EMPTY_BRAND,
              businessName: values.name,
              address: values.address || '',
              phone: values.phone || '',
              email: values.email || '',
              website: values.website || '',
            },
          };
          const act = logActivity(db, { type: 'client_created', resourceType: 'client', resourceId: client.id, clientId: client.id, description: `Created client “${client.name}”` });
          client.createdBy = act.userId;
          db.clients.unshift(client);
          return enrich(db, client);
        }),
      api: () => apiClient.post('/clients', values),
    }),

  update: (id, values) =>
    call({
      mock: () =>
        mutate((db) => {
          const c = db.clients.find((x) => x.id === id);
          if (!c) throw notFound('Client');
          if (values.slug && db.clients.some((x) => x.id !== id && x.slug === values.slug)) {
            throw new ServiceError('Another client already uses this identifier.', { code: 'duplicate_slug' });
          }
          Object.assign(c, values, { updatedAt: nowIso() });
          logActivity(db, { type: 'client_updated', resourceType: 'client', resourceId: id, clientId: id, description: `Updated client details for “${c.name}”` });
          return enrich(db, c);
        }),
      api: () => apiClient.patch(`/clients/${id}`, values),
    }),

  /** Saves the full brand profile. Only touches the selected client. */
  updateBrand: (id, brand) =>
    call({
      mock: () =>
        mutate((db) => {
          const c = db.clients.find((x) => x.id === id);
          if (!c) throw notFound('Client');
          c.brand = { ...EMPTY_BRAND, ...c.brand, ...brand };
          c.updatedAt = nowIso();
          logActivity(db, { type: 'brand_updated', resourceType: 'client', resourceId: id, clientId: id, description: `Updated the brand profile for “${c.name}”` });
          return enrich(db, c);
        }),
      api: () => apiClient.patch(`/clients/${id}/brand`, brand),
    }),

  /** Describes what deleting a client would affect, so the UI can explain consequences. */
  deletionImpact: (id) =>
    call({
      latency: 80,
      mock: () => {
        const db = getDb();
        const c = db.clients.find((x) => x.id === id);
        if (!c) throw notFound('Client');
        const jobs = db.jobs.filter((j) => j.clientId === id).length;
        const tasks = db.tasks.filter((t) => t.clientId === id).length;
        const files = db.files.filter((f) => f.clientId === id).length;
        const outputs = db.outputs.filter((o) => o.clientId === id).length;
        return { jobs, tasks, files, outputs, hasWork: jobs + tasks + files + outputs > 0, strategy: jobs + tasks + files + outputs > 0 ? 'archive' : 'delete' };
      },
      api: () => apiClient.get(`/clients/${id}/deletion-impact`),
    }),

  /**
   * Removes a client. Clients with existing work are archived instead of deleted,
   * so no jobs, tasks, outputs or files are silently lost.
   */
  remove: (id) =>
    call({
      mock: () =>
        mutate((db) => {
          const c = db.clients.find((x) => x.id === id);
          if (!c) throw notFound('Client');
          const hasWork = ['jobs', 'tasks', 'files', 'outputs'].some((k) => db[k].some((x) => x.clientId === id));
          if (hasWork) {
            c.status = 'archived';
            c.updatedAt = nowIso();
            logActivity(db, { type: 'client_archived', resourceType: 'client', resourceId: id, clientId: id, description: `Archived client “${c.name}” (existing work retained)` });
            return { id, result: 'archived' };
          }
          db.clients = db.clients.filter((x) => x.id !== id);
          db.presets.forEach((p) => {
            if (p.clientId === id) {
              p.clientId = '';
              p.scope = 'global';
            }
          });
          logActivity(db, { type: 'client_archived', resourceType: 'client', resourceId: id, description: `Deleted client “${c.name}”` });
          return { id, result: 'deleted' };
        }),
      api: async () => {
        // Same rule as the mock: clients with existing work are archived, never deleted.
        const { data: impact } = await apiClient.get(`/clients/${id}/deletion-impact`);
        if (impact?.strategy === 'archive' || impact?.hasWork) {
          await apiClient.post(`/clients/${id}/archive`);
          return { data: { id, result: 'archived' } };
        }
        await apiClient.delete(`/clients/${id}`);
        return { data: { id, result: 'deleted' } };
      },
    }),

  restore: (id) =>
    call({
      mock: () =>
        mutate((db) => {
          const c = db.clients.find((x) => x.id === id);
          if (!c) throw notFound('Client');
          c.status = 'active';
          c.updatedAt = nowIso();
          logActivity(db, { type: 'client_updated', resourceType: 'client', resourceId: id, clientId: id, description: `Restored client “${c.name}”` });
          return enrich(db, c);
        }),
      api: () => apiClient.post(`/clients/${id}/restore`),
    }),
};
