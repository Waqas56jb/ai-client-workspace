#!/usr/bin/env node
/**
 * Bounded, read-only load test for realistic three-user usage (QA only).
 *
 *   node scripts/qa/load.js [--api http://localhost:5055/api/v1] [--requests 240] [--concurrency 6]
 *
 * The three QA members (server/.env.qa) issue a mix of the reads the UI makes,
 * concurrently. Reports success rate and p50/p95/p99 latency per endpoint. Stays
 * below the per-IP rate limit (RATE_LIMIT_MAX_REQUESTS per window) unless told otherwise.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const API = arg('api', 'http://localhost:5055/api/v1').replace(/\/$/, '');
const TOTAL = Number(arg('requests', 240));
const CONCURRENCY = Number(arg('concurrency', 6));

const here = path.dirname(fileURLToPath(import.meta.url));
const qa = Object.fromEntries(
  fs.readFileSync(path.resolve(here, '../../.env.qa'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const tokens = [];
for (const k of ['QA_MEMBER_A', 'QA_MEMBER_B', 'QA_MEMBER_C']) {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: qa[`${k}_EMAIL`], password: qa[`${k}_PASSWORD`] });
  if (error) throw new Error(`${k}: ${error.message}`);
  tokens.push(data.session.access_token);
}

const get = (p, t) => fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${t}` } });
const first = await (await get('/tasks?limit=1', tokens[0])).json();
const taskId = first.data?.[0]?.id;
const endpoints = [
  '/dashboard/summary', '/clients', '/jobs', '/tasks', '/files', '/approved', '/search?q=QA', '/activity?limit=20', '/image-presets', '/users',
  ...(taskId ? [`/tasks/${taskId}`, `/tasks/${taskId}/conversations`] : []),
];

const samples = {};
let done = 0;
let next = 0;
const started = performance.now();
async function worker(w) {
  while (next < TOTAL) {
    const i = next++;
    const p = endpoints[i % endpoints.length];
    const t0 = performance.now();
    let status = 0;
    try {
      const r = await get(p, tokens[(i + w) % 3]);
      status = r.status;
      await r.arrayBuffer();
    } catch {
      status = -1;
    }
    (samples[p] ||= []).push({ ms: performance.now() - t0, status });
    done += 1;
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)));
const elapsed = (performance.now() - started) / 1000;

const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(q * arr.length))];
const rows = Object.entries(samples).map(([p, s]) => {
  const ms = s.map((x) => x.ms).sort((a, b) => a - b);
  const ok = s.filter((x) => x.status === 200).length;
  return { endpoint: p.replace(/[0-9a-f-]{36}/, ':id'), n: s.length, ok, p50: Math.round(pct(ms, 0.5)), p95: Math.round(pct(ms, 0.95)), p99: Math.round(pct(ms, 0.99)), statuses: [...new Set(s.map((x) => x.status))].join(',') };
});
console.table(rows);
const all = Object.values(samples).flat();
const allMs = all.map((x) => x.ms).sort((a, b) => a - b);
console.log(JSON.stringify({
  api: API, requests: done, concurrency: CONCURRENCY, seconds: Number(elapsed.toFixed(1)), rps: Number((done / elapsed).toFixed(1)),
  success: all.filter((x) => x.status === 200).length, rateLimited: all.filter((x) => x.status === 429).length, serverErrors: all.filter((x) => x.status >= 500 || x.status === -1).length,
  p50: Math.round(pct(allMs, 0.5)), p95: Math.round(pct(allMs, 0.95)), p99: Math.round(pct(allMs, 0.99)),
}));
