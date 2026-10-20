import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';

let app;
let db;
const api = (method, path, user = USERS.amelia) => request(app)[method](`/api/v1${path}`).set(authHeader(user));
const body = (res) => res.body.data;

let square;
let retired;

beforeAll(async () => {
  ({ app, db } = await createTestContext());
  const preset = async (seedKey, active) =>
    (
      await db.query(
        `insert into public.ai_workspace_image_presets (seed_key, name, width_px, height_px, is_active) values ($1, $2, 1080, 1080, $3) returning id`,
        [seedKey, `Preset ${seedKey}`, active],
      )
    ).rows[0].id;
  square = await preset('square', true);
  retired = await preset('retired', false);
});

describe('settings: workspace', () => {
  it('returns defaults before the row exists', async () => {
    const res = await api('get', '/settings/workspace');
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({
      workspaceName: 'Main Workspace',
      spelling: 'Australian English',
      defaultTone: 'Professional',
      dateFormat: 'd MMM yyyy',
      defaultFileView: 'grid',
      defaultPresetId: square,
    });
    const { rows } = await db.query('select count(*)::int as n from public.ai_workspace_settings');
    expect(rows[0].n).toBe(0);
  });

  it('creates the single row on first PATCH and merges later updates', async () => {
    const first = await api('patch', '/settings/workspace').send({ workspaceName: 'Studio', defaultFileView: 'list' });
    expect(first.status).toBe(200);
    expect(body(first)).toMatchObject({ workspaceName: 'Studio', defaultFileView: 'list', spelling: 'Australian English', defaultPresetId: square });
    const second = await api('patch', '/settings/workspace', USERS.jordan).send({ defaultTone: 'Friendly', defaultPresetId: null });
    expect(body(second)).toMatchObject({ workspaceName: 'Studio', defaultTone: 'Friendly', defaultPresetId: null });
    expect(body(await api('get', '/settings/workspace'))).toMatchObject({ workspaceName: 'Studio', defaultTone: 'Friendly' });
    const { rows } = await db.query('select id, updated_by from public.ai_workspace_settings');
    expect(rows).toEqual([{ id: 1, updated_by: USERS.jordan.id }]);
  });

  it('requires an active preset and valid values', async () => {
    const res = await api('patch', '/settings/workspace').send({ defaultPresetId: retired });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/active preset that applies to every client/);
    expect((await api('patch', '/settings/workspace').send({ defaultFileView: 'cards' })).status).toBe(400);
    expect((await api('patch', '/settings/workspace').send({})).status).toBe(400);
  });
});

describe('settings: storage', () => {
  it('reports real counts and recorded bytes without double counting versions', async () => {
    const client = body(await api('post', '/clients').send({ name: 'Alpha Co', slug: 'alpha' }));
    const { rows: [f] } = await db.query(
      `insert into public.ai_workspace_files (client_id, file_name, mime_type, file_category, source_type, file_size_bytes, storage_path)
       values ($1, 'a.png', 'image/png', 'image', 'reference', 1000, 'p/a.png') returning id`,
      [client.id],
    );
    await db.query(
      `insert into public.ai_workspace_file_versions (file_id, version_number, storage_path, file_name, mime_type, file_size_bytes, file_checksum)
       values ($1, 1, 'p/a.png', 'a.png', 'image/png', 1000, $2), ($1, 2, 'p/a-v2.png', 'a.png', 'image/png', 500, $2)`,
      [f.id, 'a'.repeat(64)],
    );
    await db.query(
      `insert into public.ai_workspace_files (client_id, file_name, mime_type, file_category, source_type, file_size_bytes, storage_path)
       values ($1, 'b.pdf', 'application/pdf', 'document', 'attachment', 250, 'p/b.pdf')`,
      [client.id],
    );
    const res = await api('get', '/settings/storage');
    expect(res.status).toBe(200);
    expect(body(res)).toEqual({
      mode: 'supabase',
      bucket: 'ai-workspace-files',
      maxUploadBytes: 5 * 1024 * 1024,
      totalBytes: 1750,
      fileCount: 2,
      byCategory: {
        reference: { count: 1, bytes: 1500 },
        attachment: { count: 1, bytes: 250 },
        output: { count: 0, bytes: 0 },
        logo: { count: 0, bytes: 0 },
      },
      byKind: { image: 1, document: 1, text: 0, other: 0 },
      counts: { clients: 1, jobs: 0, tasks: 0, conversations: 0, messages: 0, outputs: 0, versions: 0 },
    });
  });
});
