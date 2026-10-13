import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';
import { createImageOutput, createTextOutput, addImageRevision, getOutputDto } from '../../src/services/output.service.js';

let app;
let db;
let adapter;
let storage;
const seed = {};
const auth = authHeader(USERS.amelia);

async function insert(sql, params) {
  const { rows } = await db.query(sql, params);
  return rows[0].id;
}

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#ffcc00' } }).png().toBuffer();
const asAmelia = (fn) => adapter.withUser(USERS.amelia.id, fn);

beforeAll(async () => {
  ({ app, db, adapter, storage } = await createTestContext());
  seed.clientId = await insert(`insert into public.ai_workspace_clients (name, slug) values ('Gamma Co', 'gamma-co') returning id`);
  seed.jobId = await insert(`insert into public.ai_workspace_jobs (client_id, title) values ($1, 'Autumn') returning id`, [seed.clientId]);
  seed.taskId = await insert(
    `insert into public.ai_workspace_tasks (client_id, job_id, title, task_type) values ($1, $2, 'Copy and art', 'general') returning id`,
    [seed.clientId, seed.jobId],
  );
  seed.conversationId = await insert(
    `insert into public.ai_workspace_conversations (client_id, job_id, task_id, title, tool_type) values ($1, $2, $3, 'Launch email', 'writing_editing') returning id`,
    [seed.clientId, seed.jobId, seed.taskId],
  );
  seed.task = { id: seed.taskId, job_id: seed.jobId, client_id: seed.clientId };

  const text = await asAmelia((tx) =>
    createTextOutput(tx, {
      userId: USERS.amelia.id,
      task: seed.task,
      conversationId: seed.conversationId,
      tool: 'writing',
      outputType: 'email',
      title: 'Launch email',
      content: 'Original launch copy',
      note: 'Initial generation',
    }),
  );
  Object.assign(seed, { textOutputId: text.outputId, textV1: text.versionId, textFileId: text.fileId });
});

describe('text outputs', () => {
  it('createTextOutput creates an output, v1 and a storage-less file record', async () => {
    const res = await request(app).get(`/api/v1/outputs/${seed.textOutputId}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: seed.textOutputId,
      tool: 'writing',
      kind: 'text',
      format: 'email',
      status: 'draft',
      versionCount: 1,
      fileId: seed.textFileId,
      conversationId: seed.conversationId,
      currentVersion: { id: seed.textV1, versionNumber: 1, content: 'Original launch copy', status: 'draft' },
      approvedVersion: null,
    });
    expect(res.body.data.versions).toHaveLength(1);
    const { rows } = await db.query('select storage_path, mime_type, file_size_bytes, source_type from public.ai_workspace_files where id = $1', [seed.textFileId]);
    expect(rows[0]).toMatchObject({ storage_path: null, mime_type: 'text/plain', source_type: 'generated' });
    expect(Number(rows[0].file_size_bytes)).toBe(Buffer.byteLength('Original launch copy'));
  });

  it('a revision creates a new draft and never changes the old version', async () => {
    const res = await request(app)
      .post(`/api/v1/outputs/${seed.textOutputId}/revisions`)
      .set(auth)
      .send({ content: 'Revised launch copy — with sponsor', note: 'Add sponsor' });
    expect(res.status).toBe(201);
    expect(res.body.data.versionCount).toBe(2);
    expect(res.body.data.currentVersion).toMatchObject({ versionNumber: 2, content: 'Revised launch copy — with sponsor', note: 'Add sponsor', sourceVersionId: seed.textV1 });
    const { rows } = await db.query('select content from public.ai_workspace_output_versions where id = $1', [seed.textV1]);
    expect(rows[0].content).toBe('Original launch copy');
    const file = await db.query('select file_size_bytes from public.ai_workspace_files where id = $1', [seed.textFileId]);
    expect(Number(file.rows[0].file_size_bytes)).toBe(Buffer.byteLength('Revised launch copy — with sponsor'));
  });

  it('allocates unique version numbers under 5 concurrent revisions', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => request(app).post(`/api/v1/outputs/${seed.textOutputId}/revisions`).set(auth).send({ content: `Parallel ${i}` })),
    );
    results.forEach((r) => expect(r.status).toBe(201));
    const { rows } = await db.query('select version_number from public.ai_workspace_output_versions where output_id = $1 order by version_number', [seed.textOutputId]);
    expect(rows.map((r) => r.version_number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('restore copies an earlier version into a new draft', async () => {
    const res = await request(app).post(`/api/v1/outputs/${seed.textOutputId}/versions/${seed.textV1}/restore`).set(auth).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.currentVersion).toMatchObject({ versionNumber: 8, content: 'Original launch copy', sourceVersionId: seed.textV1, status: 'draft' });
    expect(res.body.data.versions.map((v) => v.versionNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('rejects revisions without content or source and unknown source versions', async () => {
    expect((await request(app).post(`/api/v1/outputs/${seed.textOutputId}/revisions`).set(auth).send({ note: 'x' })).status).toBe(400);
    const unknown = await request(app)
      .post(`/api/v1/outputs/${seed.textOutputId}/revisions`)
      .set(auth)
      .send({ sourceVersionId: '9b2d6f1e-4a3c-4d2b-8e1f-0a1b2c3d4e5f' });
    expect(unknown.status).toBe(404);
  });

  it('downloads a text version as a text/plain attachment', async () => {
    const res = await request(app).get(`/api/v1/outputs/${seed.textOutputId}/versions/${seed.textV1}/download`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Launch email-v1\.txt"/);
    expect(res.text).toBe('Original launch copy');

    const viaFile = await request(app).get(`/api/v1/files/${seed.textFileId}/download`).query({ versionId: seed.textV1 }).set(auth);
    expect(viaFile.status).toBe(200);
    expect(viaFile.text).toBe('Original launch copy');
  });

  it('lists outputs and versions, renames outputs together with their file', async () => {
    const list = await request(app).get('/api/v1/outputs').query({ taskId: seed.taskId, kind: 'text' }).set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((o) => o.id)).toEqual([seed.textOutputId]);
    const versions = await request(app).get(`/api/v1/outputs/${seed.textOutputId}/versions`).set(auth);
    expect(versions.body.data).toHaveLength(8);
    const one = await request(app).get(`/api/v1/outputs/${seed.textOutputId}/versions/${seed.textV1}`).set(auth);
    expect(one.body.data).toMatchObject({ id: seed.textV1, versionNumber: 1 });

    const renamed = await request(app).patch(`/api/v1/outputs/${seed.textOutputId}`).set(auth).send({ title: 'Entries open email' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.title).toBe('Entries open email');
    const file = await request(app).get(`/api/v1/files/${seed.textFileId}`).set(auth);
    expect(file.body.data).toMatchObject({ name: 'Entries open email.txt', category: 'output', kind: 'text', status: 'draft' });
    expect(file.body.data.output.versions).toHaveLength(8);
    expect(file.body.data.conversation).toMatchObject({ id: seed.conversationId, title: 'Launch email' });
  });

  it('generated output files cannot be archived', async () => {
    const res = await request(app).post(`/api/v1/files/${seed.textFileId}/archive`).set(auth);
    expect(res.status).toBe(409);
  });
});

describe('image outputs', () => {
  const meta = { requestedWidth: 64, requestedHeight: 48, presetId: 'pr_test', prompt: 'Yellow test card', resizeStrategy: 'cover', model: 'gpt-image-2', generatedWidth: 96, generatedHeight: 64 };

  it('createImageOutput rejects mismatched dimensions and stores nothing', async () => {
    const before = storage.objects.size;
    const buffer = await png(60, 48);
    await expect(
      asAmelia((tx) =>
        createImageOutput(tx, { userId: USERS.amelia.id, task: seed.task, title: 'Bad size', finalImage: { buffer, mimeType: 'image/png', width: 60, height: 48 }, imageMeta: meta }),
      ),
    ).rejects.toMatchObject({ status: 422, code: 'IMAGE_DIMENSION_MISMATCH' });
    // Declared size lies about the real pixels
    await expect(
      asAmelia((tx) =>
        createImageOutput(tx, { userId: USERS.amelia.id, task: seed.task, title: 'Liar', finalImage: { buffer, mimeType: 'image/png', width: 64, height: 48 }, imageMeta: meta }),
      ),
    ).rejects.toMatchObject({ status: 422, code: 'IMAGE_DIMENSION_MISMATCH' });
    expect(storage.objects.size).toBe(before);
    const { rows } = await db.query(`select count(*)::int as n from public.ai_workspace_outputs where title in ('Bad size', 'Liar')`);
    expect(rows[0].n).toBe(0);
  });

  it('removes uploaded objects when the database insert fails', async () => {
    const before = storage.objects.size;
    const finalImage = { buffer: await png(64, 48), mimeType: 'image/png', width: 64, height: 48 };
    const badTask = { ...seed.task, job_id: '9b2d6f1e-4a3c-4d2b-8e1f-0a1b2c3d4e5f' }; // scope FK violation
    await expect(
      asAmelia((tx) => createImageOutput(tx, { userId: USERS.amelia.id, task: badTask, title: 'Broken', finalImage, imageMeta: meta })),
    ).rejects.toBeTruthy();
    expect(storage.objects.size).toBe(before);
  });

  it('createImageOutput stores final + original pixels and returns preview URLs', async () => {
    const finalImage = { buffer: await png(64, 48), mimeType: 'image/png', width: 64, height: 48 };
    const originalImage = { buffer: await png(96, 64), mimeType: 'image/png', width: 96, height: 64 };
    const ids = await asAmelia((tx) =>
      createImageOutput(tx, { userId: USERS.amelia.id, task: seed.task, conversationId: seed.conversationId, title: 'Autumn poster', finalImage, originalImage, imageMeta: meta, note: 'First' }),
    );
    seed.image = ids;
    const paths = [...storage.objects.keys()];
    expect(paths.some((p) => p.includes(`/versions/${ids.fileId}/1/`))).toBe(true);
    expect(paths.some((p) => p.endsWith(`/generated/${ids.fileId}/original-v1.png`))).toBe(true);

    const { rows } = await db.query('select metadata from public.ai_workspace_file_versions where id = $1', [ids.fileVersionId]);
    expect(rows[0].metadata).toMatchObject({ requestedWidth: 64, requestedHeight: 48, actualWidth: 64, actualHeight: 48, generatedWidth: 96, originalWidth: 96 });
    const file = await db.query('select file_category, source_type, output_id, current_version_id from public.ai_workspace_files where id = $1', [ids.fileId]);
    expect(file.rows[0]).toMatchObject({ file_category: 'image', source_type: 'generated', output_id: ids.outputId, current_version_id: ids.fileVersionId });

    const dto = await asAmelia((tx) => getOutputDto(tx, ids.outputId, { withVersions: true }));
    expect(dto.currentVersion.image).toMatchObject({ requestedWidth: 64, actualWidth: 64, prompt: 'Yellow test card', fileVersionId: ids.fileVersionId });
    expect(dto.currentVersion.image.previewUrl).toMatch(/^https:\/\/storage\.test\/sign\//);
    expect(JSON.stringify(dto)).not.toContain('originalPath');
  });

  it('addImageRevision stores v2 under a new versioned path', async () => {
    const finalImage = { buffer: await png(64, 48), mimeType: 'image/png', width: 64, height: 48 };
    const r = await asAmelia((tx) => addImageRevision(tx, { userId: USERS.amelia.id, outputId: seed.image.outputId, finalImage, imageMeta: meta, note: 'Brighter' }));
    expect([...storage.objects.keys()].some((p) => p.includes(`/versions/${seed.image.fileId}/2/`))).toBe(true);
    const res = await request(app).get(`/api/v1/outputs/${seed.image.outputId}`).set(auth);
    expect(res.body.data.currentVersion).toMatchObject({ id: r.versionId, versionNumber: 2, image: { fileVersionId: r.fileVersionId } });
  });

  it('image revisions via the API only duplicate an existing version', async () => {
    const bad = await request(app).post(`/api/v1/outputs/${seed.image.outputId}/revisions`).set(auth).send({ content: 'text' });
    expect(bad.status).toBe(400);
    const ok = await request(app).post(`/api/v1/outputs/${seed.image.outputId}/revisions`).set(auth).send({ sourceVersionId: seed.image.versionId, note: 'Back to v1' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.currentVersion).toMatchObject({ versionNumber: 3, image: { fileVersionId: seed.image.fileVersionId } });
    const file = await db.query('select current_version_id from public.ai_workspace_files where id = $1', [seed.image.fileId]);
    expect(file.rows[0].current_version_id).toBe(seed.image.fileVersionId);
  });

  it('downloads an image version as a signed URL', async () => {
    const res = await request(app).get(`/api/v1/outputs/${seed.image.outputId}/versions/${seed.image.versionId}/download`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/download=autumn-poster-v1-64x48\.png/);
    expect(res.body.data.fileName).toBe('Autumn poster-v1-64x48.png');
  });
});
