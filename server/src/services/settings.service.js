import { getDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { DEFAULT_SETTINGS } from '../constants/defaults.js';
import * as repo from '../repositories/settings.repository.js';
import { badRequest } from '../utils/errors.js';

/** Preferences shown before the settings row exists (same values the seed script writes). */
async function defaults(tx) {
  return {
    workspaceName: DEFAULT_SETTINGS.workspaceName,
    writingPreferences: DEFAULT_SETTINGS.generalWritingPreferences,
    spelling: DEFAULT_SETTINGS.defaultSpelling,
    defaultTone: DEFAULT_SETTINGS.defaultTone,
    dateFormat: DEFAULT_SETTINGS.dateFormat,
    defaultFileView: DEFAULT_SETTINGS.defaultFileView,
    defaultPresetId: await repo.presetIdBySeedKey(tx, DEFAULT_SETTINGS.defaultPresetSeedKey),
    updatedAt: null,
  };
}

/** Workspace preferences (defaults when not yet saved). */
export function getWorkspace(userId) {
  return getDatabase().withUser(userId, async (tx) => (await repo.findSettings(tx)) || defaults(tx));
}

/** Partially updates workspace preferences, creating the single row on first save. */
export function updateWorkspace(userId, body) {
  return getDatabase().withUser(userId, async (tx) => {
    if (body.defaultPresetId && !(await repo.isActivePreset(tx, body.defaultPresetId))) {
      throw badRequest('The default preset must be an active preset that applies to every client.', [{ path: 'defaultPresetId', message: 'Choose an active global preset.' }]);
    }
    const current = (await repo.findSettings(tx)) || (await defaults(tx));
    return repo.upsertSettings(tx, { ...current, ...body }, userId);
  });
}

const CATEGORY_SOURCES = { reference: 'reference', attachment: 'attachment', output: 'generated', logo: 'logo' };
const KINDS = ['image', 'document', 'text', 'other'];

/** Storage and record usage computed from database rows (no estimates or cloud quotas). */
export function storage(userId) {
  return getDatabase().withUser(userId, async (tx) => {
    const u = await repo.storageUsage(tx);
    const byCategory = Object.fromEntries(
      Object.entries(CATEGORY_SOURCES).map(([category, source]) => [
        category,
        { count: u.files_by_source[source] || 0, bytes: Number(u.bytes_by_source[source] || 0) },
      ]),
    );
    return {
      mode: 'supabase',
      bucket: env.STORAGE_BUCKET,
      maxUploadBytes: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
      totalBytes: Object.values(byCategory).reduce((sum, c) => sum + c.bytes, 0),
      fileCount: u.files,
      byCategory,
      byKind: Object.fromEntries(KINDS.map((k) => [k, u.files_by_kind[k] || 0])),
      counts: {
        clients: u.clients,
        jobs: u.jobs,
        tasks: u.tasks,
        conversations: u.conversations,
        messages: u.messages,
        outputs: u.outputs,
        versions: u.versions,
      },
    };
  });
}
