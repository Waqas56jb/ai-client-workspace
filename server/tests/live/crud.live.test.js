import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  account, api, closeDb, createQaClient, createQaJob, createQaTask, dbRead, del, expectSafeError, get, NIL_UUID, patch, post, record, tag,
} from './helpers/live.js';

/** Clients, brand, jobs, tasks and three-user collaboration against the real API + database. */
describe('clients / jobs / tasks (live)', () => {
  let client;
  let other;
  afterAll(closeDb);

  beforeAll(async () => {
    client = await createQaClient('Crud Alpha', { industry: 'Automotive', email: 'alpha@example.com', phone: '+44 20 7946 0000', website: 'https://alpha.example.com' });
    other = await createQaClient('Crud Beta', {}, 'QA_MEMBER_B');
  });

  describe('clients', () => {
    it('create persists exactly what the API returned, attributed to the verified user', async () => {
      const [row] = await dbRead('select id, name, contact_email as email, created_by, status from public.ai_workspace_clients where id = $1', [client.id]);
      expect(row).toMatchObject({ id: client.id, name: client.name, email: 'alpha@example.com', created_by: account('QA_MEMBER_A').id, status: 'active' });
      expect(client.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('protected fields in the body are ignored (mass assignment)', async () => {
      const r = await post('/clients', { name: tag('Mass'), createdBy: account('QA_MEMBER_B').id, id: NIL_UUID, archivedAt: '2020-01-01', jobCount: 99 });
      expect(r.status).toBe(201);
      record('client', r.data.id);
      expect(r.data.id).not.toBe(NIL_UUID);
      expect(r.data.createdBy).toBe(account('QA_MEMBER_A').id);
      expect(r.data.archivedAt).toBeNull();
      expect(r.data.jobCount).toBe(0);
    });

    it('all three members see it; B edits; C sees the edit; activity records B', async () => {
      for (const as of ['QA_MEMBER_B', 'QA_MEMBER_C']) expect((await get(`/clients/${client.id}`, { as })).status).toBe(200);
      const upd = await patch(`/clients/${client.id}`, { description: 'Edited by B', phone: '+44 1632 960000' }, { as: 'QA_MEMBER_B' });
      expect(upd.status).toBe(200);
      const c = await get(`/clients/${client.id}`, { as: 'QA_MEMBER_C' });
      expect(c.data.description).toBe('Edited by B');
      const [row] = await dbRead('select description, updated_by from public.ai_workspace_clients where id = $1', [client.id]);
      expect(row).toEqual({ description: 'Edited by B', updated_by: account('QA_MEMBER_B').id });
      const acts = await dbRead(`select user_id, action_type as activity_type from public.ai_workspace_activity_logs where client_id = $1 order by created_at`, [client.id]);
      expect(acts.some((a) => a.user_id === account('QA_MEMBER_B').id && a.activity_type === 'client_updated')).toBe(true);
    });

    it.each([
      ['missing name', {}],
      ['null name', { name: null }],
      ['number name', { name: 12345 }],
      ['whitespace name', { name: '   ' }],
      ['one-char name', { name: 'x' }],
      ['too long name', { name: 'x'.repeat(81) }],
      ['invalid email', { name: tag('V'), email: 'not-an-email' }],
      ['invalid status', { name: tag('V'), status: 'deleted' }],
      ['bad slug', { name: tag('V'), slug: 'Has Spaces!' }],
      ['bad brand colour', { name: tag('V'), brand: { primaryColor: 'red' } }],
      ['description too long', { name: tag('V'), description: 'x'.repeat(1001) }],
    ])('rejects %s with 400 and field details', async (_n, body) => {
      const r = await post('/clients', body);
      expectSafeError(r, 400, expect);
      expect(Array.isArray(r.error.details)).toBe(true);
    });

    it('rejects malformed JSON and wrong content type safely', async () => {
      const bad = await api('POST', '/clients', { body: '{"name": "x",', headers: { 'Content-Type': 'application/json' } });
      expectSafeError(bad, 400, expect);
      const txt = await api('POST', '/clients', { body: 'name=hello', headers: { 'Content-Type': 'text/plain' } });
      expect([400, 415]).toContain(txt.status);
      expectSafeError(txt, txt.status, expect);
    });

    it('rejects an oversized JSON body (>1 MB) with 413', async () => {
      const r = await post('/clients', { name: tag('Big'), notes: 'x'.repeat(1_100_000) });
      expectSafeError(r, 413, expect);
    });

    it('stores multilingual, punctuation and HTML-like text verbatim (no execution, no mangling)', async () => {
      const name = tag("Ünïcødé O'Brien & Søn — مرحبا اردو 🚗");
      const notes = '<script>alert(1)</script><img src=x onerror=alert(1)> \'; DROP TABLE x; --';
      const r = await post('/clients', { name: name.slice(0, 80), notes });
      expect(r.status).toBe(201);
      record('client', r.data.id);
      const [row] = await dbRead('select name, internal_notes as notes from public.ai_workspace_clients where id = $1', [r.data.id]);
      expect(row).toEqual({ name: name.slice(0, 80), notes });
    });

    it('duplicate names are allowed with a different slug; a duplicate slug is a 409 on the slug field', async () => {
      const a = await post('/clients', { name: tag('Dup') });
      expect(a.status).toBe(201);
      record('client', a.data.id);
      const clash = await post('/clients', { name: tag('Dup') });
      expectSafeError(clash, 409, expect);
      expect(clash.error.details?.[0]?.path).toBe('slug');
      const b = await post('/clients', { name: tag('Dup'), slug: `${a.data.slug}-2` });
      expect(b.status).toBe(201);
      record('client', b.data.id);
      expect(b.data.name).toBe(a.data.name);
    });

    it('search, filters, sort and pagination return real persisted records', async () => {
      const s = await get('/clients', { query: { search: 'Crud Alpha' } });
      expect(s.data.map((c) => c.id)).toContain(client.id);
      expect(s.data.every((c) => /crud alpha/i.test(`${c.name} ${c.industry} ${c.slug}`))).toBe(true);
      const ci = await get('/clients', { query: { search: 'cRuD aLpHa' } });
      expect(ci.data.map((c) => c.id)).toContain(client.id);
      const none = await get('/clients', { query: { search: `zz-no-match-${Date.now()}` } });
      expect(none.data).toEqual([]);
      const page = await get('/clients', { query: { page: 1, limit: 1, sort: 'name' } });
      expect(page.data.length).toBe(1);
      expect(page.meta).toMatchObject({ page: 1, limit: 1 });
      const [cnt] = await dbRead(`select count(*)::int n from public.ai_workspace_clients where status <> 'archived'`);
      expect(page.meta.total).toBe(cnt.n);
      for (const q of [{ page: 0 }, { page: -1 }, { limit: 0 }, { limit: 501 }, { sort: 'password' }, { status: 'bogus' }]) {
        expectSafeError(await get('/clients', { query: q }), 400, expect);
      }
    });

    it.each(["'; drop table x; --", "%' or '1'='1", '_%_%', '\\', '<script>', 'a'.repeat(200), '((((', 'O\'Brien'])('search is injection-safe for %j', async (q) => {
      const r = await get('/clients', { query: { search: q } });
      expect(r.status).toBe(200);
    });

    it('search over 200 chars is rejected, not truncated silently', async () => {
      expectSafeError(await get('/clients', { query: { search: 'a'.repeat(201) } }), 400, expect);
    });

    it('brand profile updates persist and invalid values are rejected', async () => {
      const r = await patch(`/clients/${client.id}/brand`, { primaryColor: '#0A0B0C', warranty: '12 months parts & labour', avoidWords: 'cheap' }, { as: 'QA_MEMBER_C' });
      expect(r.status).toBe(200);
      const b = await get(`/clients/${client.id}/brand`, { as: 'QA_MEMBER_A' });
      expect(b.data).toMatchObject({ primaryColor: '#0A0B0C', warranty: '12 months parts & labour', avoidWords: 'cheap' });
      expectSafeError(await patch(`/clients/${client.id}/brand`, {}), 400, expect);
      expectSafeError(await patch(`/clients/${client.id}/brand`, { primaryColor: 'javascript:alert(1)' }), 400, expect);
      const logo = await patch(`/clients/${client.id}/brand`, { logoFileId: NIL_UUID });
      expect([400, 404]).toContain(logo.status);
    });

    it('archive → hidden from default list, restore → visible; history preserved; DELETE archives', async () => {
      const c = await createQaClient('Archive Me');
      const impact = await get(`/clients/${c.id}/deletion-impact`);
      expect(impact.status).toBe(200);
      expect((await post(`/clients/${c.id}/archive`, {})).status).toBe(200);
      const list = await get('/clients', { query: { limit: 500 } });
      expect(list.data.map((x) => x.id)).not.toContain(c.id);
      const archived = await get('/clients', { query: { status: 'archived', limit: 500 } });
      expect(archived.data.map((x) => x.id)).toContain(c.id);
      expect((await post(`/clients/${c.id}/restore`, {})).status).toBe(200);
      expect((await get(`/clients/${c.id}`)).data.status).not.toBe('archived');
      expect((await del(`/clients/${c.id}`)).status).toBe(200);
      const [row] = await dbRead('select status, archived_at from public.ai_workspace_clients where id = $1', [c.id]);
      expect(row.status).toBe('archived');
      expect(row.archived_at).toBeTruthy();
    });
  });

  describe('jobs & tasks', () => {
    let job;
    let task;
    beforeAll(async () => {
      job = await createQaJob(client.id, 'Spring Campaign', { deadline: '2030-03-31', status: 'active' });
      task = await createQaTask(client.id, job.id, 'Launch email', 'writing', { assigneeId: account('QA_MEMBER_B').id });
    });

    it('job and task persist with the right client chain', async () => {
      const [j] = await dbRead('select client_id, title, deadline::text from public.ai_workspace_jobs where id = $1', [job.id]);
      expect(j).toEqual({ client_id: client.id, title: job.title, deadline: '2030-03-31' });
      const [t] = await dbRead('select client_id, job_id, assignee_id, status from public.ai_workspace_tasks where id = $1', [task.id]);
      expect(t).toEqual({ client_id: client.id, job_id: job.id, assignee_id: account('QA_MEMBER_B').id, status: 'todo' });
    });

    it('rejects a job for a nonexistent client and invalid dates', async () => {
      expect([404, 400]).toContain((await post('/jobs', { clientId: NIL_UUID, title: tag('Orphan') })).status);
      for (const deadline of ['2030-02-30', '31/12/2030', 'tomorrow', '2030-13-01']) {
        expectSafeError(await post('/jobs', { clientId: client.id, title: tag('BadDate'), deadline }), 400, expect);
      }
      const past = await post('/jobs', { clientId: client.id, title: tag('PastDeadline'), deadline: '2001-01-01' });
      expect(past.status).toBe(201); // past deadlines are allowed (back-filled work)
      record('job', past.data.id);
    });

    it('a task cannot be created under another client’s job; a task with AI history cannot be moved to another client', async () => {
      const otherJob = await createQaJob(other.id, 'Other Job', {}, 'QA_MEMBER_B');
      const r = await post('/tasks', { clientId: client.id, jobId: otherJob.id, title: tag('Cross'), type: 'writing' });
      expectSafeError(r, 400, expect);
      // give the task client-bound history, then try to move it
      const conv = await post(`/tasks/${task.id}/conversations`, { title: tag('History'), tool: 'writing' });
      expect(conv.status).toBe(201);
      const u = await patch(`/tasks/${task.id}`, { jobId: otherJob.id });
      expectSafeError(u, 409, expect);
      const [t] = await dbRead('select job_id, client_id from public.ai_workspace_tasks where id = $1', [task.id]);
      expect(t).toEqual({ job_id: job.id, client_id: client.id });
      const [c] = await dbRead('select client_id from public.ai_workspace_conversations where id = $1', [conv.data.id]);
      expect(c.client_id).toBe(client.id);
    });

    it('task validation: type, status, assignee', async () => {
      for (const body of [
        { clientId: client.id, jobId: job.id, title: tag('T'), type: 'poetry' },
        { clientId: client.id, jobId: job.id, title: tag('T'), type: 'writing', status: 'finished' },
        { clientId: client.id, jobId: job.id, title: 'T', type: 'writing' },
        { clientId: client.id, jobId: job.id, title: tag('T') },
      ]) expectSafeError(await post('/tasks', body), 400, expect);
      const badAssignee = await post('/tasks', { clientId: client.id, jobId: job.id, title: tag('T'), type: 'writing', assigneeId: account('QA_OUTSIDER').id });
      expect([400, 404, 422]).toContain(badAssignee.status);
    });

    it('status transitions persist; complete and reopen work; dashboard counts follow the database', async () => {
      const before = (await get('/dashboard/summary')).data.metrics.openTasks.value;
      for (const status of ['in_progress', 'review', 'done', 'todo']) {
        const r = await patch(`/tasks/${task.id}`, { status }, { as: 'QA_MEMBER_C' });
        expect(r.status).toBe(200);
        const [row] = await dbRead('select status from public.ai_workspace_tasks where id = $1', [task.id]);
        expect(row.status).toBe(status);
      }
      await patch(`/tasks/${task.id}`, { status: 'done' });
      const after = (await get('/dashboard/summary')).data.metrics.openTasks.value;
      expect(after).toBe(before - 1);
      const [{ n }] = await dbRead(`select count(*)::int n from public.ai_workspace_tasks where status <> 'done' and archived_at is null`);
      expect(after).toBe(n);
      await patch(`/tasks/${task.id}`, { status: 'todo' });
    });

    it('filters tasks by client, job, status, assignee and search', async () => {
      const r = await get('/tasks', { query: { clientId: client.id, jobId: job.id, assigneeId: account('QA_MEMBER_B').id, status: 'todo', search: 'Launch' } });
      expect(r.status).toBe(200);
      expect(r.data.map((t) => t.id)).toContain(task.id);
      expect(r.data.every((t) => t.clientId === client.id && t.jobId === job.id)).toBe(true);
      expect((await get(`/jobs/${job.id}/tasks`)).data.map((t) => t.id)).toContain(task.id);
    });

    it('concurrent edits by two users both land and the last write is persisted (no corruption)', async () => {
      const [r1, r2] = await Promise.all([
        patch(`/tasks/${task.id}`, { description: 'from A' }, { as: 'QA_MEMBER_A' }),
        patch(`/tasks/${task.id}`, { notes: 'from B' }, { as: 'QA_MEMBER_B' }),
      ]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      const [row] = await dbRead('select description, notes from public.ai_workspace_tasks where id = $1', [task.id]);
      expect(row).toEqual({ description: 'from A', notes: 'from B' });
    });

    it('archiving a task and job keeps references intact', async () => {
      const j = await createQaJob(client.id, 'To archive');
      const t = await createQaTask(client.id, j.id, 'To archive task');
      expect((await post(`/tasks/${t.id}/archive`, {})).status).toBe(200);
      expect((await post(`/jobs/${j.id}/archive`, {})).status).toBe(200);
      const [row] = await dbRead('select t.archived_at is not null as ta, j.status from public.ai_workspace_tasks t join public.ai_workspace_jobs j on j.id = t.job_id where t.id = $1', [t.id]);
      expect(row).toEqual({ ta: true, status: 'archived' });
      expect((await get(`/tasks/${t.id}`)).status).toBe(200);
      expect((await del(`/tasks/${task.id}`, { query: {} })).status).not.toBe(500);
    });
  });
});
