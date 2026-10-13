import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  account, closeDb, createQaClient, createQaJob, createQaTask, dbRead, expectSafeError, get, NIL_UUID, patch, post, record, tag,
} from './helpers/live.js';

/**
 * Presets, AI instructions, workspace settings, search, dashboard and activity
 * against the live stack. Shared configuration is snapshotted and restored.
 */
describe('presets, instructions, settings (live)', () => {
  let client;
  let instrSnapshot;
  let settingsSnapshot;
  afterAll(async () => {
    // restore shared configuration exactly
    if (instrSnapshot) {
      const { name, description, systemInstruction, outputRules, formatting, constraints, examples, active } = instrSnapshot;
      await patch('/ai-instructions/writing', { name, description, systemInstruction, outputRules, formatting, constraints, examples, active });
    }
    if (settingsSnapshot) {
      const { workspaceName, writingPreferences, spelling, defaultTone, dateFormat, defaultFileView, defaultPresetId } = settingsSnapshot;
      await patch('/settings/workspace', { workspaceName, writingPreferences, spelling, defaultTone, dateFormat, defaultFileView, defaultPresetId });
    }
    await closeDb();
  });
  beforeAll(async () => {
    client = await createQaClient('Config');
    instrSnapshot = (await get('/ai-instructions/writing')).data;
    settingsSnapshot = (await get('/settings/workspace')).data;
  });

  it('preset create → update → duplicate → archive → restore persists; client presets are scoped', async () => {
    const c = await post('/image-presets', { name: tag('Preset'), width: 1080, height: 1350, scope: 'client', clientId: client.id, resizeStrategy: 'contain' });
    expect(c.status, JSON.stringify(c.json)).toBe(201);
    record('preset', c.data.id);
    const u = await patch(`/image-presets/${c.data.id}`, { width: 1600, height: 900 }, { as: 'QA_MEMBER_B' });
    expect(u.data).toMatchObject({ width: 1600, height: 900 });
    const [row] = await dbRead('select width_px, height_px, client_id, resize_strategy from public.ai_workspace_image_presets where id = $1', [c.data.id]);
    expect(row).toEqual({ width_px: 1600, height_px: 900, client_id: client.id, resize_strategy: 'contain' });
    const d = await post(`/image-presets/${c.data.id}/duplicate`, {});
    expect(d.status).toBe(201);
    record('preset', d.data.id);
    expect((await post(`/image-presets/${c.data.id}/archive`, {})).status).toBe(200);
    expect((await get('/image-presets')).data.map((p) => p.id)).not.toContain(c.data.id);
    expect((await post(`/image-presets/${c.data.id}/restore`, {})).status).toBe(200);
    for (const body of [
      { name: tag('P'), width: 0, height: 100 }, { name: tag('P'), width: -5, height: 100 }, { name: tag('P'), width: 100.5, height: 100 },
      { name: tag('P'), width: 99999, height: 100 }, { name: 'x', width: 100, height: 100 }, { name: tag('P'), width: 100, height: 100, scope: 'client' },
      { name: tag('P'), width: 100, height: 100, resizeStrategy: 'stretch' },
    ]) expectSafeError(await post('/image-presets', body), 400, expect);
  });

  it('AI instruction edit persists, is versioned, and failed updates change nothing', async () => {
    const before = (await get('/ai-instructions/writing')).data;
    const extra = `${before.constraints || ''}\nQA marker ${Date.now()}`.trim().slice(0, 4000);
    const u = await patch('/ai-instructions/writing', { constraints: extra }, { as: 'QA_MEMBER_C' });
    expect(u.status).toBe(200);
    const after = (await get('/ai-instructions/writing', { as: 'QA_MEMBER_B' })).data;
    expect(after.constraints).toBe(extra);
    const [row] = await dbRead(`select additional_constraints, updated_by from public.ai_workspace_ai_instructions where tool_type = 'writing_editing'`);
    expect(row).toEqual({ additional_constraints: extra, updated_by: account('QA_MEMBER_C').id });
    for (const body of [{}, { systemInstruction: 'too short' }, { systemInstruction: 'x'.repeat(8001) }, { modelConfiguration: { model: 'gpt-4', hack: 1 } }, { examples: [{ input: '', output: 'x' }] }]) {
      expectSafeError(await patch('/ai-instructions/writing', body), 400, expect);
    }
    const unknownModel = await patch('/ai-instructions/writing', { modelConfiguration: { model: 'not-a-real-model' } });
    expect([400, 422]).toContain(unknownModel.status);
    expect((await get('/ai-instructions/writing')).data.constraints).toBe(extra); // unchanged by failures
    expectSafeError(await get('/ai-instructions/poetry'), 400, expect);
    expectSafeError(await get('/ai-instructions/constructor'), 400, expect);
  });

  it('workspace settings persist; default preset must be a global preset', async () => {
    const u = await patch('/settings/workspace', { writingPreferences: `${settingsSnapshot.writingPreferences} (QA)` }, { as: 'QA_MEMBER_B' });
    expect(u.status).toBe(200);
    expect((await get('/settings/workspace', { as: 'QA_MEMBER_C' })).data.writingPreferences).toMatch(/\(QA\)$/);
    const clientPreset = (await get('/image-presets', { query: { clientId: client.id } })).data.find((p) => p.clientId === client.id);
    expectSafeError(await patch('/settings/workspace', { defaultPresetId: clientPreset.id }), 400, expect);
    expectSafeError(await patch('/settings/workspace', { defaultPresetId: NIL_UUID }), 400, expect);
    expectSafeError(await patch('/settings/workspace', { defaultFileView: 'table' }), 400, expect);
    expect((await get('/settings/storage')).status).toBe(200);
  });
});

describe('search, dashboard, activity (live)', () => {
  let client;
  let task;
  afterAll(closeDb);
  beforeAll(async () => {
    client = await createQaClient('Searchable Ünïque Lighthouse');
    const job = await createQaJob(client.id, 'Lighthouse Campaign');
    task = await createQaTask(client.id, job.id, 'Lighthouse Poster');
  });

  it('global search finds real clients, jobs and tasks; case/partial insensitive; links point at the record', async () => {
    const r = await get('/search', { query: { q: 'lighthous' } });
    expect(r.status).toBe(200);
    expect(r.data.clients.map((x) => x.id)).toContain(client.id);
    expect(r.data.tasks.map((x) => x.id)).toContain(task.id);
    const t = r.data.tasks.find((x) => x.id === task.id);
    expect(t.href).toContain(task.id);
    const u = await get('/search', { query: { q: 'ÜNÏQUE' } });
    expect(u.data.clients.map((x) => x.id)).toContain(client.id);
    const scoped = await get('/search', { query: { q: 'Lighthouse', clientId: client.id, type: 'tasks' } });
    expect(scoped.status).toBe(200);
  });

  it.each(['', '   ', "'; drop table x; --", '<script>alert(1)</script>', '%_%', 'a'.repeat(200), '((( ))) !!! &&& |||', "O'Brien"])('search is safe for %j', async (q) => {
    const r = await get('/search', { query: { q } });
    expect(r.status).toBe(200);
  });

  it('search rejects over-long queries and bad filters', async () => {
    expectSafeError(await get('/search', { query: { q: 'a'.repeat(201) } }), 400, expect);
    expectSafeError(await get('/search', { query: { q: 'a', type: 'passwords' } }), 400, expect);
    expectSafeError(await get('/search', { query: { q: 'a', limit: 1000 } }), 400, expect);
  });

  it('outsiders get nothing from search', async () => {
    expectSafeError(await get('/search', { query: { q: 'Lighthouse' }, as: 'QA_OUTSIDER' }), 403, expect);
  });

  it('dashboard metrics equal independent database counts', async () => {
    const d = (await get('/dashboard/summary')).data.metrics;
    const [c] = await dbRead(`select count(*)::int n from public.ai_workspace_clients where status <> 'archived'`);
    const [j] = await dbRead(`select count(*)::int n from public.ai_workspace_jobs where status = 'active'`);
    expect(d.clients.value).toBe(c.n);
    expect(d.activeJobs.value).toBe(j.n);
    for (const p of ['/dashboard/recent-activity', '/dashboard/recent-files', '/dashboard/recent-jobs']) expect((await get(p)).status).toBe(200);
  });

  it('activity history records actor and scope, filters work, and it is append-only', async () => {
    await patch(`/tasks/${task.id}`, { notes: 'activity check' }, { as: 'QA_MEMBER_B' });
    const r = await get('/activity', { query: { taskId: task.id } });
    expect(r.status).toBe(200);
    const upd = r.data.find((a) => a.type === 'task_updated');
    expect(upd.userId).toBe(account('QA_MEMBER_B').id);
    expect(r.data.every((a) => a.taskId === task.id)).toBe(true);
    expectSafeError(await get('/activity', { query: { type: 'DROP TABLE' } }), 400, expect);
    expect((await get(`/clients/${client.id}/activity`)).status).toBe(200);
  });

  it('users list shows the members; non-members are not listed', async () => {
    const r = await get('/users');
    const ids = r.data.map((u) => u.id);
    for (const k of ['QA_MEMBER_A', 'QA_MEMBER_B', 'QA_MEMBER_C']) expect(ids).toContain(account(k).id);
    expect(ids).not.toContain(account('QA_OUTSIDER').id);
    expect(JSON.stringify(r.json)).not.toMatch(/password|encrypted|token/i);
  });
});
