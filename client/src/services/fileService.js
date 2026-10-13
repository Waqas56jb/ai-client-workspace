import { apiClient, call, notFound, ServiceError } from './apiClient';
import { getDb, mutate } from './mock/db';
import { blobStore } from './mock/blobStore';
import { logActivity, pickClient, pickJob, pickTask, pickUser } from './mock/relations';
import { enrichOutput, versionText } from './versionService';
import { ACCEPTED_UPLOADS } from '@/lib/constants';
import { config, isMockMode } from '@/lib/config';
import { createId, formatBytes, inDateRange, matches, nowIso, sortBy } from '@/lib/utils';

/**
 * File records.
 *  category: 'reference' (client reference material) | 'attachment' (task upload) | 'output' (generated)
 *  storage:  'bundled'     — small sample asset shipped with the app (/public/samples)
 *            'generated'   — demo output rendered from its version data
 *            'browser'     — uploaded in this browser, blob held in IndexedDB (temporary)
 *            'record-only' — metadata only; no file content available in demo mode
 */
function enrich(db, f, { withOutput = false } = {}) {
  const output = f.outputId ? db.outputs.find((o) => o.id === f.outputId) : null;
  const enrichedOutput = output ? enrichOutput(db, output, { withVersions: withOutput }) : null;
  const conversation = output?.conversationId ? db.conversations.find((c) => c.id === output.conversationId) : null;
  return {
    ...f,
    client: pickClient(db, f.clientId),
    job: pickJob(db, f.jobId),
    task: pickTask(db, f.taskId),
    createdByUser: pickUser(db, f.createdBy),
    status: output ? enrichedOutput.status : null,
    pendingRevision: output ? enrichedOutput.pendingRevision : false,
    lastRevisionAt: output ? output.updatedAt : f.updatedAt,
    versionCount: enrichedOutput?.versionCount || 1,
    output: enrichedOutput,
    conversation: conversation ? { id: conversation.id, title: conversation.title, taskId: conversation.taskId } : null,
  };
}

export function validateUpload(file) {
  if (!file) return 'No file selected.';
  if (!ACCEPTED_UPLOADS[file.type]) return `“${file.name}” is not a supported file type. Use images (PNG, JPG, WebP, GIF, SVG), PDF, Word, Excel, CSV or text files.`;
  if (file.size > config.maxUploadBytes) return `“${file.name}” is ${formatBytes(file.size)}. ${isMockMode ? 'The demo upload limit' : 'The upload limit'} is ${formatBytes(config.maxUploadBytes)}.`;
  return null;
}

export const fileService = {
  /** @param {{ search?, kind?, status?, clientId?, jobId?, taskId?, category?, dateRange?, sort? }} params */
  list: (params = {}) =>
    call({
      mock: () => {
        const db = getDb();
        let list = db.files.map((f) => enrich(db, f));
        ['kind', 'clientId', 'jobId', 'taskId', 'category', 'createdBy'].forEach((k) => {
          if (params[k] && params[k] !== 'all') list = list.filter((f) => f[k] === params[k]);
        });
        if (params.status && params.status !== 'all') {
          list = list.filter((f) => (params.status === 'reference' ? !f.outputId : f.status === params.status));
        }
        if (params.dateRange) list = list.filter((f) => inDateRange(f.createdAt, params.dateRange));
        if (params.search) {
          list = list.filter((f) => matches(`${f.name} ${f.description} ${f.client?.name} ${f.job?.title} ${f.task?.title}`, params.search));
        }
        const sorts = {
          updated: (l) => sortBy(l, 'lastRevisionAt', 'desc'),
          created: (l) => sortBy(l, 'createdAt', 'desc'),
          name: (l) => sortBy(l, (f) => f.name.toLowerCase(), 'asc'),
          size: (l) => sortBy(l, 'size', 'desc'),
        };
        return (sorts[params.sort] || sorts.updated)(list);
      },
      api: () => apiClient.getAll('/files', { params }),
    }),

  get: (id) =>
    call({
      mock: () => {
        const db = getDb();
        const f = db.files.find((x) => x.id === id);
        if (!f) throw notFound('File');
        return enrich(db, f, { withOutput: true });
      },
      api: () => apiClient.get(`/files/${id}`),
    }),

  /**
   * Uploads a browser-selected file. In demo mode the binary goes to IndexedDB and
   * only metadata is stored in the workspace. It is temporary browser storage.
   * @param {{ file: File, clientId, jobId?, taskId?, category?, description? }} params
   */
  async upload({ file, clientId, jobId = null, taskId = null, category = 'reference', description = '' }) {
    const problem = validateUpload(file);
    if (problem) throw new ServiceError(problem, { code: 'invalid_file' });
    if (!isMockMode) {
      const form = new FormData();
      // Text fields first, file last (multer reads fields in order).
      Object.entries({ clientId, jobId, taskId, category, description }).forEach(([k, v]) => v && form.append(k, v));
      form.append('file', file, file.name);
      return (await apiClient.post('/files/upload', form)).data;
    }
    const id = createId('f');
    try {
      await blobStore.put(id, file);
    } catch {
      throw new ServiceError('This browser blocked local file storage. The file could not be kept for the demo.');
    }
    return call({
      mock: () =>
        mutate((db) => {
          const now = nowIso();
          const record = {
            id,
            name: file.name,
            kind: ACCEPTED_UPLOADS[file.type] || 'other',
            mimeType: file.type,
            size: file.size,
            clientId,
            jobId,
            taskId,
            outputId: null,
            category,
            storage: 'browser',
            url: null,
            description,
            createdAt: now,
            updatedAt: now,
            createdBy: null,
          };
          const act = logActivity(db, { type: 'file_uploaded', resourceType: 'file', resourceId: id, clientId, jobId, taskId, description: `Uploaded “${file.name}”` });
          record.createdBy = act.userId;
          db.files.unshift(record);
          return enrich(db, record);
        }),
    });
  },

  update: (id, patch) =>
    call({
      mock: () =>
        mutate((db) => {
          const f = db.files.find((x) => x.id === id);
          if (!f) throw notFound('File');
          const renamed = patch.name && patch.name !== f.name;
          Object.assign(f, patch, { updatedAt: nowIso() });
          if (renamed) {
            logActivity(db, { type: 'file_renamed', resourceType: 'file', resourceId: id, clientId: f.clientId, jobId: f.jobId, taskId: f.taskId, description: `Renamed a file to “${f.name}”` });
            const o = f.outputId && db.outputs.find((x) => x.id === f.outputId);
            if (o) o.title = f.name.replace(/\.(png|txt)$/i, '');
          }
          return enrich(db, f);
        }),
      api: () => apiClient.patch(`/files/${id}`, patch),
    }),

  /** Removes uploaded/reference files. Generated outputs are managed through their task. */
  async remove(id) {
    const res = await call({
      mock: () =>
        mutate((db) => {
          const f = db.files.find((x) => x.id === id);
          if (!f) throw notFound('File');
          if (f.category === 'output') throw new ServiceError('Generated outputs keep their revision history and cannot be removed from the library.');
          db.files = db.files.filter((x) => x.id !== id);
          db.clients.forEach((c) => {
            if (c.brand?.logoFileId === id) c.brand.logoFileId = null;
          });
          db.messages.forEach((m) => {
            if (m.attachmentIds?.includes(id)) m.attachmentIds = m.attachmentIds.filter((a) => a !== id);
          });
          logActivity(db, { type: 'file_deleted', resourceType: 'file', resourceId: id, clientId: f.clientId, jobId: f.jobId, taskId: f.taskId, description: `Removed “${f.name}”` });
          return { id, storage: f.storage };
        }),
      // Stored objects are never hard-deleted through the API: the record is archived.
      api: async () => {
        const res = await apiClient.post(`/files/${id}/archive`);
        return { data: { id, storage: res.data?.storage || 'supabase', ...(res.data && typeof res.data === 'object' ? res.data : {}) } };
      },
    });
    if (isMockMode) await blobStore.remove(id);
    return res;
  },

  /** Returns the stored Blob for a browser-held upload, or null if it is gone (demo mode only). */
  async getLocalBlob(id) {
    if (!isMockMode) return null;
    const blob = await blobStore.get(id);
    return blob || null;
  },

  textContent: (file) => (file.output ? versionText(file.output.currentVersion) : ''),
};
