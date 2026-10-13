import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, authHeader, USERS } from '../helpers/testApp.js';

let app;
let db;
const A = authHeader(USERS.amelia);
const ids = {};

beforeAll(async () => {
  ({ app, db } = await createTestContext());
  const one = async (sql, params) => (await db.query(sql, params)).rows[0].id;
  ids.clientA = await one(`insert into public.ai_workspace_clients (name, slug) values ('Alpha Marine', 'alpha-marine') returning id`);
  ids.clientB = await one(`insert into public.ai_workspace_clients (name, slug) values ('Beta Motors', 'beta-motors') returning id`);
  ids.archivedClient = await one(`insert into public.ai_workspace_clients (name, slug, status, archived_at) values ('Gone Co', 'gone-co', 'archived', now()) returning id`);
  ids.square = await one(
    `insert into public.ai_workspace_image_presets (seed_key, name, width_px, height_px, is_starter) values ('square', 'Square social image', 1080, 1080, true) returning id`,
  );
  await db.query(`insert into public.ai_workspace_settings (id) values (1) on conflict do nothing`);
});

const base = { name: 'Poster', width: 1080, height: 1350, scope: 'global' };

describe('image presets', () => {
  let globalId;
  let clientAId;

  it('creates a global preset with DTO fields and logs activity', async () => {
    const res = await request(app)
      .post('/api/v1/image-presets')
      .set(A)
      .send({ ...base, description: 'Tall', layout: 'Headline top', isStarter: true, createdBy: USERS.sam.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Poster', width: 1080, height: 1350, scope: 'global', clientId: '', aspectRatio: '4:5', archived: false, isStarter: false, isCustom: false, layout: 'Headline top', createdBy: USERS.amelia.id, client: null });
    globalId = res.body.data.id;
    const { rows } = await db.query(`select action_type, resource_type from public.ai_workspace_activity_logs where resource_id = $1`, [globalId]);
    expect(rows).toEqual([{ action_type: 'preset_updated', resource_type: 'preset' }]);
  });

  it('validates dimensions, name and client scope', async () => {
    const bad = async (body) => (await request(app).post('/api/v1/image-presets').set(A).send(body)).status;
    expect(await bad({ ...base, width: 63 })).toBe(400);
    expect(await bad({ ...base, height: 4097 })).toBe(400); // above IMAGE_MAX_DIMENSION_PX: could never be generated
    expect(await bad({ ...base, width: 1080.5 })).toBe(400);
    expect(await bad({ ...base, width: 'wide' })).toBe(400);
    expect(await bad({ ...base, name: 'x' })).toBe(400);
    expect(await bad({ ...base, scope: 'client' })).toBe(400);
    expect(await bad({ ...base, scope: 'client', clientId: ids.archivedClient })).toBe(400);
    expect(await bad({ ...base, scope: 'client', clientId: '00000000-0000-4000-8000-000000000000' })).toBe(400);
    // Extreme aspect ratios are allowed for presets (crop handles them)
    expect(await bad({ ...base, name: 'Skinny', width: 64, height: 4096 })).toBe(201);
  });

  it('creates a client preset with the client summary and reduced aspect ratio', async () => {
    const res = await request(app).post('/api/v1/image-presets').set(A).send({ ...base, name: 'Alpha banner', width: 1920, height: 600, scope: 'client', clientId: ids.clientA });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ scope: 'client', clientId: ids.clientA, aspectRatio: '16:5', client: { id: ids.clientA, name: 'Alpha Marine' } });
    clientAId = res.body.data.id;
    await request(app).post('/api/v1/image-presets').set(A).send({ ...base, name: 'Beta square', scope: 'client', clientId: ids.clientB });
  });

  it('lists with search / scope / clientId / forClientId filters', async () => {
    const names = async (qs) => (await request(app).get(`/api/v1/image-presets${qs}`).set(A)).body.data.map((p) => p.name);
    const all = await names('');
    expect(all).toEqual(expect.arrayContaining(['Poster', 'Square social image', 'Alpha banner', 'Beta square']));
    // global first, then client presets
    expect(all.indexOf('Alpha banner')).toBeGreaterThan(all.indexOf('Poster'));
    const forA = await names(`?forClientId=${ids.clientA}`);
    expect(forA).toContain('Alpha banner');
    expect(forA).toContain('Poster');
    expect(forA).not.toContain('Beta square');
    expect(await names('?scope=client')).toEqual(['Alpha banner', 'Beta square']);
    expect(await names(`?clientId=${ids.clientB}`)).toEqual(['Beta square']);
    expect(await names('?search=alpha')).toEqual(['Alpha banner']); // matches preset or client name
    expect(await names(`?search=${encodeURIComponent('%')}`)).toEqual([]);
    expect((await request(app).get('/api/v1/image-presets?scope=weird').set(A)).status).toBe(400);
  });

  it('updates via PATCH, including scope changes', async () => {
    const res = await request(app).patch(`/api/v1/image-presets/${globalId}`).set(A).send({ width: 1200, height: 628, safeArea: 'Keep clear', isStarter: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ width: 1200, height: 628, aspectRatio: '1.91:1', safeArea: 'Keep clear', isStarter: false });

    const toClient = await request(app).patch(`/api/v1/image-presets/${globalId}`).set(A).send({ scope: 'client', clientId: ids.clientB });
    expect(toClient.body.data).toMatchObject({ scope: 'client', clientId: ids.clientB });
    const toGlobal = await request(app).patch(`/api/v1/image-presets/${globalId}`).set(A).send({ scope: 'global' });
    expect(toGlobal.body.data).toMatchObject({ scope: 'global', clientId: '', client: null });
    expect((await request(app).patch(`/api/v1/image-presets/${globalId}`).set(A).send({ scope: 'client' })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/image-presets/${globalId}`).set(A).send({ height: 9000 })).status).toBe(400);
    expect((await request(app).patch('/api/v1/image-presets/00000000-0000-4000-8000-000000000000').set(A).send({ name: 'Nope' })).status).toBe(404);
  });

  it('duplicates a preset', async () => {
    const res = await request(app).post(`/api/v1/image-presets/${ids.square}/duplicate`).set(authHeader(USERS.jordan));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Square social image (copy)', width: 1080, height: 1080, isStarter: false, archived: false, createdBy: USERS.jordan.id });
    expect(res.body.data.id).not.toBe(ids.square);
    const dupClient = await request(app).post(`/api/v1/image-presets/${clientAId}/duplicate`).set(A);
    expect(dupClient.body.data).toMatchObject({ clientId: ids.clientA, scope: 'client' });
  });

  it('archives and restores, with includeArchived filters and default-preset fallback', async () => {
    await db.query('update public.ai_workspace_settings set default_image_preset_id = $1', [clientAId]);
    const arch = await request(app).post(`/api/v1/image-presets/${clientAId}/archive`).set(A);
    expect(arch.status).toBe(200);
    expect(arch.body.data.archived).toBe(true);
    const { rows } = await db.query('select default_image_preset_id from public.ai_workspace_settings');
    expect(rows[0].default_image_preset_id).toBe(ids.square);

    const names = async (qs) => (await request(app).get(`/api/v1/image-presets${qs}`).set(A)).body.data.map((p) => p.id);
    expect(await names('')).not.toContain(clientAId);
    expect(await names('?includeArchived=true')).toContain(clientAId);
    expect(await names('?includeArchived=only')).toEqual([clientAId]);
    expect(await names(`?forClientId=${ids.clientA}`)).not.toContain(clientAId);

    const restored = await request(app).post(`/api/v1/image-presets/${clientAId}/restore`).set(A);
    expect(restored.body.data.archived).toBe(false);
    const acts = await db.query(`select description from public.ai_workspace_activity_logs where resource_id = $1 order by created_at`, [clientAId]);
    expect(acts.rows.map((r) => r.description)).toEqual(expect.arrayContaining(['Archived image preset “Alpha banner”', 'Restored image preset “Alpha banner”']));
  });

  it('gets one preset and rejects non-members', async () => {
    const res = await request(app).get(`/api/v1/image-presets/${ids.square}`).set(A);
    expect(res.status).toBe(200);
    expect(res.body.data.aspectRatio).toBe('1:1');
    expect((await request(app).get('/api/v1/image-presets').set(authHeader(USERS.outsider))).status).toBe(403);
    expect((await request(app).post('/api/v1/image-presets').set(authHeader(USERS.inactive)).send(base)).status).toBe(403);
  });
});
