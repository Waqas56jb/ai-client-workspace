import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API, api, closeDb, createQaClient, createQaJob, createQaTask, dbRead, expectSafeError, get, patch, post, SERVER_ROOT, signIn,
} from './helpers/live.js';

/** Conversations/messages + application security checks against the live stack. */
describe('conversations & messages (live)', () => {
  let task;
  let conv;
  afterAll(closeDb);
  beforeAll(async () => {
    const c = await createQaClient('Conv');
    const j = await createQaJob(c.id, 'Conv job');
    task = await createQaTask(c.id, j.id, 'Conv task');
    conv = (await post(`/tasks/${task.id}/conversations`, { title: 'Thread ✓', tool: 'writing' })).data;
  });

  it('messages persist in order with the right sender; visible to other members and in a new session', async () => {
    const texts = ['First', 'مرحبا — اردو میں پیغام', 'Dag! Ça va? 🚗', '<b>html</b> & "quotes"', 'x'.repeat(20000)];
    for (const [i, content] of texts.entries()) {
      const r = await post(`/conversations/${conv.id}/messages`, { content }, { as: i % 2 ? 'QA_MEMBER_B' : 'QA_MEMBER_A' });
      expect(r.status, JSON.stringify(r.error)).toBe(201);
    }
    const fresh = await signIn('QA_MEMBER_C', { fresh: true });
    const list = await api('GET', `/conversations/${conv.id}/messages`, { token: fresh.token });
    expect(list.status).toBe(200);
    expect(list.data.map((m) => m.content)).toEqual(texts);
    const rows = await dbRead('select content, created_by from public.ai_workspace_messages where conversation_id = $1 order by created_at, id', [conv.id]);
    expect(rows.map((r) => r.content)).toEqual(texts);
    const { account } = await import('./helpers/live.js');
    expect(rows[1].created_by).toBe(account('QA_MEMBER_B').id);
  });

  it.each([['empty', ''], ['whitespace', '   \n\t '], ['too long', 'x'.repeat(20001)], ['null', null], ['number', 5]])('rejects %s message', async (_n, content) => {
    expectSafeError(await post(`/conversations/${conv.id}/messages`, { content }), 400, expect);
  });

  it('concurrent messages from different users are all stored once', async () => {
    const before = (await dbRead('select count(*)::int n from public.ai_workspace_messages where conversation_id = $1', [conv.id]))[0].n;
    const rs = await Promise.all(['QA_MEMBER_A', 'QA_MEMBER_B', 'QA_MEMBER_C'].map((as, i) => post(`/conversations/${conv.id}/messages`, { content: `concurrent ${i}` }, { as })));
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201]);
    const after = (await dbRead('select count(*)::int n from public.ai_workspace_messages where conversation_id = $1', [conv.id]))[0].n;
    expect(after - before).toBe(3);
  });

  it('rename/archive conversation persists; invalid tool rejected; another task’s conversation id is 404 through that task', async () => {
    expect((await patch(`/conversations/${conv.id}`, { title: 'Renamed thread' })).status).toBe(200);
    expectSafeError(await patch(`/conversations/${conv.id}`, { tool: 'poetry' }), 400, expect);
    expectSafeError(await post(`/tasks/${task.id}/conversations`, { tool: 'poetry' }), 400, expect);
    const list = await get(`/tasks/${task.id}/conversations`);
    expect(list.data.map((c) => c.id)).toContain(conv.id);
  });
});

describe('security (live)', () => {
  it('Supabase Data API cannot read or write application tables with a member token (migration 0004)', async () => {
    const s = await signIn('QA_MEMBER_A');
    const h = { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const base = `${process.env.SUPABASE_URL}/rest/v1`;
    for (const t of ['ai_workspace_clients', 'ai_workspace_activity_logs', 'ai_workspace_approvals', 'ai_workspace_users', 'ai_workspace_output_versions']) {
      const r = await fetch(`${base}/${t}?select=*&limit=5`, { headers: h });
      const body = await r.json();
      expect(Array.isArray(body) ? body : [], t).toEqual([]);
    }
    const ins = await fetch(`${base}/ai_workspace_activity_logs`, {
      method: 'POST', headers: h, body: JSON.stringify({ action_type: 'forged', resource_type: 'x', description: 'forged via REST' }),
    });
    expect(ins.status).toBeGreaterThanOrEqual(400);
    const rpc = await fetch(`${base}/rpc/ai_workspace_is_member`, { method: 'POST', headers: h, body: '{}' });
    expect(await rpc.json()).toBe(false);
    const forged = await dbRead(`select count(*)::int n from public.ai_workspace_activity_logs where action_type = 'forged'`);
    expect(forged[0].n).toBe(0);
    // anon key alone
    const anon = await fetch(`${base}/ai_workspace_clients?select=id`, { headers: { apikey: process.env.SUPABASE_ANON_KEY } });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });

  it('sends security headers and no x-powered-by', async () => {
    const r = await get('/health', { as: null });
    expect(r.headers.get('x-powered-by')).toBeNull();
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('strict-transport-security')).toBeTruthy();
    expect(r.headers.get('content-security-policy')).toBeTruthy();
    expect(r.headers.get('x-frame-options')).toBeTruthy();
    expect(r.headers.get('x-request-id')).toBeTruthy();
  });

  it('CORS allows only configured origins', async () => {
    const pre = (origin) => fetch(`${API}/clients`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    const ok = await pre('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    for (const evil of ['https://evil.example.com', 'http://localhost:5173.evil.com', 'null']) {
      const r = await pre(evil);
      expect(r.headers.get('access-control-allow-origin'), evil).toBeNull();
    }
  });

  it('stored XSS payloads are returned as inert JSON data (never as HTML)', async () => {
    const c = await createQaClient('<img src=x onerror=alert(document.cookie)>');
    const r = await get(`/clients/${c.id}`);
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    expect(r.data.name).toContain('<img src=x onerror=alert(document.cookie)>');
  });

  it('protected fields cannot be changed through the API (user email/membership, approvals, created_by)', async () => {
    const { account } = await import('./helpers/live.js');
    const me = await patch('/users/me', { email: 'hijack@example.com', isActive: false, role: 'QA role ✓', id: account('QA_MEMBER_B').id });
    expect(me.status).toBe(200);
    const [row] = await dbRead('select email, is_active, role_title from public.ai_workspace_users where id = $1', [account('QA_MEMBER_A').id]);
    expect(row).toEqual({ email: account('QA_MEMBER_A').email, is_active: true, role_title: 'QA role ✓' });
    await patch('/users/me', { role: 'Creative Director' });
    expectSafeError(await patch(`/users/${account('QA_MEMBER_B').id}`, { name: 'Renamed by A' }), 403, expect);
  });

  it('the frontend production bundle contains no server secrets', () => {
    const dist = path.resolve(SERVER_ROOT, '../client/dist/assets');
    if (!fs.existsSync(dist)) throw new Error('client/dist missing — run `npm run build` in client/ first');
    const secrets = [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.OPENAI_API_KEY, process.env.DATABASE_PASSWORD].filter(Boolean);
    expect(secrets.length).toBe(3);
    for (const f of fs.readdirSync(dist)) {
      const content = fs.readFileSync(path.join(dist, f), 'utf8');
      for (const s of secrets) expect(content.includes(s), `${f} contains a server secret`).toBe(false);
      expect(/sk-(proj-)?[A-Za-z0-9_-]{20,}/.test(content), `${f} contains an OpenAI-style key`).toBe(false);
      expect(/service_role/.test(content), `${f} mentions service_role`).toBe(false);
    }
  });

  it('server logs contain no secrets, tokens or prompts', async () => {
    const log = process.env.QA_SERVER_LOG;
    if (!log || !fs.existsSync(log)) return; // log file only available when the suite started the server
    const content = fs.readFileSync(log, 'utf8');
    const s = await signIn('QA_MEMBER_A');
    for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.OPENAI_API_KEY, process.env.DATABASE_PASSWORD, s.token]) {
      expect(content.includes(secret)).toBe(false);
    }
    expect(content).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
  });
});
