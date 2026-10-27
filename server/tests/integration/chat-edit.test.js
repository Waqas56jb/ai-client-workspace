import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';
import { aiLimiter } from '../../src/middleware/rateLimiter.js';
import { waitForIdle } from '../../src/jobs/generationQueue.js';

/**
 * ChatGPT-style chat: editing an earlier message (the rest of the chat is hidden
 * from the thread and from the AI's memory, nothing is deleted), and editing the
 * exact image version the user picked ("Image 2"), not just the latest one.
 */

const ids = { alpha: 'e0000000-0000-4000-8000-000000000001', beta: 'e1000000-0000-4000-8000-000000000001' };
const A = authHeader(USERS.amelia);
const calls = { responses: [], edit: [] };
const fake = { text: () => 'Hi Sam,\n\nThanks for today.\n\nKind regards,\nAlpha', gate: null, editColour: { r: 220, g: 30, b: 30 } };

const png = (size, colour) => {
  const [width, height] = size.split('x').map(Number);
  return sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();
};
const openai = {
  responses: {
    create: async (params) => {
      calls.responses.push(params);
      if (fake.gate) await fake.gate;
      return { id: 'r', model: params.model, status: 'completed', output_text: fake.text(params), usage: {} };
    },
  },
  images: {
    generate: async (params) => ({ data: [{ b64_json: (await png(params.size, { r: 30, g: 60, b: 220 })).toString('base64') }] }),
    edit: async (params) => {
      calls.edit.push(params);
      return { data: [{ b64_json: (await png(params.size, fake.editColour)).toString('base64') }] };
    },
  },
};

let app;
let db;
beforeAll(async () => {
  ({ app, db } = await createTestContext({ openai }));
  await db.query(
    `insert into public.ai_workspace_clients (id, name, slug, status) values ($1, 'Alpha Agency', 'alpha-agency', 'active'), ($2, 'Beta Bakes', 'beta-bakes', 'active')`,
    [ids.alpha, ids.beta],
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
const session = async (clientId) => (await request(app).post('/api/v1/assistant/session').set(A).send({ clientId })).body.data;
const write = (body) => request(app).post('/api/v1/ai/writing/generate').set(A).send(body);
const messages = async (conversationId) => (await request(app).get(`/api/v1/conversations/${conversationId}/messages`).set(A)).body.data;
const lastInput = () => JSON.stringify(calls.responses.at(-1).input);

describe('editing an earlier message', () => {
  it('replaces the message, hides the later turns from the chat and the AI memory, keeps the old drafts', async () => {
    const { taskId } = await session(ids.alpha);
    const first = await write({ taskId, prompt: 'Email Sam about the BLUE banner', options: { format: 'email' } });
    await poll(first.body.data.generationId);
    const conversationId = first.body.data.conversation.id;
    const firstUserId = first.body.data.userMessage.id;
    const second = await write({ taskId, conversationId, prompt: 'Add a line about the WEEKEND launch' });
    await poll(second.body.data.generationId);
    expect(await messages(conversationId)).toHaveLength(4);

    const edited = await write({ taskId, conversationId, prompt: 'Email Sam about the GREEN banner', replacesMessageId: firstUserId });
    expect(edited.status).toBe(202);
    const done = await poll(edited.body.data.generationId);
    expect(done.status).toBe('succeeded');

    // the model saw neither the replaced prompt nor the turn after it, and kept the email format
    expect(lastInput()).toContain('GREEN banner');
    expect(lastInput()).not.toContain('BLUE banner');
    expect(lastInput()).not.toContain('WEEKEND launch');
    expect(done.outputs[0].format).toBe('email');

    const thread = await messages(conversationId);
    expect(thread.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(thread[0]).toMatchObject({ content: 'Email Sam about the GREEN banner', editedFromId: firstUserId });
    expect(thread[1].versionIds).toHaveLength(1);

    // nothing was deleted: the earlier drafts are still saved
    const { rows } = await db.query('select count(*)::int n from public.ai_workspace_outputs where conversation_id = $1', [conversationId]);
    expect(rows[0].n).toBe(3);
  });

  it('refuses another chat’s message, an AI message, a message already changed, and a busy chat', async () => {
    const { taskId } = await session(ids.alpha);
    const a = await write({ taskId, prompt: 'Email one', options: { format: 'email' } });
    await poll(a.body.data.generationId);
    const b = await write({ taskId, prompt: 'Email two', options: { format: 'email' } });
    const bDone = await poll(b.body.data.generationId);
    const convA = a.body.data.conversation.id;

    expect((await write({ taskId, conversationId: convA, prompt: 'x', replacesMessageId: b.body.data.userMessage.id })).status).toBe(404);
    expect((await write({ taskId, conversationId: convA, prompt: 'x', replacesMessageId: bDone.assistantMessage.id })).status).toBe(404);
    expect((await write({ taskId, prompt: 'x', replacesMessageId: a.body.data.userMessage.id })).status).toBe(400);
    aiLimiter.resetKey(`user:${USERS.amelia.id}`); // the refused attempts above count towards the AI rate limit

    const ok = await write({ taskId, conversationId: convA, prompt: 'Email one, changed', options: { format: 'email' }, replacesMessageId: a.body.data.userMessage.id });
    await poll(ok.body.data.generationId);
    expect((await write({ taskId, conversationId: convA, prompt: 'again', replacesMessageId: a.body.data.userMessage.id })).status).toBe(409);

    // while an answer is still being written, earlier messages cannot be changed
    let open;
    fake.gate = new Promise((res) => (open = res));
    const running = await write({ taskId, conversationId: convA, prompt: 'Shorter please' });
    const busy = await write({ taskId, conversationId: convA, prompt: 'changed', replacesMessageId: ok.body.data.userMessage.id });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('CONVERSATION_BUSY');
    fake.gate = null;
    open();
    await poll(running.body.data.generationId);
  });
});

describe('editing the exact image version', () => {
  it('“Image 1” stays the first version even after the image was edited', async () => {
    const { taskId } = await session(ids.beta);
    const gen = await request(app).post('/api/v1/ai/images/generate').set(A).send({ taskId, prompt: 'A cake on a table', options: { width: 512, height: 512 } });
    const g = await poll(gen.body.data.generationId);
    const out = g.outputs[0];
    const v1 = out.currentVersion.id;
    expect(g.assistantMessage.versionIds).toEqual([v1]);

    fake.editColour = { r: 220, g: 30, b: 30 };
    const e1 = await request(app).post('/api/v1/ai/images/edit').set(A).send({ outputId: out.id, conversationId: g.conversation.id, prompt: 'Make it red' });
    const d1 = await poll(e1.body.data.generationId);
    const v2 = d1.outputs[0].currentVersion.id;
    expect(v2).not.toBe(v1);
    expect(d1.assistantMessage.versionIds).toEqual([v2]);

    // the client asks to change Image 1 (the blue original), not the red edit
    const e2 = await request(app)
      .post('/api/v1/ai/images/generate')
      .set(A)
      .send({ taskId, conversationId: g.conversation.id, prompt: 'Add candles', options: { width: 512, height: 512, editOutputId: out.id, editVersionId: v1 } });
    expect(e2.status).toBe(202);
    const d2 = await poll(e2.body.data.generationId);
    expect(d2.status).toBe('succeeded');
    const base = await sharp(Buffer.from(await calls.edit.at(-1).image[0].arrayBuffer())).stats();
    expect(base.channels[2].mean).toBeGreaterThan(150); // blue = version 1
    expect(base.channels[0].mean).toBeLessThan(80);
    expect(d2.outputs[0].currentVersion.versionNumber).toBe(3);
    expect(d2.outputs[0].currentVersion.note).toBe('AI edit of v1');
    expect(d2.userMessage.requestOptions).toMatchObject({ editOutputId: out.id, editVersionId: v1 });

    // a version of another output is refused
    const other = await request(app).post('/api/v1/ai/images/generate').set(A).send({ taskId, prompt: 'Bread', options: { width: 512, height: 512 } });
    const o = (await poll(other.body.data.generationId)).outputs[0];
    const bad = await request(app).post('/api/v1/ai/images/edit').set(A).send({ outputId: o.id, versionId: v1, prompt: 'x' });
    expect(bad.status).toBe(404);
  });
});
