import { apiClient, call, notFound } from './apiClient';
import { getDb, mutate } from './mock/db';
import { logActivity, pickUser } from './mock/relations';
import { seedInstructions } from '@/mock-data';
import { nowIso } from '@/lib/utils';

/**
 * AI tool instructions. Saved changes are used by every subsequent simulated
 * request (see aiRequestBuilder). In the backend phase these are stored in
 * Supabase and applied server-side when calling OpenAI.
 */
export const instructionService = {
  list: () =>
    call({
      mock: () => {
        const db = getDb();
        return db.instructions.map((i) => ({ ...i, updatedByUser: pickUser(db, i.updatedBy) }));
      },
      api: () => apiClient.get('/ai-instructions'),
    }),

  get: (toolId) =>
    call({
      mock: () => {
        const db = getDb();
        const i = db.instructions.find((x) => x.toolId === toolId);
        if (!i) throw notFound('Instruction set');
        return { ...i, updatedByUser: pickUser(db, i.updatedBy) };
      },
      api: () => apiClient.get(`/ai-instructions/${toolId}`),
    }),

  update: (toolId, values) =>
    call({
      mock: () =>
        mutate((db) => {
          const i = db.instructions.find((x) => x.toolId === toolId);
          if (!i) throw notFound('Instruction set');
          const act = logActivity(db, { type: 'instructions_updated', resourceType: 'instruction', resourceId: toolId, description: `Updated ${i.name} instructions (v${i.version + 1})` });
          Object.assign(i, values, { version: i.version + 1, updatedAt: nowIso(), updatedBy: act.userId });
          return { ...i, updatedByUser: pickUser(db, i.updatedBy) };
        }),
      api: () => apiClient.patch(`/ai-instructions/${toolId}`, values),
    }),

  resetToDefaults: (toolId) =>
    call({
      mock: () =>
        mutate((db) => {
          const i = db.instructions.find((x) => x.toolId === toolId);
          const def = seedInstructions().find((x) => x.toolId === toolId);
          if (!i || !def) throw notFound('Instruction set');
          const act = logActivity(db, { type: 'instructions_updated', resourceType: 'instruction', resourceId: toolId, description: `Reset ${i.name} instructions to demo defaults` });
          Object.assign(i, { ...def, version: i.version + 1, updatedAt: nowIso(), updatedBy: act.userId });
          return { ...i, updatedByUser: pickUser(db, i.updatedBy) };
        }),
      api: () => apiClient.post(`/ai-instructions/${toolId}/reset`),
    }),
};
