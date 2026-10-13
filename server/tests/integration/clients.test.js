import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';

let app;
let db;
const api = (method, path, user = USERS.amelia) => request(app)[method](`/api/v1${path}`).set(authHeader(user));

async function insertFile(clientId, { name = 'logo.png', mime = 'image/png', category = 'image', source = 'logo' } = {}) {
  const { rows } = await db.query(
    `insert into public.ai_workspace_files (client_id, file_name, mime_type, file_category, source_type, file_size_bytes, storage_path)
     values ($1, $2, $3, $4, $5, 2048, $6) returning id`,
    [clientId, name, mime, category, source, `clients/${clientId}/${Math.random().toString(36).slice(2)}/${name}`],
  );
  return rows[0].id;
}

let acme;
let globex;

beforeAll(async () => {
  ({ app, db } = await createTestContext());
  const a = await api('post', '/clients').send({ name: 'Acme Motors', slug: 'acme', industry: 'Automotive', email: 'hi@acme.test', phone: '+61 400 000 000', website: 'acme.test', address: '1 Main St' });
  acme = a.body.data;
  const g = await api('post', '/clients').send({ name: 'Globex 100% Fresh', industry: 'Food' });
  globex = g.body.data;
});

describe('clients: create', () => {
  it('creates a client with brand defaults copied from contact details', () => {
    expect(acme).toMatchObject({
      name: 'Acme Motors',
      slug: 'acme',
      status: 'active',
      email: 'hi@acme.test',
      address: '1 Main St',
      createdBy: USERS.amelia.id,
      jobCount: 0,
      draftCount: 0,
      createdByUser: { id: USERS.amelia.id },
    });
    expect(acme.brand).toMatchObject({
      businessName: 'Acme Motors',
      phone: '+61 400 000 000',
      email: 'hi@acme.test',
      website: 'acme.test',
      address: '1 Main St',
      tone: 'Professional',
      spelling: 'British English',
      primaryColor: '#6257E8',
      logoFileId: null,
    });
  });

  it('derives a slug from the name when none is given', () => {
    expect(globex.slug).toBe('globex-100-fresh');
  });

  it('rejects a duplicate slug with 409 and a clear message', async () => {
    const res = await api('post', '/clients').send({ name: 'Acme Two', slug: 'acme' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/already uses this identifier/) });
  });

  it('returns 400 VALIDATION_ERROR with details for invalid input', async () => {
    const res = await api('post', '/clients').send({ name: 'A', slug: 'Bad Slug!', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'slug', 'email']));
  });

  it('ignores fields that are not whitelisted (no mass assignment)', async () => {
    const res = await api('post', '/clients').send({ name: 'Initech', createdBy: USERS.jordan.id, id: '99999999-9999-4999-8999-999999999999' });
    expect(res.status).toBe(201);
    expect(res.body.data.createdBy).toBe(USERS.amelia.id);
    expect(res.body.data.id).not.toBe('99999999-9999-4999-8999-999999999999');
  });
});

describe('clients: read and update', () => {
  it('gets one client and 404s for unknown ids', async () => {
    expect((await api('get', `/clients/${acme.id}`)).body.data.name).toBe('Acme Motors');
    const missing = await api('get', '/clients/99999999-9999-4999-8999-999999999999');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect((await api('get', '/clients/not-a-uuid')).status).toBe(400);
  });

  it('patches whitelisted fields only', async () => {
    const res = await api('patch', `/clients/${acme.id}`).send({ industry: 'Car dealership', notes: 'VIP', createdBy: USERS.sam.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ industry: 'Car dealership', notes: 'VIP', createdBy: USERS.amelia.id });
  });

  it('rejects renaming the slug to one in use', async () => {
    const res = await api('patch', `/clients/${globex.id}`).send({ slug: 'acme' });
    expect(res.status).toBe(409);
  });

  it('rejects an empty patch', async () => {
    expect((await api('patch', `/clients/${acme.id}`).send({})).status).toBe(400);
  });
});

describe('clients: brand profile', () => {
  it('reads and partially updates the brand, merging writing preferences', async () => {
    const res = await api('patch', `/clients/${acme.id}/brand`).send({ primaryColor: '#112233', tone: 'Warm', warranty: '3 years' });
    expect(res.status).toBe(200);
    const brand = (await api('get', `/clients/${acme.id}/brand`)).body.data;
    expect(brand).toMatchObject({ primaryColor: '#112233', tone: 'Warm', spelling: 'British English', warranty: '3 years' });
  });

  it('rejects invalid colours', async () => {
    const res = await api('patch', `/clients/${acme.id}/brand`).send({ accentColor: 'red' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('accentColor');
  });

  it('only accepts a logo that is an image file of the same client', async () => {
    const foreignLogo = await insertFile(globex.id);
    const ownPdf = await insertFile(acme.id, { name: 'guide.pdf', mime: 'application/pdf', category: 'document', source: 'reference' });
    const ownLogo = await insertFile(acme.id);

    const cross = await api('patch', `/clients/${acme.id}/brand`).send({ logoFileId: foreignLogo });
    expect(cross.status).toBe(400);
    expect(cross.body.error.message).toMatch(/belongs to this client/);
    expect((await api('patch', `/clients/${acme.id}/brand`).send({ logoFileId: ownPdf })).status).toBe(400);

    const okRes = await api('patch', `/clients/${acme.id}/brand`).send({ logoFileId: ownLogo });
    expect(okRes.status).toBe(200);
    expect(okRes.body.data.brand.logoFileId).toBe(ownLogo);
    // the other client was not touched
    expect((await api('get', `/clients/${globex.id}`)).body.data.brand.logoFileId).toBeNull();
  });

  it('lists reference files of the client only, excluding generated files', async () => {
    await insertFile(acme.id, { name: 'out.png', source: 'generated' });
    const res = await api('get', `/clients/${acme.id}/reference-files`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((f) => f.clientId === acme.id && f.category !== 'output')).toBe(true);
    expect(res.body.data.map((f) => f.name).sort()).toEqual(['guide.pdf', 'logo.png']);
    expect(res.body.data[0]).toMatchObject({ storage: 'supabase', size: 2048, client: { id: acme.id }, status: null });
    expect(res.body.meta).toMatchObject({ page: 1, total: 2 });
  });
});

describe('clients: list', () => {
  it('searches name/industry/slug with literal wildcards', async () => {
    const pct = await api('get', '/clients').query({ search: '100%' });
    expect(pct.body.data.map((c) => c.id)).toEqual([globex.id]);
    const all = await api('get', '/clients').query({ search: '%' });
    expect(all.body.data.map((c) => c.id)).toEqual([globex.id]);
    const industry = await api('get', '/clients').query({ search: 'dealership' });
    expect(industry.body.data.map((c) => c.id)).toEqual([acme.id]);
  });

  it('paginates with correct meta', async () => {
    const res = await api('get', '/clients').query({ sort: 'name', limit: 2, page: 2 });
    expect(res.body.meta).toEqual({ page: 2, limit: 2, total: 3, pages: 2 });
    expect(res.body.data).toHaveLength(1);
    const first = await api('get', '/clients').query({ sort: 'name', limit: 2 });
    expect(first.body.data.map((c) => c.name)).toEqual(['Acme Motors', 'Globex 100% Fresh']);
  });

  it('returns the full filtered list when no page or limit is sent', async () => {
    const res = await api('get', '/clients');
    expect(res.body.meta).toEqual({ page: 1, limit: 200, total: 3, pages: 1 });
    expect(res.body.data).toHaveLength(3);
  });

  it('rejects unknown sort values', async () => {
    expect((await api('get', '/clients').query({ sort: 'drop table' })).status).toBe(400);
  });
});

describe('clients: archive, restore, deletion impact', () => {
  it('reports deletion impact and archives instead of deleting', async () => {
    const impact = await api('get', `/clients/${acme.id}/deletion-impact`);
    expect(impact.body.data).toMatchObject({ jobs: 0, tasks: 0, files: 3, outputs: 0, hasWork: true, strategy: 'archive' });
    const del = await api('delete', `/clients/${acme.id}`);
    expect(del.body.data).toEqual({ id: acme.id, result: 'archived' });
  });

  it('excludes archived clients from the default list but keeps them retrievable', async () => {
    const ids = (await api('get', '/clients')).body.data.map((c) => c.id);
    expect(ids).not.toContain(acme.id);
    expect((await api('get', '/clients').query({ status: 'archived' })).body.data.map((c) => c.id)).toEqual([acme.id]);
    expect((await api('get', '/clients').query({ includeArchived: 'true' })).body.data).toHaveLength(3);
    expect((await api('get', '/clients').query({ status: 'all' })).body.data).toHaveLength(3);
    const one = await api('get', `/clients/${acme.id}`);
    expect(one.body.data).toMatchObject({ status: 'archived', archivedAt: expect.any(String) });
  });

  it('restores an archived client', async () => {
    const res = await api('post', `/clients/${acme.id}/restore`);
    expect(res.body.data).toMatchObject({ status: 'active', archivedAt: null });
    const again = await api('post', `/clients/${acme.id}/archive`);
    expect(again.body.data.status).toBe('archived');
    await api('post', `/clients/${acme.id}/restore`);
  });

  it('records activity for every change', async () => {
    const res = await api('get', `/clients/${acme.id}/activity`);
    const types = res.body.data.map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(['client_created', 'client_updated', 'brand_updated', 'client_archived']));
    expect(res.body.data.every((a) => a.clientId === acme.id)).toBe(true);
    expect(res.body.data[0]).toMatchObject({ user: { id: USERS.amelia.id }, client: { id: acme.id }, resourceExists: true });
  });
});
