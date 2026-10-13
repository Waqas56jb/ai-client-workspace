import { getDatabase } from '../config/db.js';
import { ACTIVITY } from '../constants/domain.js';
import { logActivity } from '../repositories/activity.repository.js';
import * as repo from '../repositories/clients.repository.js';
import { listActivity } from '../repositories/activityQuery.repository.js';
import { listFiles } from '../repositories/dashboard.repository.js';
import { withPreviews } from './dashboard.service.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { pageMeta, pagination } from '../utils/mappers.js';

const SLUG_TAKEN = 'Another client already uses this identifier. Choose a different slug.';
const REFERENCE_SOURCES = ['reference', 'logo', 'attachment'];

/** Derives a URL-safe slug from a client name. */
function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '');
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

/** Throws a clear 409 when the slug unique constraint fires (race with the pre-check). */
function rethrowSlugConflict(err) {
  if (err?.code === '23505' && /slug/.test(`${err.constraint || ''} ${err.message || ''}`)) {
    throw conflict(SLUG_TAKEN, [{ path: 'slug', message: SLUG_TAKEN }]);
  }
  throw err;
}

async function requireClient(tx, clientId, opts) {
  const row = await repo.clientRow(tx, clientId, opts);
  if (!row) throw notFound('Client');
  return row;
}

async function loadClient(tx, clientId) {
  const client = await repo.findClient(tx, clientId);
  if (!client) throw notFound('Client');
  return client;
}

/** Paginated client list. @returns {{ items, meta }} */
export function listClients(userId, query) {
  const page = pagination(query, repo.LIST_PAGING);
  return getDatabase().withUser(userId, async (tx) => {
    const { items, total } = await repo.listClients(tx, { ...query, limit: page.limit, offset: page.offset });
    return { items, meta: pageMeta(page, total) };
  });
}

/** One client (archived included) with counts. */
export function getClient(userId, clientId) {
  return getDatabase().withUser(userId, (tx) => loadClient(tx, clientId));
}

/**
 * Creates a client. Brand business fields default to the contact details and
 * writing preferences to the workspace defaults; explicit `brand` values win.
 */
export function createClient(userId, body) {
  return getDatabase().withUser(userId, async (tx) => {
    const slug = body.slug || slugify(body.name);
    if (!slug) throw badRequest('Provide a slug using lowercase letters and numbers.', [{ path: 'slug', message: 'Slug is required.' }]);
    if (await repo.slugTaken(tx, slug)) throw conflict(SLUG_TAKEN, [{ path: 'slug', message: SLUG_TAKEN }]);
    const brandInput = body.brand || {};
    if (brandInput.logoFileId) throw badRequest('Upload the logo to the client first, then select it in the brand profile.');

    const values = { ...omit(body, ['brand']), slug, address: body.address ?? brandInput.address };
    const brand = {
      businessName: body.name,
      phone: body.phone,
      email: body.email,
      website: body.website,
      ...omit(brandInput, [...repo.WRITING_KEYS, 'logoFileId']),
    };
    const writingPreferences = {
      ...repo.WRITING_DEFAULTS,
      ...(await repo.workspaceWritingDefaults(tx)),
      ...pick(brandInput, repo.WRITING_KEYS),
    };
    const clientId = await repo.insertClient(tx, { values, brand, writingPreferences, userId }).catch(rethrowSlugConflict);
    await logActivity(tx, {
      userId,
      type: ACTIVITY.CLIENT_CREATED,
      resourceType: 'client',
      resourceId: clientId,
      clientId,
      description: `Created client “${body.name}”`,
    });
    return loadClient(tx, clientId);
  });
}

/** Updates whitelisted client detail fields. */
export function updateClient(userId, clientId, body) {
  return getDatabase().withUser(userId, async (tx) => {
    const current = await requireClient(tx, clientId, { lock: true });
    if (body.slug && body.slug !== current.slug && (await repo.slugTaken(tx, body.slug, clientId))) {
      throw conflict(SLUG_TAKEN, [{ path: 'slug', message: SLUG_TAKEN }]);
    }
    const restoring = body.status && current.status === 'archived';
    await repo
      .updateClient(tx, clientId, userId, { columns: repo.CLIENT_COLUMNS, values: body, extra: body.status ? ['archived_at = null'] : [] })
      .catch(rethrowSlugConflict);
    await logActivity(tx, {
      userId,
      type: ACTIVITY.CLIENT_UPDATED,
      resourceType: 'client',
      resourceId: clientId,
      clientId,
      description: restoring ? `Restored client “${body.name || current.name}”` : `Updated client details for “${body.name || current.name}”`,
      metadata: { fields: Object.keys(body) },
    });
    return loadClient(tx, clientId);
  });
}

/** The client's brand profile. */
export function getBrand(userId, clientId) {
  return getDatabase().withUser(userId, async (tx) => (await loadClient(tx, clientId)).brand);
}

/**
 * Partially updates the brand profile of exactly this client. A logo must be
 * an active image file that belongs to the same client.
 */
export function updateBrand(userId, clientId, brand) {
  return getDatabase().withUser(userId, async (tx) => {
    const current = await requireClient(tx, clientId, { lock: true });
    if (brand.logoFileId && !(await repo.isClientImageFile(tx, clientId, brand.logoFileId))) {
      throw badRequest('The logo must be an image file that belongs to this client.', [{ path: 'logoFileId', message: 'Choose one of this client’s image files.' }]);
    }
    await repo.updateClient(tx, clientId, userId, {
      columns: repo.BRAND_COLUMNS,
      values: omit(brand, repo.WRITING_KEYS),
      writing: pick(brand, repo.WRITING_KEYS),
    });
    await logActivity(tx, {
      userId,
      type: ACTIVITY.BRAND_UPDATED,
      resourceType: 'client',
      resourceId: clientId,
      clientId,
      description: `Updated the brand profile for “${current.name}”`,
      metadata: { fields: Object.keys(brand) },
    });
    return loadClient(tx, clientId);
  });
}

/** Archives a client (idempotent). All history and work are preserved. */
export function archiveClient(userId, clientId) {
  return getDatabase().withUser(userId, async (tx) => {
    const current = await requireClient(tx, clientId, { lock: true });
    if (current.status !== 'archived') {
      await repo.updateClient(tx, clientId, userId, { columns: repo.CLIENT_COLUMNS, values: { status: 'archived' }, extra: ['archived_at = now()'] });
      await logActivity(tx, {
        userId,
        type: ACTIVITY.CLIENT_ARCHIVED,
        resourceType: 'client',
        resourceId: clientId,
        clientId,
        description: `Archived client “${current.name}” (existing work retained)`,
      });
    }
    return loadClient(tx, clientId);
  });
}

/** Restores an archived client to active (idempotent). */
export function restoreClient(userId, clientId) {
  return getDatabase().withUser(userId, async (tx) => {
    const current = await requireClient(tx, clientId, { lock: true });
    if (current.status === 'archived') {
      await repo.updateClient(tx, clientId, userId, { columns: repo.CLIENT_COLUMNS, values: { status: 'active' }, extra: ['archived_at = null'] });
      await logActivity(tx, {
        userId,
        type: ACTIVITY.CLIENT_UPDATED,
        resourceType: 'client',
        resourceId: clientId,
        clientId,
        description: `Restored client “${current.name}”`,
      });
    }
    return loadClient(tx, clientId);
  });
}

/**
 * What removing the client would affect. The strategy is always 'archive':
 * the schema grants members no DELETE on clients, and every client has
 * append-only activity rows whose ON DELETE SET NULL would be rejected.
 */
export function deletionImpact(userId, clientId) {
  return getDatabase().withUser(userId, async (tx) => {
    await requireClient(tx, clientId);
    const counts = await repo.deletionImpact(tx, clientId);
    const hasWork = counts.jobs + counts.tasks + counts.files + counts.outputs > 0;
    return { ...counts, hasWork, strategy: 'archive' };
  });
}

/** DELETE /clients/:id — archives the client and reports the outcome. */
export async function removeClient(userId, clientId) {
  await archiveClient(userId, clientId);
  return { id: clientId, result: 'archived' };
}

/** Reference material (reference, logo and attachment files) of one client. */
export async function referenceFiles(userId, clientId, query) {
  const page = pagination(query, repo.LIST_PAGING);
  const listing = await getDatabase().withUser(userId, async (tx) => {
    await requireClient(tx, clientId);
    return listFiles(tx, { clientId, sourceTypes: REFERENCE_SOURCES, limit: page.limit, offset: page.offset });
  });
  return { items: await withPreviews(listing), meta: pageMeta(page, listing.total) };
}

/** Activity timeline of one client. */
export function clientActivity(userId, clientId, { limit } = {}) {
  return getDatabase().withUser(userId, async (tx) => {
    await requireClient(tx, clientId);
    return listActivity(tx, { clientId, limit });
  });
}
