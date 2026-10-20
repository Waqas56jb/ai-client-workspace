import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';
import { aiLimiter } from '../../src/middleware/rateLimiter.js';
import { waitForIdle } from '../../src/jobs/generationQueue.js';

/**
 * AI Assistant: chat sessions without manual job/task set-up, workspace-wide chat
 * history with date filters, and conversation memory (last 20 exchanges incl. drafts).
 */

const ids = {
  alpha: 'd0000000-0000-4000-8000-000000000001',
  beta: 'd1000000-0000-4000-8000-000000000001',
  archived: 'd2000000-0000-4000-8000-000000000001',
};
const A = authHeader(USERS.amelia);
const calls = [];
let reply = () => 'Hi Sam,\n\nThanks for your time today.\n\nKind regards,\nAlpha';
const openai = {
  responses: {
    create: async (params) => {
      calls.push(params);
      return { id: 'r', model: params.model, status: 'completed', output_text: reply(params), usage: {} };
    },
  },
  images: { generate: async () => ({ data: [] }), edit: async () => ({ data: [] }) },
};

let app;
let db;
beforeAll(async () => {
  ({ app, db } = await createTestContext({ openai }));
  await db.query(
    `insert into public.ai_workspace_clients (id, name, slug, status, archived_at) values
       ($1, 'Alpha Agency', 'alpha-agency', 'active', null), ($2, 'Beta Bakes', 'beta-bakes', 'active', null), ($3, 'Gone Ltd', 'gone-ltd', 'archived', now())`,
    [ids.alpha, ids.beta, ids.archived],
  );
});
beforeEach(() => aiLimiter.resetKey(`user:${USERS.amelia.id}`));
afterEach(() => waitForIdle());

async function poll(id) {
  for (let i = 0; i < 400; i += 1) {
    const r = await request(app).get(`/api/v1/ai/generations/${id}`).set(A);
    if (['succeeded', 'failed'].includes(r.body.data.status)) return r.body.data;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('generation did not finish');
}
const session = (clientId) => request(app).post('/api/v1/assistant/session').set(A).send({ clientId });
const write = (body) => request(app).post('/api/v1/ai/writing/generate').set(A).send(body);

describe('assistant session', () => {
  it('creates the client’s AI Assistant job + task once and reuses it (also under concurrency)', async () => {
    const [a, b] = await Promise.all([session(ids.alpha), session(ids.alpha)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data.taskId).toBe(b.body.data.taskId);
    const again = await session(ids.alpha);
    expect(again.body.data.taskId).toBe(a.body.data.taskId);
    const { rows } = await db.query(`select count(*)::int n from public.ai_workspace_tasks where client_id = $1 and title = 'AI Assistant chats'`, [ids.alpha]);
    expect(rows[0].n).toBe(1);
  });

  it('refuses unknown and archived clients and bad ids', async () => {
    expect((await session('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await session(ids.archived)).status).toBe(400);
    expect((await session('nope')).status).toBe(400);
  });
});

describe('conversation memory', () => {
  it('a follow-up sees the previous draft text and keeps the confirmed format (no second format question)', async () => {
    const { taskId } = (await session(ids.alpha)).body.data;
    const first = await write({ taskId, prompt: 'Write an email thanking Sam for the meeting', options: { format: 'email' } });
    expect(first.status).toBe(202);
    await poll(first.body.data.generationId);
    const conversationId = first.body.data.conversation.id;

    reply = () => 'Hi Sam,\n\nThanks for today.\n\nAlpha';
    const follow = await write({ taskId, conversationId, prompt: 'Make it shorter' });
    expect(follow.status).toBe(202); // not a 200 "which format?" clarification
    const run = await poll(follow.body.data.generationId);
    expect(run.status).toBe('succeeded');
    const input = calls.at(-1).input;
    expect(input).toContain('<conversation_history>');
    expect(input).toContain('Thanks for your time today.'); // the earlier DRAFT, not just the chat reply
    expect(input).toContain('Format: Email.');
  });

  it('remembers up to the last 20 exchanges (40 messages) of this conversation only', async () => {
    const { taskId } = (await session(ids.beta)).body.data;
    let conversationId;
    for (let i = 1; i <= 22; i += 1) {
      aiLimiter.resetKey(`user:${USERS.amelia.id}`); // the test config allows 5 AI requests per window
      reply = () => `Reply ${i}`;
      const r = await write({ taskId, conversationId, prompt: `Note number ${i} for the email`, options: { format: 'email' } });
      conversationId = r.body.data.conversation.id;
      await poll(r.body.data.generationId);
    }
    aiLimiter.resetKey(`user:${USERS.amelia.id}`);
    reply = () => 'final';
    const r = await write({ taskId, conversationId, prompt: 'Summarise our notes', options: { format: 'email' } });
    await poll(r.body.data.generationId);
    const input = calls.at(-1).input;
    expect(input).toContain('Note number 22');
    expect(input).toContain('Note number 3 '); // 20 exchanges back
    expect(input).not.toContain('Note number 1 ');
    expect(input).not.toContain('Thanks for your time today'); // nothing from the Alpha conversation
  });
});

describe('chat history', () => {
  it('lists conversations workspace-wide with client, job and task, newest first', async () => {
    const r = await request(app).get('/api/v1/conversations').set(A);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(2);
    const item = r.body.data[0];
    expect(item).toMatchObject({ client: { name: expect.any(String) }, job: { title: 'AI Assistant' }, task: { title: 'AI Assistant chats' } });
    expect(item.lastActivityAt).toEqual(expect.any(String));
    const times = r.body.data.map((c) => c.lastActivityAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(r.body.meta).toMatchObject({ page: 1, total: r.body.data.length });
  });

  it('filters by client, by text in any message, and by the date a message was written', async () => {
    const byClient = await request(app).get('/api/v1/conversations').query({ clientId: ids.beta }).set(A);
    expect(byClient.body.data.every((c) => c.clientId === ids.beta)).toBe(true);
    const byText = await request(app).get('/api/v1/conversations').query({ search: 'thanking Sam' }).set(A);
    expect(byText.body.data.map((c) => c.clientId)).toEqual([ids.alpha]);
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
    expect((await request(app).get('/api/v1/conversations').query({ from, to }).set(A)).body.data.length).toBeGreaterThanOrEqual(2);
    const lastYear = await request(app).get('/api/v1/conversations').query({ from: '2020-01-01T00:00:00Z', to: '2020-02-01T00:00:00Z' }).set(A);
    expect(lastYear.body.data).toEqual([]);
  });

  it('rejects bad filters and is safe for odd search text', async () => {
    for (const q of [{ from: 'yesterday' }, { clientId: 'x' }, { tool: 'poetry' }, { limit: 999 }]) {
      expect((await request(app).get('/api/v1/conversations').query(q).set(A)).status).toBe(400);
    }
    for (const search of ["'; drop table x; --", '%_%', '\\']) {
      expect((await request(app).get('/api/v1/conversations').query({ search }).set(A)).status).toBe(200);
    }
  });

  it('requires a member', async () => {
    expect((await request(app).get('/api/v1/conversations')).status).toBe(401);
    expect((await request(app).get('/api/v1/conversations').set(authHeader(USERS.outsider))).status).toBe(403);
  });
});

describe('readable titles', () => {
  it('a chat is named after its first result, skipping the greeting (no subject lines any more)', async () => {
    const { taskId } = (await session(ids.alpha)).body.data;
    aiLimiter.resetKey(`user:${USERS.amelia.id}`);
    reply = () => 'Hi Sam,\n\nYour campaign report is ready to review. Let me know a good time to talk.\n\nKind regards,\nAlpha';
    const r = await write({ taskId, prompt: 'hey can u write sam an email re the report', options: { format: 'email' } });
    const run = await poll(r.body.data.generationId);
    expect(run.outputs[0].title).toBe('Your campaign report is ready to review — email');
    const conv = (await request(app).get(`/api/v1/conversations/${r.body.data.conversation.id}`).set(A)).body.data;
    expect(conv.title).toBe('Your campaign report is ready to review');
    // a follow-up result does not rename the chat
    aiLimiter.resetKey(`user:${USERS.amelia.id}`);
    reply = () => 'Hi Sam,\n\nQuick note: the report is ready.\n\nAlpha';
    const f = await write({ taskId, conversationId: conv.id, prompt: 'shorter' });
    await poll(f.body.data.generationId);
    expect((await request(app).get(`/api/v1/conversations/${conv.id}`).set(A)).body.data.title).toBe('Your campaign report is ready to review');
  });
});
