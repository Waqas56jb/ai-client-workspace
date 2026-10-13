import { apiClient, call } from './apiClient';
import { getDb } from './mock/db';
import { pickClient, pickJob, pickTask, pickUser } from './mock/relations';

/**
 * Central activity / audit timeline. Every service logs through
 * mock/relations.logActivity, so dashboard, client, job and task views all read
 * the same records.
 */
export const activityService = {
  /** @param {{ clientId?, jobId?, taskId?, userId?, type?, limit? }} params */
  list: (params = {}) =>
    call({
      latency: 150,
      mock: () => {
        const db = getDb();
        let list = db.activity;
        ['clientId', 'jobId', 'taskId', 'userId', 'type'].forEach((k) => {
          if (params[k] && params[k] !== 'all') list = list.filter((a) => a[k] === params[k]);
        });
        list = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, params.limit || 50);
        return list.map((a) => {
          const output = a.resourceType === 'output' ? db.outputs.find((o) => o.id === a.resourceId) : null;
          const file = a.resourceType === 'file' ? db.files.find((f) => f.id === a.resourceId) : output ? db.files.find((f) => f.id === output.fileId) : null;
          return {
            ...a,
            user: pickUser(db, a.userId),
            client: a.clientId ? pickClient(db, a.clientId) : null,
            job: a.jobId ? pickJob(db, a.jobId) : null,
            task: a.taskId ? pickTask(db, a.taskId) : null,
            file: file ? { id: file.id, name: file.name, kind: file.kind } : null,
            resourceExists: a.resourceType === 'output' ? !!output : a.resourceType === 'file' ? !!file : true,
          };
        });
      },
      api: () => apiClient.get('/activity', { params }),
    }),
};
