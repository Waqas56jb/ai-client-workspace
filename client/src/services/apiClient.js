import { config, isMockMode } from '@/lib/config';
import { getAccessToken, getSupabase } from '@/lib/supabaseClient';
import { sleep } from '@/lib/utils';

/**
 * Error type shared by mock and live implementations so the UI can handle
 * failures consistently.
 */
export class ServiceError extends Error {
  constructor(message, { status = 400, code = 'error', details, requestId, generationId } = {}) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
    if (requestId) this.requestId = requestId;
    if (generationId) this.generationId = generationId;
  }
}

export const notFound = (what = 'Record') => new ServiceError(`${what} not found. It may have been deleted.`, { status: 404, code: 'not_found' });

/* ───────────────────────── 401 handling ───────────────────────── */

let unauthorizedHandler = null;
let handlingUnauthorized = false;

/** Registered by the auth store: clears the signed-in user so the route guard redirects to /login. */
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

async function handleUnauthorized() {
  if (handlingUnauthorized) return;
  handlingUnauthorized = true;
  try {
    try {
      const supabase = await getSupabase();
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      /* ignore — local session is discarded either way */
    }
    if (unauthorizedHandler) unauthorizedHandler();
    else if (typeof window !== 'undefined' && window.location && !window.location.pathname.startsWith('/login')) window.location.assign('/login');
  } finally {
    handlingUnauthorized = false;
  }
}

/* ───────────────────────── HTTP client (api mode) ───────────────────────── */

function buildUrl(path, params) {
  const url = new URL(`${config.apiBaseUrl.replace(/\/$/, '')}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === 'all') return;
    if (Array.isArray(v)) v.forEach((x) => x !== undefined && x !== null && x !== '' && url.searchParams.append(k, x));
    else url.searchParams.set(k, typeof v === 'boolean' ? String(v) : v);
  });
  return url;
}

/**
 * Sends a request to the Node.js API (`VITE_API_BASE_URL`, which includes /api/v1).
 *
 * - Attaches `Authorization: Bearer <Supabase access token>` (supabase-js refreshes it).
 * - Parses the envelope `{ success, data, meta, message, error: { code, message, details, requestId } }`.
 * - On 401 signs out locally and sends the user to /login.
 * - Supports FormData bodies, an `Idempotency-Key` header and non-JSON responses
 *   (`responseType: 'text' | 'blob'`, or auto-detected from Content-Type).
 *
 * @returns {Promise<{ data: any, meta?: any, message?: string, status: number }>}
 */
async function request(method, path, { body, params, signal, headers: extraHeaders, idempotencyKey, responseType, auth = true } = {}) {
  const url = buildUrl(path, params);
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8', ...(extraHeaders || {}) };
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (auth) {
    let token = null;
    try {
      token = await getAccessToken();
    } catch (err) {
      throw new ServiceError(err?.message || 'Sign-in is not configured.', { status: 0, code: 'auth_unavailable' });
    }
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ServiceError('Could not reach the server. Check your connection and try again.', { status: 0, code: 'network' });
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    const json = isJson ? await res.json().catch(() => null) : null;
    const err = json?.error || {};
    if (res.status === 401 && auth) handleUnauthorized();
    throw new ServiceError(err.message || defaultMessage(res.status), {
      status: res.status,
      code: err.code || `http_${res.status}`,
      details: err.details,
      requestId: err.requestId || res.headers.get('x-request-id') || undefined,
    });
  }

  if (res.status === 204) return { data: null, status: 204 };
  if (responseType === 'blob') return { data: await res.blob(), status: res.status, contentType };
  if (responseType === 'text' || (!isJson && contentType.startsWith('text/'))) {
    return { data: await res.text(), status: res.status, contentType };
  }
  if (!isJson) return { data: await res.blob(), status: res.status, contentType };

  const json = await res.json().catch(() => null);
  if (json && json.success === false) {
    const err = json.error || {};
    throw new ServiceError(err.message || 'The request failed.', { status: res.status, code: err.code || 'error', details: err.details, requestId: err.requestId });
  }
  return { data: json?.data ?? null, meta: json?.meta, message: json?.message, status: res.status };
}

function defaultMessage(status) {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have access to this.';
  if (status === 404) return 'Not found. It may have been deleted.';
  if (status === 409) return 'This conflicts with a recent change. Refresh and try again.';
  if (status === 413) return 'The file is too large.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  return `Request failed (${status})`;
}

/** Largest page the API serves, and a safety cap on how many pages one list may load. */
const PAGE_LIMIT = 500;
const MAX_PAGES = 20;

/**
 * GETs every page of a paginated list endpoint (meta: { page, pages }) and
 * returns them concatenated, so lists never silently stop at the first page.
 */
async function getAll(path, opts = {}) {
  const first = await request('GET', path, { ...opts, params: { ...opts.params, page: 1, limit: PAGE_LIMIT } });
  const pages = Math.min(first.meta?.pages || 1, MAX_PAGES);
  const data = Array.isArray(first.data) ? [...first.data] : first.data;
  for (let page = 2; page <= pages && Array.isArray(data); page += 1) {
    const next = await request('GET', path, { ...opts, params: { ...opts.params, page, limit: PAGE_LIMIT } });
    data.push(...(next.data || []));
  }
  return { ...first, data, meta: { ...first.meta, page: 1, pages: 1, loaded: Array.isArray(data) ? data.length : undefined } };
}

export const apiClient = {
  get: (path, opts) => request('GET', path, opts),
  getAll,
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  delete: (path, opts) => request('DELETE', path, opts),
  request,
};

/** Random idempotency key for one user submission. */
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/* ───────────────────────── generation polling ───────────────────────── */

const SUCCEEDED = new Set(['succeeded', 'completed', 'complete']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled', 'interrupted']);

/**
 * Polls `GET /ai/generations/:id` with backoff (≈1s → 5s) for up to ~3 minutes.
 * Resolves with the generation DTO once it succeeds. Rejects with a ServiceError
 * (code `generation_failed` / `generation_timeout`, `generationId` attached) otherwise.
 */
export async function pollGeneration(id, { timeoutMs = 180_000, signal } = {}) {
  const started = Date.now();
  let delay = 1000;
  for (;;) {
    if (signal?.aborted) throw new ServiceError('Generation polling was cancelled.', { status: 0, code: 'aborted', generationId: id });
    let gen;
    try {
      ({ data: gen } = await apiClient.get(`/ai/generations/${id}`, { signal }));
    } catch (err) {
      // Transient network / 5xx errors: keep polling until the deadline.
      if (!(err instanceof ServiceError) || !(err.status === 0 || err.status >= 500) || Date.now() - started > timeoutMs) throw err;
      gen = null;
    }
    const status = gen?.status;
    if (status && SUCCEEDED.has(status)) return gen;
    if (status && FAILED.has(status)) {
      throw new ServiceError(gen.error?.message || gen.errorMessage || 'The AI request failed. No output was created — retry to send it again.', {
        status: 502,
        code: 'generation_failed',
        details: { generation: gen, errorCode: gen.error?.code || gen.errorCode },
        generationId: id,
      });
    }
    if (Date.now() - started > timeoutMs) {
      throw new ServiceError('The AI request is taking longer than expected. It may still finish — refresh the conversation in a moment.', {
        status: 504,
        code: 'generation_timeout',
        details: { generation: gen },
        generationId: id,
      });
    }
    await sleep(delay);
    delay = Math.min(5000, Math.round(delay * 1.5));
  }
}

/* ───────────────────────── mock / api switch ───────────────────────── */

/** Wraps a synchronous mock handler in the same async `{ data }` envelope as the API. */
async function mockRequest(handler, latency = config.mockLatencyMs) {
  await sleep(latency * (0.6 + Math.random() * 0.8));
  const data = handler();
  // structuredClone prevents UI code from mutating the shared mock store by reference
  return { data: data === undefined ? null : structuredClone(data) };
}

/**
 * Routes a service call to the mock or live implementation and unwraps `{ data }`.
 * @param {{ mock: Function, api: Function, latency?: number }} impl
 */
export async function call({ mock, api, latency }) {
  const res = isMockMode ? await mockRequest(mock, latency) : await api();
  return res?.data ?? null;
}
