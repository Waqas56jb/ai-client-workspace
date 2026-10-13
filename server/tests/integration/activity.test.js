import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';

let app;
let db;
const api = (method, path, user = USERS.amelia) => request(app)[method](`/api/v1${path}`).set(authHeader(user));
const body = (res) => res.body.data;

let client;
let job;
let task;
let fileId;

beforeAll(async () => {
  ({ app, db } = await createTestContext());
  client = body(await api('post', '/clients').send({ name: 'Alpha Co', slug: 'alpha' }));
  job = body(await api('post', '/jobs', USERS.jordan).send({ clientId: client.id, title: 'Launch' }));
  task = body(await api('post', '/tasks', USERS.jordan).send({ clientId: client.id, jobId: job.id, title: 'Hero image', type: 'image' }));
  const { rows } = await db.query(
    `insert into public.ai_workspace_files (client_id, job_id, task_id, file_name, mime_type, file_category, source_type)
     values ($1, $2, $3, 'hero.png', 'image/png', 'image', 'attachment') returning id`,
    [client.id, job.id, task.id],
  );
  fileId = rows[0].id;
  const log = (resourceType, resourceId, description) =>
    db.query(
      `insert into public.ai_workspace_activity_logs (user_id, action_type, resource_type, resource_id, client_id, job_id, task_id, description)
       values ($1, 'file_uploaded', $2, $3, $4, $5, $6, $7)`,
      [USERS.sam.id, resourceType, resourceId, client.id, job.id, task.id, description],
    );
  await log('file', fileId, 'Uploaded hero.png');
  await log('output', '99999999-9999-4999-8999-999999999999', 'Output that no longer exists');
});

describe('activity', () => {
  it('returns newest first with joined summaries', async () => {
    const res = await api('get', '/activity');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    const created = res.body.data.find((a) => a.type === 'task_created');
    expect(created).toMatchObject({
      userId: USERS.jordan.id,
      resourceType: 'task',
      resourceId: task.id,
      user: { id: USERS.jordan.id, name: USERS.jordan.name },
      client: { id: client.id, name: 'Alpha Co' },
      job: { id: job.id, title: 'Launch' },
      task: { id: task.id, type: 'image' },
      file: null,
      resourceExists: true,
    });
  });

  it('adds a file summary and resourceExists for file/output resources', async () => {
    const res = await api('get', '/activity').query({ type: 'file_uploaded' });
    const file = res.body.data.find((a) => a.resourceType === 'file');
    expect(file).toMatchObject({ file: { id: fileId, name: 'hero.png', kind: 'image' }, resourceExists: true });
    const output = res.body.data.find((a) => a.resourceType === 'output');
    expect(output).toMatchObject({ file: null, resourceExists: false });
  });

  it('filters by scope, user, type and limit', async () => {
    expect(body(await api('get', '/activity').query({ userId: USERS.jordan.id })).map((a) => a.type).sort()).toEqual(['job_created', 'task_created']);
    expect(body(await api('get', '/activity').query({ taskId: task.id }))).toHaveLength(3);
    expect(body(await api('get', '/activity').query({ clientId: client.id, limit: 2 }))).toHaveLength(2);
    expect((await api('get', '/activity').query({ limit: 0 })).status).toBe(400);
    expect((await api('get', '/activity').query({ jobId: 'x' })).status).toBe(400);
  });
});
