/**
 * Live QA helpers. These tests talk to the REAL running API, the REAL Supabase
 * project (Auth, Postgres, Storage) and the REAL OpenAI API. They never use
 * fakes. Run with `npm run test:live` (see tests/live/README.md).
 *
 * Safety:
 *  - Every record created is tagged with the QA run id (`QA_<run>_...`) and
 *    belongs to a QA client, so `npm run qa:cleanup` can remove it by ownership.
 *  - Database verification uses READ ONLY transactions.
 *  - Credentials come from server/.env and server/.env.qa; they are never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '../../..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(SERVER_ROOT, '.env.qa'), override: true, quiet: true });

export const API = (process.env.QA_API_URL || 'http://localhost:5055/api/v1').replace(/\/$/, '');
export const RUN_ID = process.env.QA_RUN_ID || (process.env.QA_RUN_ID = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${crypto.randomBytes(2).toString('hex')}`);
export const tag = (name) => `QA_${RUN_ID}_${name}`;

/* ───────────── run registry (what this run created, for cleanup/reporting) ───────────── */
const RUNS_DIR = path.join(SERVER_ROOT, 'tests/live/.runs');
const REGISTRY = path.join(RUNS_DIR, `${RUN_ID}.json`);
export function record(kind, id, extra = {}) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const data = fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) : { runId: RUN_ID, records: [], openaiCalls: [] };
  data.records.push({ kind, id, at: new Date().toISOString(), ...extra });
  fs.writeFileSync(REGISTRY, JSON.stringify(data, null, 2));
}

/* ───────────── OpenAI budget ───────────── */
const BUDGET = { text: Number(process.env.QA_OPENAI_TEXT_BUDGET || 14), image: Number(process.env.QA_OPENAI_IMAGE_BUDGET || 4) };
export function spendOpenAI(kind, label) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const data = fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) : { runId: RUN_ID, records: [], openaiCalls: [] };
  const used = data.openaiCalls.filter((c) => c.kind === kind).length;
  if (used >= BUDGET[kind]) throw new Error(`QA OpenAI ${kind} budget exhausted (${BUDGET[kind]}). Raise QA_OPENAI_${kind.toUpperCase()}_BUDGET deliberately.`);
  data.openaiCalls.push({ kind, label, at: new Date().toISOString() });
  fs.writeFileSync(REGISTRY, JSON.stringify(data, null, 2));
}

/* ───────────── accounts & sessions ───────────── */
export const ACCOUNTS = ['QA_MEMBER_A', 'QA_MEMBER_B', 'QA_MEMBER_C', 'QA_INACTIVE', 'QA_OUTSIDER'];
export function account(key) {
  const email = process.env[`${key}_EMAIL`];
  const password = process.env[`${key}_PASSWORD`];
  const id = process.env[`${key}_ID`];
  if (!email || !password) throw new Error(`Missing ${key} in server/.env.qa — run node scripts/qa/provision-qa-users.js`);
  return { email, password, id };
}

export function anonSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

const sessions = new Map();
/** Signs in through real Supabase Auth and returns { token, refreshToken, userId, client }. Cached per account. */
export async function signIn(key, { fresh = false } = {}) {
  if (!fresh && sessions.has(key)) return sessions.get(key);
  const { email, password } = account(key);
  const client = anonSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${key} failed: ${error.message}`);
  const s = { token: data.session.access_token, refreshToken: data.session.refresh_token, userId: data.user.id, client };
  if (!fresh) sessions.set(key, s);
  return s;
}

/* ───────────── HTTP ───────────── */
/**
 * Calls the API. `as` is an account key (signed in automatically), a raw token string
 * via { token }, or null for no auth.
 */
export async function api(method, p, { as = 'QA_MEMBER_A', token, body, form, headers = {}, raw = false, query, base = API } = {}) {
  const url = new URL(`${base}${p}`);
  Object.entries(query || {}).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
  const h = { ...headers };
  const auth = token !== undefined ? token : as ? (await signIn(as)).token : null;
  if (auth) h.Authorization = `Bearer ${auth}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    if (typeof body === 'string') payload = body;
    else {
      payload = JSON.stringify(body);
      h['Content-Type'] = h['Content-Type'] || 'application/json';
    }
  }
  const started = performance.now();
  const res = await fetch(url, { method, headers: h, body: payload, redirect: 'manual' });
  const ms = performance.now() - started;
  const ct = res.headers.get('content-type') || '';
  let json = null;
  let buf = null;
  if (raw || !ct.includes('application/json')) buf = Buffer.from(await res.arrayBuffer());
  else json = await res.json().catch(() => null);
  return { status: res.status, json, data: json?.data, error: json?.error, meta: json?.meta, headers: res.headers, buf, ms };
}

export const get = (p, o) => api('GET', p, o);
export const post = (p, body, o = {}) => api('POST', p, { ...o, body });
export const patch = (p, body, o = {}) => api('PATCH', p, { ...o, body });
export const put = (p, body, o = {}) => api('PUT', p, { ...o, body });
export const del = (p, o) => api('DELETE', p, o);

/* ───────────── independent database verification (READ ONLY) ───────────── */
let pool;
function dbPool() {
  if (!pool) {
    const { DATABASE_HOST, DATABASE_MIGRATION_PORT = '5432', DATABASE_NAME = 'postgres', DATABASE_USER, DATABASE_PASSWORD } = process.env;
    pool = new pg.Pool({
      host: DATABASE_HOST, port: Number(DATABASE_MIGRATION_PORT), database: DATABASE_NAME, user: DATABASE_USER, password: DATABASE_PASSWORD,
      ssl: { rejectUnauthorized: false }, max: 2, application_name: 'ai_workspace_qa_verify',
    });
  }
  return pool;
}
/** Runs a SELECT in a READ ONLY transaction (bypasses the API entirely). */
export async function dbRead(sql, params = []) {
  const c = await dbPool().connect();
  try {
    await c.query('begin transaction read only');
    const { rows } = await c.query(sql, params);
    return rows;
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
}
export async function closeDb() {
  if (pool) await pool.end();
  pool = undefined;
}

/* ───────────── storage verification (service role, server-side only) ───────────── */
export function adminSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/* ───────────── fixtures ───────────── */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const NIL_UUID = '00000000-0000-4000-8000-000000000000';

/** Creates a QA client (and optionally job + task) through the real API. */
export async function createQaClient(name, extra = {}, as = 'QA_MEMBER_A') {
  const r = await post('/clients', { name: tag(name), ...extra }, { as });
  if (r.status !== 201) throw new Error(`create client ${name}: ${r.status} ${JSON.stringify(r.error)}`);
  record('client', r.data.id, { name: r.data.name });
  return r.data;
}
export async function createQaJob(clientId, title, extra = {}, as = 'QA_MEMBER_A') {
  const r = await post('/jobs', { clientId, title: tag(title), ...extra }, { as });
  if (r.status !== 201) throw new Error(`create job ${title}: ${r.status} ${JSON.stringify(r.error)}`);
  record('job', r.data.id, { clientId });
  return r.data;
}
export async function createQaTask(clientId, jobId, title, type = 'writing', extra = {}, as = 'QA_MEMBER_A') {
  const r = await post('/tasks', { clientId, jobId, title: tag(title), type, ...extra }, { as });
  if (r.status !== 201) throw new Error(`create task ${title}: ${r.status} ${JSON.stringify(r.error)}`);
  record('task', r.data.id, { clientId, jobId });
  return r.data;
}

/** Polls a generation until it leaves queued/running. */
export async function waitForGeneration(id, { as = 'QA_MEMBER_A', timeoutMs = 240_000, base } = {}) {
  const started = Date.now();
  let delay = 1500;
  for (;;) {
    const r = await get(`/ai/generations/${id}`, { as, base });
    if (r.status !== 200) throw new Error(`poll generation: ${r.status} ${JSON.stringify(r.error)}`);
    if (!['queued', 'running', 'pending'].includes(r.data.status)) return r.data;
    if (Date.now() - started > timeoutMs) throw new Error(`generation ${id} still ${r.data.status} after ${timeoutMs}ms`);
    await sleep(delay);
    delay = Math.min(5000, delay * 1.4);
  }
}

/** Asserts the standard error envelope and that no internals leak. */
export function expectSafeError(r, status, expect) {
  expect(r.status, JSON.stringify(r.json)).toBe(status);
  expect(r.json?.success).toBe(false);
  expect(typeof r.error?.code).toBe('string');
  expect(typeof r.error?.message).toBe('string');
  const s = JSON.stringify(r.json);
  const leak =
    s.match(/at \w+ \(|node_modules|\bstack\b|ai_workspace_\w+_(fkey|key|check)|sk-[A-Za-z0-9]{10}|service_role/i) ||
    s.match(/\b(SELECT|INSERT|UPDATE|DELETE) .+\b(FROM|INTO|SET)\b|\bselect .+ from public\./);
  expect(leak?.[0], `response leaks internals: ${s}`).toBeUndefined();
}
