import { apiClient, call } from './apiClient';
import { dbSizeBytes, getDb, mutate, resetDb } from './mock/db';
import { blobStore } from './mock/blobStore';
import { config, isMockMode } from '@/lib/config';

export const settingsService = {
  getPreferences: () =>
    call({
      latency: 120,
      mock: () => getDb().preferences,
      api: () => apiClient.get('/settings/workspace'),
    }),

  updatePreferences: (values) =>
    call({
      mock: () =>
        mutate((db) => {
          db.preferences = { ...db.preferences, ...values };
          return db.preferences;
        }),
      api: () => apiClient.patch('/settings/workspace', values),
    }),

  /** Demo storage usage in THIS browser only — not cloud storage. */
  async getStorageInfo() {
    const blobBytes = isMockMode ? await blobStore.totalSize() : 0;
    return call({
      latency: 120,
      mock: () => {
        const db = getDb();
        const byStorage = db.files.reduce((acc, f) => ({ ...acc, [f.storage]: (acc[f.storage] || 0) + 1 }), {});
        return {
          mode: config.dataMode,
          workspaceBytes: dbSizeBytes(),
          browserFileBytes: blobBytes,
          quotaBytes: config.demoStorageQuotaBytes,
          fileCount: db.files.length,
          byStorage,
          counts: {
            clients: db.clients.length,
            jobs: db.jobs.length,
            tasks: db.tasks.length,
            conversations: db.conversations.length,
            messages: db.messages.length,
            outputs: db.outputs.length,
            versions: db.versions.length,
          },
          seededAt: db.seededAt,
        };
      },
      api: () => apiClient.get('/settings/storage'),
    });
  },

  /** Restores the original demo workspace for everyone using this browser. */
  async resetWorkspace() {
    if (isMockMode) await blobStore.clear();
    return call({
      mock: () => {
        resetDb();
        return { ok: true };
      },
      api: () => Promise.reject(new Error('Workspace reset is only available in demo mode.')),
    });
  },
};
