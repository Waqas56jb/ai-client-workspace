import { clientColumns, clientSummary, iso } from '../utils/mappers.js';

/**
 * Image presets repository: SQL + row → Preset DTO mapping.
 * DTO field ↔ column map lives in FIELD_COLUMNS (the only writable columns).
 */

const P = 'public.ai_workspace_image_presets';
const CL = 'public.ai_workspace_clients';

/** Writable DTO fields → columns (whitelist; never interpolate anything else). */
export const FIELD_COLUMNS = {
  name: 'name',
  description: 'description',
  width: 'width_px',
  height: 'height_px',
  resizeStrategy: 'resize_strategy',
  background: 'background_instructions',
  layout: 'layout_instructions',
  typography: 'font_instructions',
  brandColors: 'brand_colour_instructions',
  logoPlacement: 'logo_placement_instructions',
  safeArea: 'safe_area_instructions',
  clientId: 'client_id',
};

const SELECT = `p.*, ${clientColumns('cl')}`;
const FROM = `${P} p left join ${CL} cl on cl.id = p.client_id`;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/**
 * Reduced aspect ratio exactly like the frontend util (`16:9`, or `3.20:1` when the reduced terms exceed 50).
 * @param {number} width
 * @param {number} height
 */
export function aspectRatio(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!w || !h) return '—';
  const g = gcd(w, h);
  const rw = w / g;
  const rh = h / g;
  if (rw > 50 || rh > 50) return `${(w / h).toFixed(2)}:1`;
  return `${rw}:${rh}`;
}

/**
 * Row → Preset DTO.
 * @param {object} row
 */
export function toPresetDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    width: row.width_px,
    height: row.height_px,
    scope: row.client_id ? 'client' : 'global',
    clientId: row.client_id || '',
    background: row.background_instructions,
    layout: row.layout_instructions,
    typography: row.font_instructions,
    brandColors: row.brand_colour_instructions,
    logoPlacement: row.logo_placement_instructions,
    safeArea: row.safe_area_instructions,
    resizeStrategy: row.resize_strategy,
    isStarter: row.is_starter,
    isCustom: row.is_custom,
    archived: !row.is_active,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by,
    aspectRatio: aspectRatio(row.width_px, row.height_px),
    client: row.client_id ? clientSummary(row) : null,
  };
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Lists presets. Ordered global first, then custom, then by name (like the frontend).
 * @param {object} tx
 * @param {{ search?: string, scope?: 'all'|'global'|'client', clientId?: string, forClientId?: string, includeArchived?: boolean|'only' }} f
 */
export async function listPresets(tx, f = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('$?', `$${params.length}`));
  };
  if (f.includeArchived === 'only') where.push('not p.is_active');
  else if (!f.includeArchived) where.push('p.is_active');
  if (f.scope === 'global') where.push('p.client_id is null');
  if (f.scope === 'client') where.push('p.client_id is not null');
  if (f.clientId) add('p.client_id = $?', f.clientId);
  if (f.forClientId) add('(p.client_id is null or p.client_id = $?)', f.forClientId);
  if (f.search) add(`(p.name ilike $? escape '\\' or p.description ilike $? escape '\\' or cl.name ilike $? escape '\\')`, `%${escapeLike(f.search)}%`);
  const { rows } = await tx.query(
    `select ${SELECT} from ${FROM} ${where.length ? `where ${where.join(' and ')}` : ''}
      order by (p.client_id is not null), p.is_custom, p.name, p.id limit 500`,
    params,
  );
  return rows;
}

/**
 * Raw preset row (all columns plus client summary columns) or null. Used by the
 * AI module to apply preset guidance; check `is_active` before using it.
 * @param {object} tx
 * @param {string} presetId
 * @returns {Promise<object|null>}
 */
export async function getPresetRow(tx, presetId) {
  const { rows } = await tx.query(`select ${SELECT} from ${FROM} where p.id = $1`, [presetId]);
  return rows[0] || null;
}

/**
 * Inserts a preset from a column map (keys must be FIELD_COLUMNS values or flags).
 * @param {object} tx
 * @param {Record<string, any>} cols
 * @returns {Promise<string>} id
 */
export async function insertPreset(tx, cols) {
  const allowed = new Set([...Object.values(FIELD_COLUMNS), 'is_starter', 'is_custom', 'is_active', 'created_by', 'updated_by']);
  const keys = Object.keys(cols).filter((k) => allowed.has(k));
  const { rows } = await tx.query(
    `insert into ${P} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    keys.map((k) => cols[k]),
  );
  return rows[0].id;
}

/**
 * Updates whitelisted columns (FIELD_COLUMNS values and is_active).
 * @param {object} tx
 * @param {string} id
 * @param {Record<string, any>} cols
 * @param {string} userId
 */
export async function updatePreset(tx, id, cols, userId) {
  const allowed = new Set([...Object.values(FIELD_COLUMNS), 'is_active']);
  const keys = Object.keys(cols).filter((k) => allowed.has(k));
  const params = [id, userId, ...keys.map((k) => cols[k])];
  const sets = ['updated_by = $2', ...keys.map((k, i) => `${k} = $${i + 3}`)];
  const { rowCount } = await tx.query(`update ${P} set ${sets.join(', ')} where id = $1`, params);
  return rowCount > 0;
}

/**
 * True when the client exists and is not archived.
 * @param {object} tx
 * @param {string} clientId
 */
export async function activeClientExists(tx, clientId) {
  const { rows } = await tx.query(`select 1 from ${CL} where id = $1 and archived_at is null`, [clientId]);
  return rows.length > 0;
}

/**
 * When the archived preset is the workspace default, falls back to the active
 * "square" starter preset (or none).
 * @param {object} tx
 * @param {string} presetId
 */
export async function resetDefaultPresetIfArchived(tx, presetId) {
  await tx.query(
    `update public.ai_workspace_settings
        set default_image_preset_id = (select id from ${P} where seed_key = 'square' and is_active and client_id is null and id <> $1 limit 1)
      where default_image_preset_id = $1`,
    [presetId],
  );
}
