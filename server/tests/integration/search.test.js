import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, authHeader, USERS } from '../helpers/testApp.js';

let app;
let db;
const A = authHeader(USERS.amelia);
const ids = {};

async function seed() {
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  ids.clientA = await one(`insert into public.ai_workspace_clients (name, slug, industry, description) values ('Alpha Marine', 'alpha-marine', 'Boating', 'Yacht club running the annual regatta series.') returning id`);
  ids.clientB = await one(`insert into public.ai_workspace_clients (name, slug, industry) values ('O''Brien Boats', 'obrien-boats', 'Retail') returning id`);
  ids.clientOld = await one(`insert into public.ai_workspace_clients (name, slug, updated_at) values ('Ancient Regatta Co', 'ancient-regatta', now() - interval '60 days') returning id`);
  ids.jobA = await one(`insert into public.ai_workspace_jobs (client_id, title, description) values ($1, 'Cup 2026', 'Social campaign for the regatta weekend') returning id`, [ids.clientA]);
  ids.jobB = await one(`insert into public.ai_workspace_jobs (client_id, title) values ($1, 'Spring 50% sale') returning id`, [ids.clientB]);
  ids.taskA = await one(`insert into public.ai_workspace_tasks (client_id, job_id, title, task_type, description) values ($1, $2, 'Regatta poster', 'image_creation', 'Portrait poster') returning id`, [ids.clientA, ids.jobA]);
  ids.taskB = await one(`insert into public.ai_workspace_tasks (client_id, job_id, title, task_type) values ($1, $2, 'Sale emails', 'writing_editing') returning id`, [ids.clientB, ids.jobB]);
  ids.conv = await one(`insert into public.ai_workspace_conversations (client_id, job_id, task_id, title) values ($1, $2, $3, 'Poster brainstorm') returning id`, [ids.clientA, ids.jobA, ids.taskA]);
  await db.query(
    `insert into public.ai_workspace_messages (conversation_id, role, content, message_type) values
      ($1, 'system', 'hidden sysprompttoken instructions', 'prompt'),
      ($1, 'user', 'Please mention the **spinnaker** parade at noon', 'prompt')`,
    [ids.conv],
  );
  ids.refFile = await one(
    `insert into public.ai_workspace_files (client_id, job_id, task_id, file_name, description, mime_type, file_category, source_type)
     values ($1, $2, $3, 'regatta-brief.pdf', 'Sponsor brief', 'application/pdf', 'document', 'reference') returning id`,
    [ids.clientA, ids.jobA, ids.taskA],
  );
  // Output with approved v1 and a newer draft v2
  ids.output = await one(
    `insert into public.ai_workspace_outputs (client_id, job_id, task_id, conversation_id, tool_type, output_kind, output_type, title)
     values ($1, $2, $3, $4, 'writing_editing', 'text', 'email', 'Launch email') returning id`,
    [ids.clientA, ids.jobA, ids.taskA, ids.conv],
  );
  ids.v1 = await one(
    `insert into public.ai_workspace_output_versions (output_id, task_id, output_type, title, version_number, content, approval_status, approved_at)
     values ($1, $2, 'email', 'Launch email', 1, 'Join the championship flotilla this weekend', 'approved', now()) returning id`,
    [ids.output, ids.taskA],
  );
  ids.v2 = await one(
    `insert into public.ai_workspace_output_versions (output_id, task_id, output_type, title, version_number, content)
     values ($1, $2, 'email', 'Launch email', 2, 'Draft mentions the zeppelin flyover') returning id`,
    [ids.output, ids.taskA],
  );
  ids.outFile = await one(
    `insert into public.ai_workspace_files (client_id, job_id, task_id, output_id, file_name, mime_type, file_category, source_type, approval_status)
     values ($1, $2, $3, $4, 'launch-email.txt', 'text/plain', 'text', 'generated', 'approved') returning id`,
    [ids.clientA, ids.jobA, ids.taskA, ids.output],
  );
  await db.query(`update public.ai_workspace_outputs set current_version_id = $2, approved_version_id = $3, file_id = $4 where id = $1`, [ids.output, ids.v2, ids.v1, ids.outFile]);
}

beforeAll(async () => {
  ({ app, db } = await createTestContext());
  await seed();
});

const search = (qs, user = USERS.amelia) => request(app).get(`/api/v1/search?${qs}`).set(authHeader(user));
const idsOf = (list) => list.map((r) => r.id);

describe('search', () => {
  it('returns empty groups for an empty query', async () => {
    const res = await search('q=');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ clients: [], jobs: [], tasks: [], conversations: [], files: [], approved: [] });
  });

  it('finds clients, jobs, tasks, files and approved content for a full word', async () => {
    const { body } = await search('q=regatta');
    expect(idsOf(body.data.clients)).toEqual(expect.arrayContaining([ids.clientA, ids.clientOld]));
    expect(body.data.clients.find((c) => c.id === ids.clientA)).toMatchObject({ type: 'client', clientId: ids.clientA, title: 'Alpha Marine', breadcrumb: 'Boating', href: `/clients/${ids.clientA}`, status: 'active' });
    expect(body.data.clients.find((c) => c.id === ids.clientA).excerpt).toContain('regatta');
    expect(body.data.jobs[0]).toMatchObject({ type: 'job', id: ids.jobA, clientId: ids.clientA, breadcrumb: 'Alpha Marine', href: `/jobs/${ids.jobA}` });
    expect(body.data.tasks[0]).toMatchObject({ type: 'task', id: ids.taskA, jobId: ids.jobA, breadcrumb: 'Alpha Marine / Cup 2026', kind: 'image', href: `/tasks/${ids.taskA}` });
    expect(body.data.files[0]).toMatchObject({ type: 'file', id: ids.refFile, kind: 'document', status: 'reference', href: `/files/${ids.refFile}`, breadcrumb: 'Alpha Marine / Cup 2026 / Regatta poster' });
  });

  it('matches partial words (prefix) and conversation messages, never system messages', async () => {
    const partial = await search('q=alph');
    expect(idsOf(partial.body.data.clients)).toEqual([ids.clientA]);
    const conv = await search('q=spinnaker');
    expect(conv.body.data.conversations).toHaveLength(1);
    expect(conv.body.data.conversations[0]).toMatchObject({
      type: 'conversation',
      id: ids.conv,
      taskId: ids.taskA,
      title: 'Poster brainstorm',
      href: `/ai-workspace/${ids.taskA}?conversation=${ids.conv}`,
      breadcrumb: 'Alpha Marine / Cup 2026 / Regatta poster',
    });
    expect(conv.body.data.conversations[0].excerpt).toContain('spinnaker parade');
    expect(conv.body.data.conversations[0].excerpt).not.toContain('**');
    const sys = await search('q=sysprompttoken');
    expect(sys.body.data.conversations).toEqual([]);
    const byTitle = await search('q=brainstorm');
    expect(idsOf(byTitle.body.data.conversations)).toEqual([ids.conv]);
  });

  it('searches only the APPROVED version for approved outputs', async () => {
    const approved = await search('q=championship');
    expect(approved.body.data.approved).toHaveLength(1);
    expect(approved.body.data.approved[0]).toMatchObject({ type: 'approved', id: ids.output, title: 'Launch email · v1', status: 'approved', kind: 'text', href: `/files/${ids.outFile}` });
    expect(approved.body.data.approved[0].excerpt).toContain('championship');

    const draftOnly = await search('q=zeppelin');
    expect(draftOnly.body.data.approved).toEqual([]);
    // the file group searches the current (draft) version text
    expect(draftOnly.body.data.files[0]).toMatchObject({ id: ids.outFile, status: 'approved', kind: 'text' });
    expect(draftOnly.body.data.files[0].excerpt).toContain('zeppelin');
  });

  it('filters narrow results', async () => {
    const byClient = await search(`q=regatta&clientId=${ids.clientB}`);
    expect(byClient.body.data.clients).toEqual([]);
    expect(byClient.body.data.jobs).toEqual([]);

    const byTask = await search(`q=regatta&taskId=${ids.taskA}`);
    expect(byTask.body.data.clients).toEqual([]);
    expect(byTask.body.data.jobs).toEqual([]);
    expect(idsOf(byTask.body.data.tasks)).toEqual([ids.taskA]);

    const recent = await search('q=regatta&dateRange=30d');
    expect(idsOf(recent.body.data.clients)).toEqual([ids.clientA]);

    const docs = await search('q=regatta&fileKind=document');
    expect(docs.body.data.clients).toEqual([]);
    expect(docs.body.data.tasks).toEqual([]);
    expect(idsOf(docs.body.data.files)).toEqual([ids.refFile]);
    expect((await search('q=regatta&fileKind=image')).body.data.files).toEqual([]);
    expect((await search('q=launch&approval=draft')).body.data.approved).toEqual([]);
    expect(idsOf((await search('q=launch&approval=approved')).body.data.files)).toEqual([ids.outFile]);

    const onlyJobs = await search('q=regatta&type=jobs');
    expect(onlyJobs.body.data.clients).toEqual([]);
    expect(idsOf(onlyJobs.body.data.jobs)).toEqual([ids.jobA]);

    const limited = await search('q=regatta&limit=1');
    expect(limited.body.data.clients).toHaveLength(1);
    expect((await search('q=regatta&limit=26')).status).toBe(400);
    expect((await search('q=regatta&clientId=nope')).status).toBe(400);
  });

  it('treats % _ \\ and quotes as literal, safe input', async () => {
    // LIKE metacharacters never act as wildcards
    const onlyPct = await search(`q=${encodeURIComponent('%')}`);
    expect(idsOf(onlyPct.body.data.jobs)).toEqual([ids.jobB]); // only the title containing a literal %
    expect(onlyPct.body.data.clients).toEqual([]);
    for (const q of ['_', '\\', '%%_%']) {
      const res = await search(`q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ clients: [], jobs: [], tasks: [], conversations: [], files: [], approved: [] });
    }
    // quotes / tsquery operators / markup are handled as plain text
    for (const q of ["'", "'; drop table public.ai_workspace_clients; --", 'a & b | !c :*', '"unbalanced', '<b>x</b>']) {
      expect((await search(`q=${encodeURIComponent(q)}`)).status).toBe(200);
    }
    const pct = await search(`q=${encodeURIComponent('50%')}`);
    expect(idsOf(pct.body.data.jobs)).toEqual([ids.jobB]);
    const quote = await search(`q=${encodeURIComponent("O'Brien")}`);
    expect(idsOf(quote.body.data.clients)).toEqual([ids.clientB]);
    const { rows } = await db.query('select count(*)::int as n from public.ai_workspace_clients');
    expect(rows[0].n).toBe(3);
  });

  it('suggestions return up to 8 mixed titles', async () => {
    const res = await request(app).get('/api/v1/search/suggestions?q=regatta').set(A);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.length).toBeLessThanOrEqual(8);
    expect(res.body.data[0].title.toLowerCase().startsWith('regatta')).toBe(true);
    expect(new Set(res.body.data.map((r) => r.type)).size).toBeGreaterThan(1);
    expect((await request(app).get('/api/v1/search/suggestions?q=').set(A)).body.data).toEqual([]);
  });

  it('rejects outsiders and inactive members', async () => {
    expect((await search('q=regatta', USERS.outsider)).status).toBe(403);
    expect((await search('q=regatta', USERS.inactive)).status).toBe(403);
    expect((await request(app).get('/api/v1/search?q=regatta')).status).toBe(401);
  });
});
