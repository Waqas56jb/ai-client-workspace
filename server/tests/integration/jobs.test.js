import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';

let app;
let db;
const api = (method, path, user = USERS.amelia) => request(app)[method](`/api/v1${path}`).set(authHeader(user));
const body = (res) => res.body.data;

let clientA;
let clientB;
let archivedClient;

/** Superuser helper: a text output with one version (optionally approved) under a task. */
async function insertOutput(task, { approve = false } = {}) {
  const { rows: [o] } = await db.query(
    `insert into public.ai_workspace_outputs (client_id, job_id, task_id, tool_type, output_kind, output_type, title)
     values ($1, $2, $3, 'writing_editing', 'text', 'email', 'Welcome email') returning id`,
    [task.clientId, task.jobId, task.id],
  );
  const { rows: [v] } = await db.query(
    `insert into public.ai_workspace_output_versions (output_id, task_id, output_type, title, version_number, content)
     values ($1, $2, 'email', 'Welcome email', 1, 'Hello') returning id`,
    [o.id, task.id],
  );
  await db.query('update public.ai_workspace_outputs set current_version_id = $2 where id = $1', [o.id, v.id]);
  if (approve) {
    await db.query(
      `insert into public.ai_workspace_approvals (client_id, job_id, task_id, output_id, output_version_id) values ($1, $2, $3, $4, $5)`,
      [task.clientId, task.jobId, task.id, o.id, v.id],
    );
  }
  return o.id;
}

beforeAll(async () => {
  ({ app, db } = await createTestContext());
  clientA = body(await api('post', '/clients').send({ name: 'Alpha Co', slug: 'alpha' }));
  clientB = body(await api('post', '/clients').send({ name: 'Beta Co', slug: 'beta' }));
  archivedClient = body(await api('post', '/clients').send({ name: 'Old Co', slug: 'old' }));
  await api('post', `/clients/${archivedClient.id}/archive`);
});

describe('jobs: create and read', () => {
  let job;

  it('creates a job with a YYYY-MM-DD deadline', async () => {
    const res = await api('post', '/jobs').send({ clientId: clientA.id, title: 'Spring campaign', deadline: '2026-03-31', notes: 'n' });
    expect(res.status).toBe(201);
    job = body(res);
    expect(job).toMatchObject({
      clientId: clientA.id,
      title: 'Spring campaign',
      status: 'active',
      deadline: '2026-03-31',
      client: { id: clientA.id, name: 'Alpha Co' },
      taskCount: 0,
      doneTaskCount: 0,
      outputCount: 0,
      createdByUser: { id: USERS.amelia.id },
    });
  });

  it('returns an empty deadline when none is set and allows clearing it', async () => {
    const res = await api('patch', `/jobs/${job.id}`).send({ deadline: '' });
    expect(body(res).deadline).toBe('');
  });

  it('validates input', async () => {
    const bad = await api('post', '/jobs').send({ clientId: clientA.id, title: 'X', deadline: '2026-02-30' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((d) => d.path)).toEqual(expect.arrayContaining(['title', 'deadline']));
    expect((await api('post', '/jobs').send({ clientId: 'nope', title: 'Valid title' })).status).toBe(400);
  });

  it('requires an existing, non-archived client', async () => {
    const missing = await api('post', '/jobs').send({ clientId: '99999999-9999-4999-8999-999999999999', title: 'Ghost job' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/no longer exists/);
    const archived = await api('post', '/jobs').send({ clientId: archivedClient.id, title: 'Archived job' });
    expect(archived.status).toBe(400);
    expect(archived.body.error.message).toMatch(/archived/);
  });

  it('404s for unknown jobs', async () => {
    expect((await api('get', '/jobs/99999999-9999-4999-8999-999999999999')).status).toBe(404);
  });
});

describe('jobs: list', () => {
  beforeAll(async () => {
    for (const title of ['Brochure', 'Catalogue', 'Display ads']) {
      await api('post', '/jobs').send({ clientId: clientB.id, title, status: title === 'Catalogue' ? 'on_hold' : 'active' });
    }
  });

  it('filters by client, status and search, with pagination meta', async () => {
    const byClient = await api('get', '/jobs').query({ clientId: clientB.id, sort: 'name', limit: 2 });
    expect(byClient.body.meta).toEqual({ page: 1, limit: 2, total: 3, pages: 2 });
    expect(byClient.body.data.map((j) => j.title)).toEqual(['Brochure', 'Catalogue']);
    const onHold = await api('get', '/jobs').query({ status: 'on_hold' });
    expect(onHold.body.data.map((j) => j.title)).toEqual(['Catalogue']);
    const search = await api('get', '/jobs').query({ search: 'beta co' });
    expect(search.body.meta.total).toBe(3);
  });

  it('archives a job: excluded by default, retrievable by id and with status=archived', async () => {
    const target = (await api('get', '/jobs').query({ search: 'Display' })).body.data[0];
    const res = await api('post', `/jobs/${target.id}/archive`);
    expect(body(res)).toMatchObject({ status: 'archived', archivedAt: expect.any(String) });
    expect((await api('get', '/jobs')).body.data.map((j) => j.id)).not.toContain(target.id);
    expect((await api('get', '/jobs').query({ status: 'archived' })).body.data.map((j) => j.id)).toEqual([target.id]);
    expect(body(await api('get', `/jobs/${target.id}`)).status).toBe('archived');
    expect(body(await api('delete', `/jobs/${target.id}`))).toEqual({ id: target.id, result: 'archived' });
  });
});

describe('jobs: moving to another client', () => {
  it('moves a job without client-bound work, cascading the client change to its tasks', async () => {
    const job = body(await api('post', '/jobs').send({ clientId: clientA.id, title: 'Movable job' }));
    const task = body(await api('post', '/tasks').send({ clientId: clientA.id, jobId: job.id, title: 'Write copy', type: 'writing' }));
    const res = await api('patch', `/jobs/${job.id}`).send({ clientId: clientB.id });
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ clientId: clientB.id, client: { id: clientB.id }, taskCount: 1 });
    expect(body(await api('get', `/tasks/${task.id}`)).client.id).toBe(clientB.id);
  });

  it.each([['a conversation'], ['a file'], ['an output'], ['approval history']])(
    'refuses to move a job with %s to another client (history and AI context stay with the original client)',
    async (kind) => {
      const job = body(await api('post', '/jobs').send({ clientId: clientA.id, title: `Bound job ${kind}` }));
      const task = body(await api('post', '/tasks').send({ clientId: clientA.id, jobId: job.id, title: 'Write copy', type: 'writing' }));
      if (kind === 'a conversation') {
        await db.query(`insert into public.ai_workspace_conversations (client_id, job_id, task_id, title) values ($1, $2, $3, 'Thread')`, [clientA.id, job.id, task.id]);
      } else if (kind === 'a file') {
        await db.query(
          `insert into public.ai_workspace_files (client_id, job_id, task_id, file_name, mime_type, file_category, source_type)
           values ($1, $2, $3, 'brief.txt', 'text/plain', 'text', 'attachment')`,
          [clientA.id, job.id, task.id],
        );
      } else {
        await insertOutput(task, { approve: kind === 'approval history' });
      }
      const before = (await db.query('select id, client_id, approved_by, approved_at from public.ai_workspace_approvals where job_id = $1', [job.id])).rows;
      const res = await api('patch', `/jobs/${job.id}`).send({ clientId: clientB.id });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/cannot be moved to a different client/);
      const scope = async (table) =>
        (await db.query(`select distinct client_id from public.${table} where ${table === 'ai_workspace_jobs' ? 'id' : 'job_id'} = $1`, [job.id])).rows.map((r) => r.client_id);
      for (const table of ['ai_workspace_jobs', 'ai_workspace_tasks', 'ai_workspace_conversations', 'ai_workspace_files', 'ai_workspace_outputs']) {
        expect((await scope(table)).every((c) => c === clientA.id)).toBe(true);
      }
      const after = (await db.query('select id, client_id, approved_by, approved_at from public.ai_workspace_approvals where job_id = $1', [job.id])).rows;
      expect(after).toEqual(before);
    },
  );

  it('still allows other job edits when the job has client-bound work', async () => {
    const job = body(await api('post', '/jobs').send({ clientId: clientA.id, title: 'Edit me' }));
    const task = body(await api('post', '/tasks').send({ clientId: clientA.id, jobId: job.id, title: 'Write copy', type: 'writing' }));
    await insertOutput(task);
    const res = await api('patch', `/jobs/${job.id}`).send({ title: 'Edited title', clientId: clientA.id });
    expect(res.status).toBe(200);
    expect(body(res).title).toBe('Edited title');
  });

  it('refuses to move a job to an archived client', async () => {
    const job = body(await api('post', '/jobs').send({ clientId: clientA.id, title: 'Stay put' }));
    expect((await api('patch', `/jobs/${job.id}`).send({ clientId: archivedClient.id })).status).toBe(400);
  });
});

describe('jobs: children', () => {
  it('lists tasks, files and activity of a job', async () => {
    const job = body(await api('post', '/jobs').send({ clientId: clientA.id, title: 'Parent job' }));
    await api('post', '/tasks').send({ clientId: clientA.id, jobId: job.id, title: 'Child task', type: 'image' });
    const tasks = await api('get', `/jobs/${job.id}/tasks`);
    expect(tasks.body.data.map((t) => t.title)).toEqual(['Child task']);
    expect(tasks.body.meta.total).toBe(1);
    const files = await api('get', `/jobs/${job.id}/files`);
    expect(files.body).toMatchObject({ data: [], meta: { total: 0 } });
    const activity = await api('get', `/jobs/${job.id}/activity`);
    expect(activity.body.data.map((a) => a.type)).toEqual(expect.arrayContaining(['job_created', 'task_created']));
    expect((await api('get', '/jobs/99999999-9999-4999-8999-999999999999/tasks')).status).toBe(404);
  });
});
