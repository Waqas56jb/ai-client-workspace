import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createQaClient, dbRead, get, post, api, signIn } from './helpers/live.js';

/**
 * LIVE — run AFTER migration 0005 is applied (client memory). No OpenAI calls.
 *   npx vitest run -c vitest.live.config.js tests/live/memories.live.test.js
 *
 * 1. The Supabase Data API (REST) cannot read, insert or delete memories with a
 *    member's token — only the Node API can (ai_workspace_is_member + via_api flag).
 * 2. Through the Node API a memory can be created, read and deleted, and is
 *    scoped to its client.
 */

let tableExists = false;
let alpha;
let beta;
beforeAll(async () => {
  tableExists = (await dbRead(`select to_regclass('public.ai_workspace_client_memories') is not null as ok`))[0].ok;
  if (!tableExists) return;
  alpha = await createQaClient('Memory Alpha');
  beta = await createQaClient('Memory Beta');
});
afterAll(closeDb);

describe('client memory (live, after migration 0005)', () => {
  it('migration 0005 is applied', () => {
    expect(tableExists, 'apply migration 0005 first').toBe(true);
  });

  it('the Supabase Data API cannot read, insert or delete memories with a member token', async () => {
    if (!tableExists) return;
    const made = await post(`/clients/${alpha.id}/memories`, { fact: 'QA REST probe: prices include GST.' });
    expect(made.status).toBe(201);

    const s = await signIn('QA_MEMBER_A');
    const h = { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const base = `${process.env.SUPABASE_URL}/rest/v1/ai_workspace_client_memories`;

    const read = await fetch(`${base}?select=*&limit=5`, { headers: h });
    const rows = await read.json();
    expect(Array.isArray(rows) ? rows : [], 'REST read must return nothing').toEqual([]);

    const ins = await fetch(base, { method: 'POST', headers: h, body: JSON.stringify({ client_id: alpha.id, fact: 'forged via REST' }) });
    expect(ins.status).toBeGreaterThanOrEqual(400);
    expect((await dbRead(`select count(*)::int n from public.ai_workspace_client_memories where fact = 'forged via REST'`))[0].n).toBe(0);

    await fetch(`${base}?id=eq.${made.data.id}`, { method: 'DELETE', headers: h });
    expect((await dbRead('select count(*)::int n from public.ai_workspace_client_memories where id = $1', [made.data.id]))[0].n).toBe(1); // still there

    const anon = await fetch(`${base}?select=id`, { headers: { apikey: process.env.SUPABASE_ANON_KEY } });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });

  it('through the Node API: create, read (own client only), delete', async () => {
    if (!tableExists) return;
    const made = await post(`/clients/${alpha.id}/memories`, { fact: 'QA: Sarah is the HR Manager and signs emails as “Sarah, HR Manager”.' });
    expect(made.status).toBe(201);
    expect((await post(`/clients/${alpha.id}/memories`, { fact: 'qa: sarah is the hr manager and signs emails as “sarah, hr manager”.' })).status).toBe(400); // duplicate

    const mine = (await get(`/clients/${alpha.id}/memories`)).data.map((m) => m.fact);
    expect(mine).toContain('QA: Sarah is the HR Manager and signs emails as “Sarah, HR Manager”.');
    const theirs = (await get(`/clients/${beta.id}/memories`)).data.map((m) => m.fact);
    expect(theirs).not.toContain('QA: Sarah is the HR Manager and signs emails as “Sarah, HR Manager”.');

    expect((await api('DELETE', `/clients/${beta.id}/memories/${made.data.id}`)).status).toBe(404); // wrong client
    expect((await api('DELETE', `/clients/${alpha.id}/memories/${made.data.id}`)).status).toBe(200);
    expect((await get(`/clients/${alpha.id}/memories`)).data.map((m) => m.fact)).not.toContain('QA: Sarah is the HR Manager and signs emails as “Sarah, HR Manager”.');
  });
});
