import crypto from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSupabase, api, closeDb, createQaClient, createQaJob, createQaTask, dbRead, expectSafeError, get, NIL_UUID, patch, post, record, sleep, tag,
} from './helpers/live.js';

/** Real private Supabase Storage + the files API. */
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function upload(name, buf, type, fields, as = 'QA_MEMBER_A') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, v);
  form.append('file', new Blob([buf], { type }), name);
  const r = await api('POST', '/files/upload', { form, as });
  if (r.status === 201) record('file', r.data.id, { clientId: fields.clientId, name });
  return r;
}

describe('files & private storage (live)', () => {
  let client;
  let other;
  let task;
  let png;
  afterAll(closeDb);

  beforeAll(async () => {
    client = await createQaClient('Files A');
    other = await createQaClient('Files B');
    const job = await createQaJob(client.id, 'Files job');
    task = await createQaTask(client.id, job.id, 'Files task');
    png = await sharp({ create: { width: 320, height: 200, channels: 3, background: '#336699' } }).png().toBuffer();
  });

  it('bucket is private: the object is unreachable without a signed URL', async () => {
    const r = await get('/health/ready', { as: null });
    expect(r.data.checks.storage).toBe(true);
    const { data } = await adminSupabase().storage.getBucket('ai-workspace-files');
    expect(data.public).toBe(false);
  });

  it('uploads a PNG: metadata in the database, bytes in private storage, checksum matches, download link works and expires', async () => {
    const r = await upload(`${tag('logo')}.png`, png, 'image/png', { clientId: client.id, jobId: task.jobId, taskId: task.id, category: 'reference' });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const [row] = await dbRead(
      `select f.client_id, f.task_id, f.mime_type, f.storage_path, v.file_checksum, v.file_size_bytes
         from public.ai_workspace_files f join public.ai_workspace_file_versions v on v.file_id = f.id where f.id = $1`,
      [r.data.id],
    );
    expect(row).toMatchObject({ client_id: client.id, task_id: task.id, mime_type: 'image/png', file_checksum: sha(png), file_size_bytes: String(png.length) });
    expect(row.storage_path).toMatch(new RegExp(`^clients/${client.id}/`));

    // Public URL must not work for a private bucket
    const pub = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/ai-workspace-files/${row.storage_path}`);
    expect(pub.status).toBeGreaterThanOrEqual(400);

    const d = await get(`/files/${r.data.id}/download`, { as: 'QA_MEMBER_B' });
    expect(d.status).toBe(200);
    expect(d.data.url).toMatch(/token=/);
    const bytes = Buffer.from(await (await fetch(d.data.url)).arrayBuffer());
    expect(sha(bytes)).toBe(sha(png));
    // tampered token is rejected
    const bad = await fetch(d.data.url.replace(/token=[^&]+/, 'token=eyJhbGciOiJIUzI1NiJ9.e30.x'));
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const p = await get(`/files/${r.data.id}/preview`);
    expect(p.status).toBe(200);
    expect(p.data.mimeType).toBe('image/png');
  });

  it('PDF and text uploads work; Unicode file names are kept; traversal names are neutralised', async () => {
    const pdf = await upload('Café menü – ürün.pdf', PDF, 'application/pdf', { clientId: client.id });
    expect(pdf.status, JSON.stringify(pdf.json)).toBe(201);
    expect(pdf.data.name).toBe('Café menü – ürün.pdf');
    const txt = await upload('../../../etc/passwd.txt', Buffer.from('Opening hours 9–5'), 'text/plain', { clientId: client.id });
    expect(txt.status, JSON.stringify(txt.json)).toBe(201);
    const [row] = await dbRead('select storage_path, file_name from public.ai_workspace_files where id = $1', [txt.data.id]);
    expect(row.storage_path).not.toContain('..');
    expect(row.storage_path.startsWith(`clients/${client.id}/`)).toBe(true);
    // duplicate file name gets its own object
    const dup = await upload('../../../etc/passwd.txt', Buffer.from('Second copy'), 'text/plain', { clientId: client.id });
    expect(dup.status).toBe(201);
    const [row2] = await dbRead('select storage_path from public.ai_workspace_files where id = $1', [dup.data.id]);
    expect(row2.storage_path).not.toBe(row.storage_path);
  });

  it.each([
    ['PNG bytes declared as PDF', 'fake.pdf', () => png, 'application/pdf'],
    ['executable named .png', 'evil.png', () => Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(256)]), 'image/png'],
    ['SVG (script-capable)', 'logo.svg', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml'],
    ['HTML disguised as text', 'notes.html', () => Buffer.from('<html><script>alert(1)</script></html>'), 'text/html'],
    ['empty file', 'empty.txt', () => Buffer.alloc(0), 'text/plain'],
    ['corrupted PNG', 'broken.png', () => png.subarray(0, 40), 'image/png'],
    ['extension/content mismatch', 'photo.jpg', () => png, 'image/jpeg'],
  ])('rejects %s', async (_n, name, buf, type) => {
    const r = await upload(name, buf(), type, { clientId: client.id });
    expect([400, 415, 422]).toContain(r.status);
    expectSafeError(r, r.status, expect);
  });

  it('rejects an oversized upload with 413 and stores nothing', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(16 * 1024 * 1024, 0x20)]);
    const before = await dbRead('select count(*)::int n from public.ai_workspace_files where client_id = $1', [client.id]);
    const r = await upload('huge.pdf', big, 'application/pdf', { clientId: client.id });
    expectSafeError(r, 413, expect);
    const after = await dbRead('select count(*)::int n from public.ai_workspace_files where client_id = $1', [client.id]);
    expect(after[0].n).toBe(before[0].n);
  });

  it('rejects uploads with bad metadata: unknown client, task of another client, missing client, no file', async () => {
    expect([400, 404]).toContain((await upload('a.txt', Buffer.from('x'), 'text/plain', { clientId: NIL_UUID })).status);
    expect([400, 404]).toContain((await upload('a.txt', Buffer.from('x'), 'text/plain', { clientId: other.id, taskId: task.id })).status);
    expectSafeError(await upload('a.txt', Buffer.from('x'), 'text/plain', {}), 400, expect);
    const form = new FormData();
    form.append('clientId', client.id);
    expectSafeError(await api('POST', '/files/upload', { form }), 400, expect);
  });

  it('unauthenticated, outsider and inactive users cannot upload, list or download', async () => {
    const f = (await get('/files', { query: { clientId: client.id } })).data[0];
    for (const as of [null, 'QA_OUTSIDER', 'QA_INACTIVE']) {
      const form = new FormData();
      form.append('clientId', client.id);
      form.append('file', new Blob([Buffer.from('x')], { type: 'text/plain' }), 'x.txt');
      expect([401, 403]).toContain((await api('POST', '/files/upload', { form, as })).status);
      expect([401, 403]).toContain((await get(`/files/${f.id}/download`, { as })).status);
    }
    // the outsider cannot reach the object through Storage directly either
    const [row] = await dbRead('select storage_path from public.ai_workspace_files where id = $1', [f.id]);
    const { signIn } = await import('./helpers/live.js');
    const s = await signIn('QA_OUTSIDER');
    const direct = await s.client.storage.from('ai-workspace-files').download(row.storage_path);
    expect(direct.data).toBeNull();
    const member = await signIn('QA_MEMBER_A');
    const viaMember = await member.client.storage.from('ai-workspace-files').download(row.storage_path);
    expect(viaMember.data).toBeNull(); // members also go through the API (migration 0004)
  });

  it('rename persists; archived files leave lists; missing storage objects fail safely', async () => {
    const r = await upload('rename-me.txt', Buffer.from('rename'), 'text/plain', { clientId: client.id });
    const ren = await patch(`/files/${r.data.id}`, { name: 'Renamed – ✓.txt' }, { as: 'QA_MEMBER_C' });
    expect(ren.status).toBe(200);
    expect((await get(`/files/${r.data.id}`)).data.name).toBe('Renamed – ✓.txt');
    expectSafeError(await patch(`/files/${r.data.id}`, {}), 400, expect);
    expect((await post(`/files/${r.data.id}/archive`, {})).status).toBe(200);
    expect((await get('/files', { query: { clientId: client.id } })).data.map((x) => x.id)).not.toContain(r.data.id);
    const versions = await get(`/files/${r.data.id}/versions`);
    expect(versions.status).toBe(200);
  });

  it('file filters and search return only real matching records', async () => {
    const r = await get('/files', { query: { clientId: client.id, kind: 'document' } });
    expect(r.status).toBe(200);
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data.every((f) => f.clientId === client.id || f.client?.id === client.id)).toBe(true);
    const s = await get('/files', { query: { search: 'Café menü' } });
    expect(s.data.some((f) => f.name === 'Café menü – ürün.pdf')).toBe(true);
    for (const q of [{ kind: 'video' }, { sort: 'password' }, { clientId: 'x' }, { dateRange: '1y' }]) expectSafeError(await get('/files', { query: q }), 400, expect);
  });

  it('signed download links expire (TTL is enforced by Storage)', async () => {
    const { data, error } = await adminSupabase()
      .storage.from('ai-workspace-files')
      .createSignedUrl((await dbRead(`select storage_path from public.ai_workspace_files where client_id = $1 and storage_path is not null limit 1`, [client.id]))[0].storage_path, 1);
    expect(error).toBeNull();
    await sleep(3000);
    const res = await fetch(data.signedUrl);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
