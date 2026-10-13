import { apiClient, call, notFound } from './apiClient';
import { getDb, mutate } from './mock/db';
import { logActivity, pickClient } from './mock/relations';
import { aspectRatio, createId, matches, nowIso, sortBy } from '@/lib/utils';

function enrich(db, p) {
  return { ...p, aspectRatio: aspectRatio(p.width, p.height), client: p.clientId ? pickClient(db, p.clientId) : null };
}

export const presetService = {
  /** @param {{ search?, scope?: 'all'|'global'|'client', clientId?, includeArchived?, forClientId? }} params
   *  forClientId → global presets plus presets for that client (used by the image workspace). */
  list: (params = {}) =>
    call({
      mock: () => {
        const db = getDb();
        let list = db.presets.map((p) => enrich(db, p));
        if (!params.includeArchived) list = list.filter((p) => !p.archived);
        else if (params.includeArchived === 'only') list = list.filter((p) => p.archived);
        if (params.scope && params.scope !== 'all') list = list.filter((p) => p.scope === params.scope);
        if (params.clientId && params.clientId !== 'all') list = list.filter((p) => p.clientId === params.clientId);
        if (params.forClientId) list = list.filter((p) => p.scope === 'global' || p.clientId === params.forClientId);
        if (params.search) list = list.filter((p) => matches(`${p.name} ${p.description} ${p.client?.name || ''}`, params.search));
        return sortBy(list, (p) => `${p.scope === 'client' ? 1 : 0}${p.isCustom ? 1 : 0}${p.name}`, 'asc');
      },
      api: () => apiClient.get('/image-presets', { params }),
    }),

  get: (id) =>
    call({
      mock: () => {
        const db = getDb();
        const p = db.presets.find((x) => x.id === id);
        if (!p) throw notFound('Preset');
        return enrich(db, p);
      },
      api: () => apiClient.get(`/image-presets/${id}`),
    }),

  create: (values) =>
    call({
      mock: () =>
        mutate((db) => {
          const now = nowIso();
          const p = { id: createId('pr'), ...values, clientId: values.scope === 'client' ? values.clientId : '', isStarter: false, isCustom: false, archived: false, createdAt: now, updatedAt: now, createdBy: null };
          const act = logActivity(db, { type: 'preset_updated', resourceType: 'preset', resourceId: p.id, clientId: p.clientId || null, description: `Created image preset “${p.name}”` });
          p.createdBy = act.userId;
          db.presets.push(p);
          return enrich(db, p);
        }),
      api: () => apiClient.post('/image-presets', values),
    }),

  update: (id, values) =>
    call({
      mock: () =>
        mutate((db) => {
          const p = db.presets.find((x) => x.id === id);
          if (!p) throw notFound('Preset');
          Object.assign(p, values, { clientId: (values.scope ?? p.scope) === 'client' ? values.clientId ?? p.clientId : '', updatedAt: nowIso() });
          logActivity(db, { type: 'preset_updated', resourceType: 'preset', resourceId: id, clientId: p.clientId || null, description: `Updated image preset “${p.name}”` });
          return enrich(db, p);
        }),
      api: () => apiClient.patch(`/image-presets/${id}`, values),
    }),

  duplicate: (id) =>
    call({
      mock: () =>
        mutate((db) => {
          const p = db.presets.find((x) => x.id === id);
          if (!p) throw notFound('Preset');
          const now = nowIso();
          const copy = { ...p, id: createId('pr'), name: `${p.name} (copy)`, isStarter: false, archived: false, createdAt: now, updatedAt: now };
          db.presets.push(copy);
          logActivity(db, { type: 'preset_updated', resourceType: 'preset', resourceId: copy.id, clientId: copy.clientId || null, description: `Duplicated image preset “${p.name}”` });
          return enrich(db, copy);
        }),
      api: () => apiClient.post(`/image-presets/${id}/duplicate`),
    }),

  setArchived: (id, archived) =>
    call({
      mock: () =>
        mutate((db) => {
          const p = db.presets.find((x) => x.id === id);
          if (!p) throw notFound('Preset');
          p.archived = archived;
          p.updatedAt = nowIso();
          if (archived && db.preferences.defaultPresetId === id) db.preferences.defaultPresetId = 'pr_square';
          logActivity(db, { type: 'preset_updated', resourceType: 'preset', resourceId: id, clientId: p.clientId || null, description: `${archived ? 'Archived' : 'Restored'} image preset “${p.name}”` });
          return enrich(db, p);
        }),
      api: () => apiClient.post(`/image-presets/${id}/${archived ? 'archive' : 'restore'}`),
    }),
};
