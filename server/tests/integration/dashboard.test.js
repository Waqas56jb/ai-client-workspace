import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';

let app;
let db;
let storage;
let clientA;
const api = (method, path, user = USERS.amelia) => request(app)[method](`/api/v1${path}`).set(authHeader(user));
const body = (res) => res.body.data;

beforeAll(async () => {
  ({ app, db, storage } = await createTestContext());
  const a = body(await api('post', '/clients').send({ name: 'Alpha Co', slug: 'alpha' }));
  clientA = a;
  const b = body(await api('post', '/clients').send({ name: 'Beta Co', slug: 'beta' }));
  await api('post', `/clients/${b.id}/archive`);
  const job = body(await api('post', '/jobs').send({ clientId: a.id, title: 'Launch' }));
  await api('post', '/jobs').send({ clientId: a.id, title: 'Paused', status: 'on_hold' });
  await api('post', '/tasks').send({ clientId: a.id, jobId: job.id, title: 'Open task', type: 'writing', status: 'review' });
  const done = body(await api('post', '/tasks').send({ clientId: a.id, jobId: job.id, title: 'Done task', type: 'writing', status: 'done' }));

  // One draft output, and one approved output with a newer draft revision.
  const output = async ({ approve, revise }) => {
    const { rows: [o] } = await db.query(
      `insert into public.ai_workspace_outputs (client_id, job_id, task_id, tool_type, output_kind, output_type, title)
       values ($1, $2, $3, 'writing_editing', 'text', 'email', 'Email') returning id`,
      [a.id, job.id, done.id],
    );
    const version = async (n, approved) =>
      (
        await db.query(
          `insert into public.ai_workspace_output_versions (output_id, task_id, output_type, title, version_number, content, approval_status, approved_at)
           values ($1, $2, 'email', 'Email', $3, 'x', $4, $5) returning id`,
          [o.id, done.id, n, approved ? 'approved' : 'draft', approved ? new Date() : null],
        )
      ).rows[0].id;
    const v1 = await version(1, approve);
    const current = revise ? await version(2, false) : v1;
    await db.query('update public.ai_workspace_outputs set current_version_id = $2, approved_version_id = $3 where id = $1', [o.id, current, approve ? v1 : null]);
    await db.query(
      `insert into public.ai_workspace_files (client_id, job_id, task_id, output_id, file_name, mime_type, file_category, source_type)
       values ($1, $2, $3, $4, 'email.txt', 'text/plain', 'text', 'generated')`,
      [a.id, job.id, done.id, o.id],
    );
  };
  await output({ approve: false, revise: false });
  await output({ approve: true, revise: true });
});

describe('dashboard', () => {
  it('summarises real rows', async () => {
    const res = await api('get', '/dashboard/summary');
    expect(res.status).toBe(200);
    const { metrics, chart, recentJobs, recentFiles } = body(res);
    expect(metrics).toEqual({
      clients: { value: 1, hint: '1 added in 30 days' }, // archived clients are not counted (QA bug #4)
      activeJobs: { value: 1, hint: '1 on hold' },
      openTasks: { value: 1, hint: '1 in review' },
      files: { value: 2, hint: '2 generated this week' },
      drafts: { value: 2, hint: '1 revisions of approved work' },
      approved: { value: 1, hint: '1 approved this week' },
    });
    expect(chart).toHaveLength(14);
    expect(chart[13]).toMatchObject({ generated: 3, approved: 1 });
    expect(chart[13].date).toBe(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    expect(chart.slice(0, 13).every((d) => d.generated === 0 && d.approved === 0)).toBe(true);
    expect(recentJobs.map((j) => j.title)).toEqual(['Launch', 'Paused']);
    expect(recentJobs[0]).toMatchObject({ client: { name: 'Alpha Co' }, taskCount: 2, draftCount: 2, approvedCount: 1 });
    expect(recentFiles).toHaveLength(2);
    const statuses = recentFiles.map((f) => `${f.status}:${f.pendingRevision}`).sort();
    expect(statuses).toEqual(['approved:true', 'draft:false']);
    expect(recentFiles[0]).toMatchObject({
      category: 'output',
      client: { name: 'Alpha Co' },
      previewUrl: null,
      output: { tool: 'writing', currentVersion: { content: 'x', versionNumber: expect.any(Number), contentTruncated: false } },
    });
  });

  it('signs preview URLs for image files that exist in storage', async () => {
    const path = `clients/${clientA.id}/reference/hero.png`;
    storage.objects.set(path, { buf: Buffer.from('png'), contentType: 'image/png' });
    await db.query(
      `insert into public.ai_workspace_files (client_id, file_name, mime_type, file_category, source_type, storage_path)
       values ($1, 'hero.png', 'image/png', 'image', 'reference', $2)`,
      [clientA.id, path],
    );
    const [latest] = body(await api('get', '/dashboard/recent-files').query({ limit: 1 }));
    expect(latest.name).toBe('hero.png');
    expect(latest.previewUrl).toMatch(/^https:\/\/storage\.test\/sign\/.+ttl=3600/);
    expect(JSON.stringify(latest)).not.toContain('"storagePath"');
  });

  it('serves recent activity, files and jobs with limits', async () => {
    expect(body(await api('get', '/dashboard/recent-activity').query({ limit: 3 }))).toHaveLength(3);
    expect(body(await api('get', '/dashboard/recent-files').query({ limit: 1 }))).toHaveLength(1);
    expect(body(await api('get', '/dashboard/recent-jobs')).map((j) => j.title)).toEqual(['Launch', 'Paused']);
    expect((await api('get', '/dashboard/recent-jobs').query({ limit: 500 })).status).toBe(400);
  });
});
