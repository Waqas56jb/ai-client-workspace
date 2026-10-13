import crypto from 'node:crypto';
import { getServiceClient } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError, badRequest } from '../utils/errors.js';

/**
 * Private Supabase Storage access for the application bucket ONLY.
 *
 * Callers MUST authorise the request against database records (via RLS-scoped
 * queries) before calling these functions. Paths are always built server-side
 * from validated UUIDs and sanitised names — never taken from the client.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Lower-case, ASCII-only, no path separators; keeps the extension. */
export function safeFileName(name = 'file') {
  const base = String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const cleaned = base
    .replace(/[/\\?%*:|"<>\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/^\.+/, '')
    .slice(-120)
    .toLowerCase();
  return cleaned || 'file';
}

function assertIds(...ids) {
  ids.forEach((id) => {
    if (id != null && !UUID.test(String(id))) throw badRequest('Invalid identifier.');
  });
}

/**
 * Builds an object path.
 * kind: 'originals' | 'generated' | 'versions' | 'references'
 */
export function buildObjectPath({ kind, clientId, jobId = null, taskId = null, fileId, versionNumber = null, fileName }) {
  assertIds(clientId, jobId, taskId, fileId);
  const name = safeFileName(fileName);
  const scope = taskId ? `clients/${clientId}/jobs/${jobId}/tasks/${taskId}` : jobId ? `clients/${clientId}/jobs/${jobId}` : `clients/${clientId}`;
  if (kind === 'versions') {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) throw badRequest('Invalid version number.');
    return `${scope}/versions/${fileId}/${versionNumber}/${name}`;
  }
  if (!['originals', 'generated', 'references'].includes(kind)) throw badRequest('Invalid storage path kind.');
  return `${scope}/${kind}/${fileId}/${name}`;
}

function bucket() {
  return getServiceClient().storage.from(env.STORAGE_BUCKET);
}

function storageError(action, error) {
  return new AppError('STORAGE_ERROR', `File storage ${action} failed. Please try again.`, 502, error?.message ? undefined : undefined);
}

/** Uploads bytes. Never overwrites (upsert: false) — versions are immutable. */
export async function putObject(path, buffer, contentType) {
  const { error } = await bucket().upload(path, buffer, { contentType, upsert: false, cacheControl: '3600' });
  if (error) throw storageError('upload', error);
  return { bucket: env.STORAGE_BUCKET, path };
}

/** Best-effort compensation when a DB write fails after an upload. */
export async function removeObjects(paths) {
  if (!paths?.length) return;
  try {
    await bucket().remove(paths);
  } catch {
    /* orphan cleanup is best effort; the object is private and unreferenced */
  }
}

export async function getObject(path) {
  const { data, error } = await bucket().download(path);
  if (error || !data) throw storageError('download', error);
  return Buffer.from(await data.arrayBuffer());
}

/** Short-lived signed URL. `downloadName` forces Content-Disposition: attachment. */
export async function signedUrl(path, { downloadName, ttl = env.SIGNED_URL_TTL_SECONDS } = {}) {
  const opts = downloadName ? { download: safeFileName(downloadName) } : undefined;
  const { data, error } = await bucket().createSignedUrl(path, ttl, opts);
  if (error || !data?.signedUrl) throw storageError('link creation', error);
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
}

/** Readiness probe: the private bucket exists and is reachable. */
export async function checkBucket() {
  const { data, error } = await getServiceClient().storage.getBucket(env.STORAGE_BUCKET);
  return { ok: !error && !!data, isPrivate: data ? data.public === false : null };
}
