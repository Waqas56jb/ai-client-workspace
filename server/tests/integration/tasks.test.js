import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';

let app;
let db;
const api = (method, path, user = USERS.amelia) => request(app)[method](`/api/v1${path}`).set(authHeader(user));
const body = (res) => res.body.data;

let clientA;
let clientB;
let jobA;
let jobA2;
let jobB;

beforeAll(async () => {
  ({ app, db } = await createTestContext());
  clientA = body(await api('post', '/clients').send({ name: 'Alpha Co', slug: 'alpha' }));
  clientB = body(await api('post', '/clients').send({ name: 'Beta Co', slug: 'beta' }));
  jobA = body(await api('post', '/jobs').send({ clientId: clientA.id, title: 'Alpha launch' }));
  jobA2 = body(await api('post', '/jobs').send({ clientId: clientA.id, title: 'Alpha retainer' }));
  jobB = body(await api('post', '/jobs').send({ clientId: clientB.id, title: 'Beta launch' }));
});

describe('tasks: create', () => {
  it('creates a task, maps the type and defaults the assignee to the creator', async () => {
    const res = await api('post', '/tasks', USERS.jordan).send({ clientId: clientA.id, jobId: jobA.id, title: 'Launch email', type: 'writing' });
    expect(res.status).toBe(201);
    expect(body(res)).toMatchObject({
      clientId: clientA.id,
      jobId: jobA.id,
      type: 'writing',
      status: 'todo',
      assigneeId: USERS.jordan.id,
      createdBy: USERS.jordan.id,
      client: { id: clientA.id },
      job: { id: jobA.id },
      assignee: { id: USERS.jordan.id },
      conversationCount: 0,
      messageCount: 0,
      outputCount: 0,
      approvalStatus: 'none',
    });
    const { rows } = await db.query('select task_type from public.ai_workspace_tasks where id = $1', [body(res).id]);
    expect(rows[0].task_type).toBe('writing_editing');
  });

  it('rejects a job that belongs to a different client', async () => {
    const res = await api('post', '/tasks').send({ clientId: clientA.id, jobId: jobB.id, title: 'Wrong scope', type: 'image' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('The selected job does not belong to the selected client.');
  });

  it('rejects inactive or unknown assignees and invalid types', async () => {
    const inactive = await api('post', '/tasks').send({ clientId: clientA.id, jobId: jobA.id, title: 'Assigned', type: 'image', assigneeId: USERS.inactive.id });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.message).toMatch(/active team member/);
    const badType = await api('post', '/tasks').send({ clientId: clientA.id, jobId: jobA.id, title: 'Typed', type: 'video' });
    expect(badType.status).toBe(400);
    expect(badType.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('tasks: list', () => {
  beforeAll(async () => {
    const make = (values) => api('post', '/tasks').send({ clientId: clientA.id, jobId: jobA.id, ...values });
    await make({ title: 'Hero banner', type: 'image', status: 'in_progress', assigneeId: USERS.sam.id });
    await make({ title: 'Ad set 50% off', type: 'advertising', status: 'done' });
    await api('post', '/tasks').send({ clientId: clientB.id, jobId: jobB.id, title: 'Beta listing', type: 'vehicle', status: 'review' });
  });

  it('filters by client, job, type, status (incl. open), assignee and approval', async () => {
    const titles = async (query) => (await api('get', '/tasks').query({ sort: 'name', ...query })).body.data.map((t) => t.title);
    expect(await titles({ clientId: clientB.id })).toEqual(['Beta listing']);
    expect(await titles({ jobId: jobA.id })).toEqual(['Ad set 50% off', 'Hero banner', 'Launch email']);
    expect(await titles({ type: 'image' })).toEqual(['Hero banner']);
    expect(await titles({ status: 'open', clientId: clientA.id })).toEqual(['Hero banner', 'Launch email']);
    expect(await titles({ assigneeId: USERS.sam.id })).toEqual(['Hero banner']);
    expect(await titles({ approval: 'approved' })).toEqual([]);
    expect((await titles({ approval: 'none' })).length).toBe(4);
    expect((await titles({ dateRange: '24h' })).length).toBe(4);
  });

  it('searches title and related names with literal wildcards', async () => {
    const res = await api('get', '/tasks').query({ search: '50%' });
    expect(res.body.data.map((t) => t.title)).toEqual(['Ad set 50% off']);
    const byClient = await api('get', '/tasks').query({ search: 'beta co' });
    expect(byClient.body.data.map((t) => t.title)).toEqual(['Beta listing']);
  });

  it('sorts by client and paginates with correct meta', async () => {
    const res = await api('get', '/tasks').query({ sort: 'client', limit: 3, page: 2 });
    expect(res.body.meta).toEqual({ page: 2, limit: 3, total: 4, pages: 2 });
    expect(res.body.data.map((t) => t.client.name)).toEqual(['Beta Co']);
  });
});

describe('tasks: update, move and archive', () => {
  let task;
  beforeAll(async () => {
    task = body(await api('post', '/tasks').send({ clientId: clientA.id, jobId: jobA.id, title: 'Movable task', type: 'general' }));
    await db.query(`insert into public.ai_workspace_conversations (client_id, job_id, task_id, title) values ($1, $2, $3, 'Chat')`, [clientA.id, jobA.id, task.id]);
  });

  it('patches whitelisted fields', async () => {
    const res = await api('patch', `/tasks/${task.id}`).send({ status: 'review', type: 'writing', notes: 'Check tone', createdBy: USERS.sam.id });
    expect(body(res)).toMatchObject({ status: 'review', type: 'writing', notes: 'Check tone', createdBy: USERS.amelia.id, conversationCount: 1 });
  });

  it('refuses to move a task with a conversation to another client; nothing changes', async () => {
    const res = await api('patch', `/tasks/${task.id}`).send({ jobId: jobB.id });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/cannot be moved to a different client/);
    const { rows } = await db.query('select client_id, job_id from public.ai_workspace_conversations where task_id = $1', [task.id]);
    expect(rows).toEqual([{ client_id: clientA.id, job_id: jobA.id }]);
  });

  it('moves a task to another job of the same client, cascading to its conversations', async () => {
    const res = await api('patch', `/tasks/${task.id}`).send({ jobId: jobA2.id });
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ jobId: jobA2.id, clientId: clientA.id });
    const { rows } = await db.query('select client_id, job_id from public.ai_workspace_conversations where task_id = $1', [task.id]);
    expect(rows).toEqual([{ client_id: clientA.id, job_id: jobA2.id }]);
  });

  it('moves a task without client-bound work to a job of another client', async () => {
    const fresh = body(await api('post', '/tasks').send({ clientId: clientA.id, jobId: jobA.id, title: 'Filed under the wrong client', type: 'general' }));
    const res = await api('patch', `/tasks/${fresh.id}`).send({ jobId: jobB.id });
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ jobId: jobB.id, clientId: clientB.id });
  });

  it('rejects a mismatched client/job pair and a client-only change', async () => {
    const mismatch = await api('patch', `/tasks/${task.id}`).send({ jobId: jobA2.id, clientId: clientB.id });
    expect(mismatch.status).toBe(400);
    const clientOnly = await api('patch', `/tasks/${task.id}`).send({ clientId: clientB.id });
    expect(clientOnly.status).toBe(400);
  });

  it('archives a task: excluded from lists but retrievable', async () => {
    const res = await api('post', `/tasks/${task.id}/archive`);
    expect(body(res).archivedAt).toEqual(expect.any(String));
    expect((await api('get', '/tasks')).body.data.map((t) => t.id)).not.toContain(task.id);
    expect((await api('get', '/tasks').query({ includeArchived: 'true' })).body.data.map((t) => t.id)).toContain(task.id);
    expect((await api('get', `/tasks/${task.id}`)).status).toBe(200);
  });

  it('lists task files and activity', async () => {
    await db.query(
      `insert into public.ai_workspace_files (client_id, job_id, task_id, file_name, mime_type, file_category, source_type)
       values ($1, $2, $3, 'notes.txt', 'text/plain', 'text', 'attachment')`,
      [clientA.id, jobA2.id, task.id],
    );
    const files = await api('get', `/tasks/${task.id}/files`);
    expect(files.body.data.map((f) => f.name)).toEqual(['notes.txt']);
    expect(files.body.data[0]).toMatchObject({ category: 'attachment', task: { id: task.id }, job: { id: jobA2.id } });
    const activity = await api('get', `/tasks/${task.id}/activity`);
    expect(activity.body.data.map((a) => a.description)).toEqual(
      expect.arrayContaining(['Created task “Movable task”', 'Moved task “Movable task” to another job', 'Archived task “Movable task”']),
    );
  });

  it('404s for unknown tasks', async () => {
    expect((await api('patch', '/tasks/99999999-9999-4999-8999-999999999999').send({ title: 'Nope nope' })).status).toBe(404);
  });
});
