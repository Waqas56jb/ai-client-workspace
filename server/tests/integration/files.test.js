import { beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';

let app;
let db;
let storage;
const seed = {};
const auth = authHeader(USERS.amelia);

async function insert(sql, params) {
  const { rows } = await db.query(sql, params);
  return rows[0].id;
}

async function seedScope() {
  const client = (name, slug, status = 'active') =>
    insert(
      `insert into public.ai_workspace_clients (name, slug, status, archived_at, created_by) values ($1, $2, $3, case when $3 = 'archived' then now() end, $4) returning id`,
      [name, slug, status, USERS.amelia.id],
    );
  seed.clientA = await client('Alpha Co', 'alpha-co');
  seed.clientB = await client('Beta Co', 'beta-co');
  seed.archivedClient = await client('Gone Co', 'gone-co', 'archived');
  seed.jobA = await insert(`insert into public.ai_workspace_jobs (client_id, title) values ($1, 'Spring launch') returning id`, [seed.clientA]);
  seed.jobA2 = await insert(`insert into public.ai_workspace_jobs (client_id, title) values ($1, 'Summer launch') returning id`, [seed.clientA]);
  seed.jobB = await insert(`insert into public.ai_workspace_jobs (client_id, title) values ($1, 'Beta job') returning id`, [seed.clientB]);
  seed.taskA = await insert(
    `insert into public.ai_workspace_tasks (client_id, job_id, title, task_type) values ($1, $2, 'Poster set', 'image_creation') returning id`,
    [seed.clientA, seed.jobA],
  );
}

const png = (w = 8, h = 8) => sharp({ create: { width: w, height: h, channels: 3, background: '#3366ff' } }).png().toBuffer();

function upload(fields, buffer, { filename = 'poster.png', contentType = 'image/png', headers = auth } = {}) {
  const req = request(app).post('/api/v1/files/upload').set(headers);
  Object.entries(fields).forEach(([k, v]) => req.field(k, v));
  return req.attach('file', buffer, { filename, contentType });
}

beforeAll(async () => {
  ({ app, db, storage } = await createTestContext());
  await seedScope();
});

describe('POST /files/upload', () => {
  it('stores a verified PNG with checksum, version 1 and derived job', async () => {
    const buf = await png();
    const res = await upload({ clientId: seed.clientA, taskId: seed.taskA, category: 'attachment', description: 'Hero image' }, buf);
    expect(res.status).toBe(201);
    const f = res.body.data;
    expect(f).toMatchObject({
      name: 'poster.png',
      kind: 'image',
      mimeType: 'image/png',
      size: buf.length,
      clientId: seed.clientA,
      jobId: seed.jobA,
      taskId: seed.taskA,
      category: 'attachment',
      storage: 'supabase',
      checksum: crypto.createHash('sha256').update(buf).digest('hex'),
      versionCount: 1,
      status: null,
    });
    expect(f.previewUrl).toMatch(/^https:\/\/storage\.test\/sign\//);
    expect(JSON.stringify(f)).not.toContain('/originals/');

    const { rows } = await db.query('select storage_path, file_checksum, version_number from public.ai_workspace_file_versions where file_id = $1', [f.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].version_number).toBe(1);
    expect(rows[0].file_checksum).toBe(f.checksum);
    expect(rows[0].storage_path).toContain(`clients/${seed.clientA}/jobs/${seed.jobA}/tasks/${seed.taskA}/originals/${f.id}/`);
    expect(storage.objects.has(rows[0].storage_path)).toBe(true);

    const versions = await request(app).get(`/api/v1/files/${f.id}/versions`).set(auth);
    expect(versions.status).toBe(200);
    expect(versions.body.data).toHaveLength(1);
    expect(versions.body.data[0]).toMatchObject({ versionNumber: 1, status: 'draft', checksum: f.checksum });
    seed.pngFileId = f.id;

    const activity = await db.query(`select 1 from public.ai_workspace_activity_logs where action_type = 'file_uploaded' and resource_id = $1`, [f.id]);
    expect(activity.rows).toHaveLength(1);
  });

  it('records reference uploads as brand assets', async () => {
    const res = await upload({ clientId: seed.clientA, category: 'reference' }, Buffer.from('Brand voice: friendly.\n'), {
      filename: 'voice.txt',
      contentType: 'text/plain',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'text', category: 'reference', jobId: null, taskId: null });
    const { rows } = await db.query('select asset_type from public.ai_workspace_brand_assets where file_id = $1', [res.body.data.id]);
    expect(rows[0].asset_type).toBe('reference_document');
    seed.textFileId = res.body.data.id;
  });

  it('rejects spoofed content (text declared as PNG) with 415 and stores nothing', async () => {
    const before = storage.objects.size;
    const res = await upload({ clientId: seed.clientA }, Buffer.from('definitely not an image'));
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(storage.objects.size).toBe(before);
  });

  it('rejects SVG uploads', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await upload({ clientId: seed.clientA }, svg, { filename: 'logo.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(415);
  });

  it('rejects files over the size limit with 413', async () => {
    const big = Buffer.concat([await png(), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await upload({ clientId: seed.clientA }, big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects task/client and job/client mismatches with 400', async () => {
    const buf = await png();
    const wrongClient = await upload({ clientId: seed.clientB, taskId: seed.taskA }, buf);
    expect(wrongClient.status).toBe(400);
    const wrongJob = await upload({ clientId: seed.clientA, taskId: seed.taskA, jobId: seed.jobA2 }, buf);
    expect(wrongJob.status).toBe(400);
    const jobOtherClient = await upload({ clientId: seed.clientA, jobId: seed.jobB }, buf);
    expect(jobOtherClient.status).toBe(400);
  });

  it('rejects uploads to archived clients and missing clientId', async () => {
    const buf = await png();
    expect((await upload({ clientId: seed.archivedClient }, buf)).status).toBe(400);
    expect((await upload({}, buf)).status).toBe(400);
  });

  it('requires authentication and membership', async () => {
    const res = await request(app).post('/api/v1/files/upload').field('clientId', seed.clientA).attach('file', await png(), 'x.png');
    expect(res.status).toBe(401);
    const outsider = await upload({ clientId: seed.clientA }, await png(), { headers: authHeader(USERS.outsider) });
    expect(outsider.status).toBe(403);
  });
});

describe('download, preview and metadata', () => {
  it('download requires auth and returns a short-lived signed attachment URL', async () => {
    expect((await request(app).get(`/api/v1/files/${seed.pngFileId}/download`)).status).toBe(401);
    const res = await request(app).get(`/api/v1/files/${seed.pngFileId}/download`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/^https:\/\/storage\.test\/sign\/.+download=poster\.png/);
    expect(res.body.data.fileName).toBe('poster.png');
    expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('download of an unknown file is 404', async () => {
    const res = await request(app).get(`/api/v1/files/${crypto.randomUUID()}/download`).set(auth);
    expect(res.status).toBe(404);
  });

  it('preview returns an inline URL for images and text', async () => {
    const img = await request(app).get(`/api/v1/files/${seed.pngFileId}/preview`).set(auth);
    expect(img.status).toBe(200);
    expect(img.body.data).toMatchObject({ mimeType: 'image/png' });
    expect(img.body.data.url).not.toContain('download=');
    const txt = await request(app).get(`/api/v1/files/${seed.textFileId}/preview`).set(auth);
    expect(txt.status).toBe(200);
  });

  it('GET /files/:id returns the File DTO', async () => {
    const res = await request(app).get(`/api/v1/files/${seed.pngFileId}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: seed.pngFileId, client: { id: seed.clientA, name: 'Alpha Co' }, task: { id: seed.taskA }, output: null, conversation: null });
    expect(res.body.data.createdByUser).toMatchObject({ id: USERS.amelia.id });
  });

  it('PATCH updates only name and description', async () => {
    const res = await request(app)
      .patch(`/api/v1/files/${seed.pngFileId}`)
      .set(auth)
      .send({ name: 'Hero poster.png', description: 'Updated', clientId: seed.clientB, storagePath: 'evil' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Hero poster.png', description: 'Updated', clientId: seed.clientA });
  });

  it('lists files with filters', async () => {
    const all = await request(app).get('/api/v1/files').set(auth);
    expect(all.status).toBe(200);
    expect(all.body.meta).toMatchObject({ page: 1, total: 2 });
    const images = await request(app).get('/api/v1/files').query({ kind: 'image', clientId: seed.clientA }).set(auth);
    expect(images.body.data.map((f) => f.id)).toEqual([seed.pngFileId]);
    expect(images.body.data[0].previewUrl).toMatch(/ttl=3600/);
    const search = await request(app).get('/api/v1/files').query({ search: 'voice' }).set(auth);
    expect(search.body.data.map((f) => f.id)).toEqual([seed.textFileId]);
    const refs = await request(app).get('/api/v1/files').query({ status: 'reference', sort: 'name' }).set(auth);
    expect(refs.body.data).toHaveLength(2);
  });
});

describe('approval and archive', () => {
  it('approves a task file version once (duplicate → 409)', async () => {
    const versions = await request(app).get(`/api/v1/files/${seed.pngFileId}/versions`).set(auth);
    const versionId = versions.body.data[0].id;
    const res = await request(app).post(`/api/v1/files/${seed.pngFileId}/versions/${versionId}/approve`).set(auth).send({ notes: 'Looks good' });
    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('approved');
    const again = await request(app).post(`/api/v1/files/${seed.pngFileId}/versions/${versionId}/approve`).set(auth).send({});
    expect(again.status).toBe(409);
  });

  it('archived files are hidden by default but keep their storage object', async () => {
    const { rows } = await db.query('select storage_path from public.ai_workspace_files where id = $1', [seed.textFileId]);
    const res = await request(app).post(`/api/v1/files/${seed.textFileId}/archive`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.archived).toBe(true);
    const list = await request(app).get('/api/v1/files').set(auth);
    expect(list.body.data.map((f) => f.id)).not.toContain(seed.textFileId);
    const withArchived = await request(app).get('/api/v1/files').query({ includeArchived: 'true' }).set(auth);
    expect(withArchived.body.data.map((f) => f.id)).toContain(seed.textFileId);
    expect(storage.objects.has(rows[0].storage_path)).toBe(true);
  });
});
