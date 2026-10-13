import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, authHeader, USERS } from '../helpers/testApp.js';

let app;
let db;
const A = authHeader(USERS.amelia);
const ids = {};

async function seed() {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0].id;
  ids.clientA = await one(`insert into public.ai_workspace_clients (name, slug, created_by) values ('Alpha Marine', 'alpha-marine', $1) returning id`, [USERS.amelia.id]);
  ids.clientB = await one(`insert into public.ai_workspace_clients (name, slug) values ('Beta Motors', 'beta-motors') returning id`);
  ids.jobA = await one(`insert into public.ai_workspace_jobs (client_id, title) values ($1, 'Cup 2026') returning id`, [ids.clientA]);
  ids.jobB = await one(`insert into public.ai_workspace_jobs (client_id, title) values ($1, 'Spring sale') returning id`, [ids.clientB]);
  ids.task = await one(`insert into public.ai_workspace_tasks (client_id, job_id, title, task_type) values ($1, $2, 'Poster copy', 'writing_editing') returning id`, [ids.clientA, ids.jobA]);
  ids.archivedTask = await one(
    `insert into public.ai_workspace_tasks (client_id, job_id, title, task_type, archived_at) values ($1, $2, 'Old task', 'general', now()) returning id`,
    [ids.clientA, ids.jobA],
  );
}

beforeAll(async () => {
  ({ app, db } = await createTestContext());
  await seed();
});

describe('conversations', () => {
  let convId;

  it('creates a conversation with scope copied from the task (body cannot override client/job)', async () => {
    const res = await request(app)
      .post(`/api/v1/tasks/${ids.task}/conversations`)
      .set(A)
      .send({ title: 'Headline ideas', tool: 'writing', clientId: ids.clientB, jobId: ids.jobB, taskId: ids.archivedTask, createdBy: USERS.sam.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ taskId: ids.task, clientId: ids.clientA, jobId: ids.jobA, title: 'Headline ideas', tool: 'writing', createdBy: USERS.amelia.id, messageCount: 0, lastMessage: null });
    expect(res.body.data.createdByUser).toMatchObject({ id: USERS.amelia.id, name: USERS.amelia.name });
    convId = res.body.data.id;
    const { rows } = await db.query('select client_id, job_id, created_by from public.ai_workspace_conversations where id = $1', [convId]);
    expect(rows[0]).toEqual({ client_id: ids.clientA, job_id: ids.jobA, created_by: USERS.amelia.id });
  });

  it('defaults the title and rejects archived / missing tasks and bad tools', async () => {
    const res = await request(app).post(`/api/v1/tasks/${ids.task}/conversations`).set(A).send({});
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ title: 'New conversation', tool: null });

    expect((await request(app).post(`/api/v1/tasks/${ids.archivedTask}/conversations`).set(A).send({ title: 'x' })).status).toBe(409);
    expect((await request(app).post('/api/v1/tasks/00000000-0000-4000-8000-000000000000/conversations').set(A).send({})).status).toBe(404);
    expect((await request(app).post(`/api/v1/tasks/${ids.task}/conversations`).set(A).send({ tool: 'video' })).status).toBe(400);
    expect((await request(app).post('/api/v1/tasks/not-a-uuid/conversations').set(A).send({})).status).toBe(400);
  });

  it('stores user notes and returns Message DTOs with the author', async () => {
    const res = await request(app).post(`/api/v1/conversations/${convId}/messages`).set(authHeader(USERS.jordan)).send({ content: 'First note about the regatta', userId: USERS.sam.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      conversationId: convId,
      taskId: ids.task,
      role: 'user',
      content: 'First note about the regatta',
      userId: USERS.jordan.id,
      tool: 'writing',
      status: 'complete',
      outputIds: [],
      attachmentIds: [],
    });
    expect(res.body.data.user).toMatchObject({ id: USERS.jordan.id });
    expect((await request(app).post(`/api/v1/conversations/${convId}/messages`).set(A).send({ content: '   ' })).status).toBe(400);
    const bad = await request(app).post(`/api/v1/conversations/${convId}/messages`).set(A).send({ content: 'hi', attachmentIds: ['00000000-0000-4000-8000-000000000000'] });
    expect(bad.status).toBe(400);
  });

  it('maps message types/metadata to status and hides system messages', async () => {
    await db.query(
      `insert into public.ai_workspace_messages (conversation_id, role, content, message_type, metadata, created_at) values
        ($1, 'system', 'SECRET SYSTEM PROMPT', 'prompt', '{}', clock_timestamp() + interval '1 ms'),
        ($1, 'assistant', 'Which format?', 'clarification', '{"options":["Email","SMS"],"generationId":"g1"}', clock_timestamp() + interval '2 ms'),
        ($1, 'assistant', 'Draft ready', 'response', '{"outputIds":["o1"],"requestMeta":{"model":"m"}}', clock_timestamp() + interval '3 ms'),
        ($1, 'assistant', 'Failed', 'error', '{}', clock_timestamp() + interval '4 ms'),
        ($1, 'assistant', 'Working', 'status', '{}', clock_timestamp() + interval '5 ms')`,
      [convId],
    );
    const res = await request(app).get(`/api/v1/conversations/${convId}`).set(A);
    expect(res.status).toBe(200);
    const msgs = res.body.data.messages;
    expect(msgs.map((m) => m.content)).toEqual(['First note about the regatta', 'Which format?', 'Draft ready', 'Failed', 'Working']);
    expect(msgs.map((m) => m.status)).toEqual(['complete', 'clarify', 'complete', 'error', 'pending']);
    expect(msgs[1]).toMatchObject({ options: ['Email', 'SMS'], generationId: 'g1', resolved: false, userId: null, user: null });
    expect(msgs[2]).toMatchObject({ outputIds: ['o1'], requestMeta: { model: 'm' } });
    expect(JSON.stringify(res.body)).not.toContain('SECRET SYSTEM PROMPT');
    expect(res.body.data.messageCount).toBe(5);
    expect(res.body.data.lastMessage).toMatchObject({ role: 'assistant', content: 'Working' });
  });

  it('paginates messages with a before cursor (oldest first within a page)', async () => {
    const { body } = await request(app).post(`/api/v1/tasks/${ids.task}/conversations`).set(A).send({ title: 'Paged' });
    const pagedId = body.data.id;
    for (let i = 1; i <= 7; i += 1) {
      const r = await request(app).post(`/api/v1/conversations/${pagedId}/messages`).set(A).send({ content: `note ${i}` });
      expect(r.status).toBe(201);
    }
    const p1 = await request(app).get(`/api/v1/conversations/${pagedId}/messages?limit=3`).set(A);
    expect(p1.status).toBe(200);
    expect(p1.body.data.map((m) => m.content)).toEqual(['note 5', 'note 6', 'note 7']);
    expect(p1.body.meta).toMatchObject({ limit: 3, hasMore: true, nextBefore: p1.body.data[0].id });

    const p2 = await request(app).get(`/api/v1/conversations/${pagedId}/messages?limit=3&before=${p1.body.meta.nextBefore}`).set(A);
    expect(p2.body.data.map((m) => m.content)).toEqual(['note 2', 'note 3', 'note 4']);
    const p3 = await request(app).get(`/api/v1/conversations/${pagedId}/messages?limit=3&before=${p2.body.meta.nextBefore}`).set(A);
    expect(p3.body.data.map((m) => m.content)).toEqual(['note 1']);
    expect(p3.body.meta).toMatchObject({ hasMore: false, nextBefore: null });

    const foreign = await request(app).get(`/api/v1/conversations/${pagedId}/messages?before=${'0b9f1c2e-7d4a-4c3b-9e8f-1a2b3c4d5e6f'}`).set(A);
    expect(foreign.status).toBe(400);
    expect((await request(app).get(`/api/v1/conversations/${pagedId}/messages?limit=500`).set(A)).status).toBe(400);
  });

  it('lists task conversations newest first', async () => {
    const res = await request(app).get(`/api/v1/tasks/${ids.task}/conversations`).set(A);
    expect(res.status).toBe(200);
    expect(res.body.data[0].title).toBe('Paged');
    expect(res.body.data[0].messageCount).toBe(7);
    const times = res.body.data.map((c) => c.updatedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('patches title/tool/archived and blocks notes on archived conversations', async () => {
    const res = await request(app).patch(`/api/v1/conversations/${convId}`).set(A).send({ title: 'Renamed', tool: 'advertising', archived: true, taskId: ids.archivedTask });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: 'Renamed', tool: 'advertising', archived: true, taskId: ids.task });
    const list = await request(app).get(`/api/v1/tasks/${ids.task}/conversations`).set(A);
    expect(list.body.data.some((c) => c.id === convId)).toBe(false);
    expect((await request(app).post(`/api/v1/conversations/${convId}/messages`).set(A).send({ content: 'late' })).status).toBe(409);
    const restored = await request(app).patch(`/api/v1/conversations/${convId}`).set(A).send({ archived: false });
    expect(restored.body.data.archived).toBe(false);
    expect((await request(app).patch(`/api/v1/conversations/${convId}`).set(A).send({})).status).toBe(400);
    expect((await request(app).get('/api/v1/conversations/00000000-0000-4000-8000-000000000000').set(A)).status).toBe(404);
  });

  it('rejects outsiders and inactive members', async () => {
    expect((await request(app).get(`/api/v1/conversations/${convId}`).set(authHeader(USERS.outsider))).status).toBe(403);
    expect((await request(app).get(`/api/v1/tasks/${ids.task}/conversations`).set(authHeader(USERS.inactive))).status).toBe(403);
    expect((await request(app).get(`/api/v1/conversations/${convId}`)).status).toBe(401);
  });
});

describe('messages repository helpers (AI module surface)', () => {
  it('insertMessage / updateMessageMetadata / listMessagesForContext / getConversationScoped', async () => {
    const adapter = (await import('../../src/config/db.js')).getDatabase();
    const repo = await import('../../src/repositories/messages.repository.js');
    const conv = (await db.query('select id from public.ai_workspace_conversations limit 1')).rows[0];
    const result = await adapter.withUser(USERS.amelia.id, async (tx) => {
      const scoped = await repo.getConversationScoped(tx, conv.id);
      await repo.insertMessage(tx, { conversationId: conv.id, role: 'system', content: 'sys', messageType: 'prompt', userId: USERS.amelia.id });
      const u = await repo.insertMessage(tx, { conversationId: conv.id, role: 'user', content: 'ctx question', messageType: 'prompt', metadata: { requestOptions: { format: 'email' } }, userId: USERS.amelia.id });
      const a = await repo.insertMessage(tx, { conversationId: conv.id, role: 'assistant', content: 'ctx answer', messageType: 'response', userId: USERS.amelia.id });
      await repo.updateMessageMetadata(tx, a.id, { outputIds: ['x'] });
      await repo.updateMessageMetadata(tx, a.id, { generationId: 'g' });
      const ctx = await repo.listMessagesForContext(tx, conv.id, 2);
      const dto = repo.toMessageDto(await repo.getMessageRow(tx, a.id));
      return { scoped, ctx, dto, u };
    });
    expect(result.scoped).toMatchObject({ id: conv.id, client_id: ids.clientA, job_id: ids.jobA, task_id: ids.task });
    expect(result.ctx.map((m) => m.content)).toEqual(['ctx question', 'ctx answer']);
    expect(result.dto).toMatchObject({ outputIds: ['x'], generationId: 'g', status: 'complete', role: 'assistant' });
  });
});
