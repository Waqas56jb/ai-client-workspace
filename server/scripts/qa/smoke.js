#!/usr/bin/env node
/**
 * Non-destructive deployment smoke test (reads only; creates nothing).
 *
 *   npm run qa:smoke -- --api https://<service>.up.railway.app/api/v1 --web https://<app>.vercel.app
 *
 * Checks: API health + readiness, auth required, CORS for the web origin only,
 * API security headers, frontend loads, SPA deep links work (Vercel rewrite),
 * frontend headers, and that the shipped JavaScript contains no server secrets,
 * no demo-mode data and points at the given API. If QA_MEMBER_A credentials are
 * in .env.qa it also signs in and calls /auth/me.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const API = (arg('api') || '').replace(/\/$/, '');
const WEB = (arg('web') || '').replace(/\/$/, '');
if (!API || !WEB) {
  console.error('Usage: npm run qa:smoke -- --api <https://…/api/v1> --web <https://frontend>');
  process.exit(1);
}

const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

await check('API /health responds 200', async () => {
  const r = await fetch(`${API}/health`);
  assert(r.status === 200, `status ${r.status}`);
});
await check('API /health/ready: database, schema, private storage, AI', async () => {
  const r = await fetch(`${API}/health/ready`);
  const j = await r.json();
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(j.data?.checks)}`);
  return JSON.stringify(j.data.checks);
});
await check('API requires authentication', async () => {
  const r = await fetch(`${API}/clients`);
  assert(r.status === 401, `status ${r.status}`);
});
await check('API is served over HTTPS', async () => assert(API.startsWith('https://'), 'API URL is not https'));
await check('API security headers (HSTS, nosniff, no x-powered-by)', async () => {
  const r = await fetch(`${API}/health`);
  assert(r.headers.get('strict-transport-security'), 'missing HSTS');
  assert(r.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
  assert(!r.headers.get('x-powered-by'), 'x-powered-by present');
});
await check('CORS allows the frontend origin', async () => {
  const r = await fetch(`${API}/clients`, { method: 'OPTIONS', headers: { Origin: WEB, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  assert(r.headers.get('access-control-allow-origin') === WEB, `allow-origin=${r.headers.get('access-control-allow-origin')} (set CLIENT_ORIGIN=${WEB})`);
});
await check('CORS refuses other origins', async () => {
  const r = await fetch(`${API}/clients`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'GET' } });
  assert(!r.headers.get('access-control-allow-origin'), 'evil origin allowed');
});

let html = '';
await check('Frontend loads', async () => {
  const r = await fetch(WEB);
  html = await r.text();
  assert(r.status === 200 && html.includes('<div id="root"'), `status ${r.status}`);
});
await check('SPA deep links resolve (refresh on /clients/…)', async () => {
  const r = await fetch(`${WEB}/clients/00000000-0000-4000-8000-000000000000`);
  assert(r.status === 200 && (await r.text()).includes('<div id="root"'), `status ${r.status}`);
});
await check('Frontend security headers', async () => {
  const r = await fetch(WEB);
  assert(r.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
  assert(r.headers.get('x-frame-options'), 'missing X-Frame-Options');
});
await check('Shipped JS: no secrets, no demo mode, correct API URL', async () => {
  const srcs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], WEB).href);
  const seen = new Set();
  let all = '';
  while (srcs.length) {
    const u = srcs.pop();
    if (seen.has(u)) continue;
    seen.add(u);
    const js = await (await fetch(u)).text();
    all += js;
    for (const m of js.matchAll(/["'`(]\.?\/?(assets\/[\w.-]+\.js)/g)) srcs.push(new URL(`/${m[1]}`, WEB).href);
  }
  for (const s of [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.OPENAI_API_KEY, process.env.DATABASE_PASSWORD].filter(Boolean)) assert(!all.includes(s), 'a server secret is in the bundle');
  assert(!/sk-(proj-)?[A-Za-z0-9_-]{20,}/.test(all), 'OpenAI-style key in bundle');
  assert(!/c_mowsc|samples\/mowsc|mowsc-brand-guidelines/.test(all), 'demo seed data is in the bundle (built in mock mode?)');
  assert(all.includes(API), `bundle does not reference ${API} (check VITE_API_BASE_URL)`);
  return `${seen.size} JS files scanned`;
});

const here = path.dirname(fileURLToPath(import.meta.url));
const envQa = path.resolve(here, '../../.env.qa');
if (fs.existsSync(envQa)) {
  const qa = Object.fromEntries(fs.readFileSync(envQa, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  if (qa.QA_MEMBER_A_EMAIL) {
    await check('Sign in (QA member) and GET /auth/me', async () => {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const { data, error } = await sb.auth.signInWithPassword({ email: qa.QA_MEMBER_A_EMAIL, password: qa.QA_MEMBER_A_PASSWORD });
      assert(!error, error?.message);
      const r = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      assert(r.status === 200, `status ${r.status}`);
      await sb.auth.signOut();
    });
  }
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
