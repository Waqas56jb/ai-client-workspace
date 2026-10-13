import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';
import { createImageOutput, createTextOutput } from '../../src/services/output.service.js';

let app;
let db;
let adapter;
const seed = {};
const auth = authHeader(USERS.amelia);
const jordan = authHeader(USERS.jordan);

async function insert(sql, params) {
  const { rows } = await db.query(sql, params);
  return rows[0].id;
}

beforeAll(async () => {
  ({ app, db, adapter } = await createTestContext());
  seed.clientId = await insert(`insert into public.ai_workspace_clients (name, slug) values ('Delta Co', 'delta-co') returning id`);
  seed.jobId = await insert(`insert into public.ai_workspace_jobs (client_id, title) values ($1, 'Winter') returning id`, [seed.clientId]);
  seed.taskId = await insert(
    `insert into public.ai_workspace_tasks (client_id, job_id, title, task_type) values ($1, $2, 'Newsletter', 'writing_editing') returning id`,
    [seed.clientId, seed.jobId],
  );
  const task = { id: seed.taskId, job_id: seed.jobId, client_id: seed.clientId };
  const text = await adapter.withUser(USERS.amelia.id, (tx) =>
    createTextOutput(tx, { userId: USERS.amelia.id, task, tool: 'writing', outputType: 'email', title: 'Winter newsletter', content: 'Cosy winter specials' }),
  );
  Object.assign(seed, { outputId: text.outputId, v1: text.versionId });

  const buffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#000' } }).png().toBuffer();
  seed.image = await adapter.withUser(USERS.amelia.id, (tx) =>
    createImageOutput(tx, {
      userId: USERS.amelia.id,
      task,
      title: 'Winter tile',
      finalImage: { buffer, mimeType: 'image/png', width: 32, height: 32 },
      imageMeta: { requestedWidth: 32, requestedHeight: 32, prompt: 'Snowflake tile' },
    }),
  );
});

describe('output approvals', () => {
  it('approves a specific version and returns the Output DTO', async () => {
    const res = await request(app).post(`/api/v1/outputs/${seed.outputId}/versions/${seed.v1}/approve`).set(auth).send({ notes: 'Ship it' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: seed.outputId,
      status: 'approved',
      approvedVersionId: seed.v1,
      pendingRevision: false,
      approvedVersion: { id: seed.v1, status: 'approved', approvedBy: USERS.amelia.id, approvedByUser: { id: USERS.amelia.id } },
    });
    expect(res.body.data.versions).toHaveLength(1);
  });

  it('approving the already-approved version is a 409', async () => {
    const res = await request(app).post(`/api/v1/outputs/${seed.outputId}/versions/${seed.v1}/approve`).set(auth).send({});
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('a version from another output is rejected', async () => {
    const res = await request(app).post(`/api/v1/outputs/${seed.outputId}/versions/${seed.image.versionId}/approve`).set(auth).send({});
    expect(res.status).toBe(404);
  });

  it('revising an approved output creates a draft; /approved keeps the approved version', async () => {
    const rev = await request(app).post(`/api/v1/outputs/${seed.outputId}/revisions`).set(auth).send({ content: 'Zebra stripes draft copy', note: 'Experiment' });
    expect(rev.status).toBe(201);
    expect(rev.body.data).toMatchObject({ status: 'approved', pendingRevision: true, approvedVersionId: seed.v1 });
    expect(rev.body.data.currentVersion).toMatchObject({ versionNumber: 2, status: 'draft' });
    seed.v2 = rev.body.data.currentVersion.id;

    const approved = await request(app).get('/api/v1/approved').set(auth);
    expect(approved.status).toBe(200);
    expect(approved.body.data).toHaveLength(1);
    expect(approved.body.data[0]).toMatchObject({
      id: seed.outputId,
      approvedVersion: { id: seed.v1, content: 'Cosy winter specials', versionNumber: 1 },
      currentVersion: { id: seed.v2, status: 'draft' },
      pendingRevision: true,
    });

    // Search applies to the approved version's content, not newer drafts
    const draftOnly = await request(app).get('/api/v1/approved').query({ search: 'zebra' }).set(auth);
    expect(draftOnly.body.data).toHaveLength(0);
    const approvedText = await request(app).get('/api/v1/approved').query({ search: 'cosy' }).set(auth);
    expect(approvedText.body.data).toHaveLength(1);
  });

  it('approving the newer version moves the approved reference and keeps history', async () => {
    const res = await request(app).post(`/api/v1/outputs/${seed.outputId}/versions/${seed.v2}/approve`).set(jordan).send({ notes: 'Better' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ approvedVersionId: seed.v2, pendingRevision: false });
    const { rows } = await db.query('select approval_status from public.ai_workspace_output_versions where id = $1', [seed.v1]);
    expect(rows[0].approval_status).toBe('approved');

    const history = await request(app).get(`/api/v1/outputs/${seed.outputId}/approvals`).set(auth);
    expect(history.status).toBe(200);
    expect(history.body.data.map((h) => [h.versionNumber, h.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(history.body.data[0].approvedBy).toMatchObject({ id: USERS.jordan.id, name: USERS.jordan.name });
  });

  it('filters approved work by approver, kind and tool', async () => {
    await request(app).post(`/api/v1/outputs/${seed.image.outputId}/versions/${seed.image.versionId}/approve`).set(auth).send({});
    const all = await request(app).get('/api/v1/approved').query({ sort: 'title' }).set(auth);
    expect(all.body.data.map((o) => o.title)).toEqual(['Winter newsletter', 'Winter tile']);
    expect(all.body.meta.total).toBe(2);
    const images = await request(app).get('/api/v1/approved').query({ kind: 'image' }).set(auth);
    expect(images.body.data).toHaveLength(1);
    expect(images.body.data[0].approvedVersion.image.previewUrl).toMatch(/^https:\/\/storage\.test\/sign\//);
    const byJordan = await request(app).get('/api/v1/approved').query({ approvedBy: USERS.jordan.id }).set(auth);
    expect(byJordan.body.data.map((o) => o.id)).toEqual([seed.outputId]);
    const writing = await request(app).get('/api/v1/approved').query({ tool: 'writing', dateRange: '7d' }).set(auth);
    expect(writing.body.data.map((o) => o.id)).toEqual([seed.outputId]);
  });
});

describe('/approvals', () => {
  it('POST /approvals approves an output version and GET returns it', async () => {
    const rev = await request(app).post(`/api/v1/outputs/${seed.outputId}/revisions`).set(auth).send({ content: 'Third take' });
    const v3 = rev.body.data.currentVersion.id;
    const res = await request(app).post('/api/v1/approvals').set(auth).send({ outputId: seed.outputId, versionId: v3, notes: 'Final', approvedBy: USERS.sam.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'output', outputId: seed.outputId, versionId: v3, versionNumber: 3, notes: 'Final', isCurrent: true, approvedBy: { id: USERS.amelia.id } });

    const one = await request(app).get(`/api/v1/approvals/${res.body.data.id}`).set(auth);
    expect(one.status).toBe(200);
    expect(one.body.data.id).toBe(res.body.data.id);

    const dup = await request(app).post('/api/v1/approvals').set(auth).send({ outputId: seed.outputId, versionId: v3 });
    expect(dup.status).toBe(409);
  });

  it('lists approvals with filters', async () => {
    const res = await request(app).get('/api/v1/approvals').query({ outputId: seed.outputId }).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.meta.total).toBe(3);
    const byJordan = await request(app).get('/api/v1/approvals').query({ approvedBy: USERS.jordan.id }).set(auth);
    expect(byJordan.body.data).toHaveLength(1);
  });

  it('rejects invalid bodies and unknown approvals', async () => {
    expect((await request(app).post('/api/v1/approvals').set(auth).send({ outputId: seed.outputId })).status).toBe(400);
    expect((await request(app).get('/api/v1/approvals/9b2d6f1e-4a3c-4d2b-8e1f-0a1b2c3d4e5f').set(auth)).status).toBe(404);
  });

  it('approval history is append-only at the database level', async () => {
    const { rows } = await db.query('select id from public.ai_workspace_approvals limit 1');
    await expect(
      adapter.withUser(USERS.amelia.id, (tx) => tx.query('delete from public.ai_workspace_approvals where id = $1', [rows[0].id])),
    ).rejects.toBeTruthy();
  });
});
