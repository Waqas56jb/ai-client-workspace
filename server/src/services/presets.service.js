import { getDatabase } from '../config/db.js';
import { ACTIVITY } from '../constants/domain.js';
import { badRequest, notFound } from '../utils/errors.js';
import { logActivity } from '../repositories/activity.repository.js';
import * as repo from '../repositories/presets.repository.js';

const db = () => getDatabase();

async function requirePreset(tx, id) {
  const row = await repo.getPresetRow(tx, id);
  if (!row) throw notFound('Preset');
  return row;
}

async function requireActiveClient(tx, clientId) {
  if (!(await repo.activeClientExists(tx, clientId))) throw badRequest('The selected client does not exist or is archived.', [{ location: 'body', path: 'clientId', message: 'Select an active client.' }]);
}

/** DTO fields (validated) → column map, excluding scope/clientId which are resolved separately. */
function toColumns(values) {
  const cols = {};
  for (const [field, column] of Object.entries(repo.FIELD_COLUMNS)) {
    if (field === 'clientId') continue;
    if (values[field] !== undefined) cols[column] = values[field];
  }
  return cols;
}

async function log(tx, userId, row, description) {
  await logActivity(tx, { userId, type: ACTIVITY.PRESET_UPDATED, resourceType: 'preset', resourceId: row.id, clientId: row.client_id || null, description, metadata: { presetId: row.id } });
}

/**
 * Lists presets with the frontend's filters.
 * @param {string} userId
 * @param {object} q validated query
 */
export function list(userId, q = {}) {
  const filters = {
    search: q.search || undefined,
    scope: q.scope,
    clientId: q.clientId && q.clientId !== 'all' ? q.clientId : undefined,
    forClientId: q.forClientId || undefined,
    includeArchived: q.includeArchived === 'only' ? 'only' : q.includeArchived === 'true',
  };
  return db().withUser(userId, async (tx) => (await repo.listPresets(tx, filters)).map(repo.toPresetDto));
}

/**
 * @param {string} userId
 * @param {string} id
 */
export function get(userId, id) {
  return db().withUser(userId, async (tx) => repo.toPresetDto(await requirePreset(tx, id)));
}

/**
 * Creates a preset (never a starter). Client scope requires an active client.
 * @param {string} userId
 * @param {object} body validated create body
 */
export function create(userId, body) {
  return db().withUser(userId, async (tx) => {
    const clientId = body.scope === 'client' ? body.clientId : null;
    if (clientId) await requireActiveClient(tx, clientId);
    const id = await repo.insertPreset(tx, { ...toColumns(body), client_id: clientId, is_starter: false, is_custom: false, is_active: true, created_by: userId, updated_by: userId });
    const row = await requirePreset(tx, id);
    await log(tx, userId, row, `Created image preset “${row.name}”`);
    return repo.toPresetDto(row);
  });
}

/**
 * Partially updates a preset. Changing scope to client requires a (possibly
 * existing) active client; scope global clears the client.
 * @param {string} userId
 * @param {string} id
 * @param {object} body validated patch body
 */
export function update(userId, id, body) {
  return db().withUser(userId, async (tx) => {
    const current = await requirePreset(tx, id);
    const cols = toColumns(body);
    const scope = body.scope ?? (current.client_id ? 'client' : 'global');
    if (scope === 'global') {
      cols.client_id = null;
    } else {
      const clientId = body.clientId ? body.clientId : body.clientId === undefined ? current.client_id : null;
      if (!clientId) throw badRequest('Select a client for a client-specific preset.', [{ location: 'body', path: 'clientId', message: 'Select a client for a client-specific preset.' }]);
      if (clientId !== current.client_id) await requireActiveClient(tx, clientId);
      cols.client_id = clientId;
    }
    await repo.updatePreset(tx, id, cols, userId);
    // The workspace default must apply to every client: a preset that becomes client-specific stops being the default.
    if (cols.client_id) await repo.resetDefaultPresetIfArchived(tx, id);
    const row = await requirePreset(tx, id);
    await log(tx, userId, row, `Updated image preset “${row.name}”`);
    return repo.toPresetDto(row);
  });
}

/**
 * Duplicates a preset as a new, active, non-starter preset named "<name> (copy)".
 * @param {string} userId
 * @param {string} id
 */
export function duplicate(userId, id) {
  return db().withUser(userId, async (tx) => {
    const src = await requirePreset(tx, id);
    const cols = {};
    for (const column of Object.values(repo.FIELD_COLUMNS)) cols[column] = src[column];
    cols.name = `${src.name.slice(0, 53).trimEnd()} (copy)`;
    const newId = await repo.insertPreset(tx, { ...cols, is_starter: false, is_custom: src.is_custom, is_active: true, created_by: userId, updated_by: userId });
    const row = await requirePreset(tx, newId);
    await log(tx, userId, row, `Duplicated image preset “${src.name}”`);
    return repo.toPresetDto(row);
  });
}

/**
 * Archives or restores a preset. Archiving the workspace default preset moves
 * the default back to the "square" starter.
 * @param {string} userId
 * @param {string} id
 * @param {boolean} archived
 */
export function setArchived(userId, id, archived) {
  return db().withUser(userId, async (tx) => {
    const current = await requirePreset(tx, id);
    if (!archived && current.client_id && current.client_status === 'archived') {
      throw badRequest('This preset belongs to an archived client. Restore the client first.');
    }
    await repo.updatePreset(tx, id, { is_active: !archived }, userId);
    if (archived) await repo.resetDefaultPresetIfArchived(tx, id);
    const row = await requirePreset(tx, id);
    await log(tx, userId, row, `${archived ? 'Archived' : 'Restored'} image preset “${row.name}”`);
    return repo.toPresetDto(row);
  });
}
