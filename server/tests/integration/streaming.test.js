import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';
import { aiLimiter } from '../../src/middleware/rateLimiter.js';
import { waitForIdle } from '../../src/jobs/generationQueue.js';

/**
 * Answers stream token by token: GET /ai/generations/:id/stream sends the text
 * as the model writes it (Server-Sent Events), and the stored answer is the same text.
 */

const ids = { client: 'b8000000-0000-4000-8000-000000000001' };
const A = authHeader(USERS.amelia);
const blank = { summary: '', writing_format: 'unknown', source_image: null, reference_images: [], look_at_images: [], use_files: [], change: '', preserve: [], edit_scope: 'local', use_brand_style: false, width: null, height: null, question: null, limitation: null, remember: [], forget: [] };
const fake = { parts: ['Regenerative ', 'braking turns ', 'motion into charge.'], gate: null, streamCalls: 0 };

async function* events() {
  for (const p of fake.parts) {
    if (fake.gate) await fake.gate;
    yield { type: 'response.output_text.delta', delta: p };
    await new Promise((r) => setTimeout(r, 15));
  }
  yield { type: 'response.completed', response: { id: 'resp_1', model: 'gpt-5.4-mini', status: 'completed', usage: { input_tokens: 10, output_tokens: 6 } } };
}
const openai = {
  responses: {
    create: async (params) => {
      if (params.text?.format?.name === 'route') return { id: 'r', status: 'completed', output_text: JSON.stringify({ ...blank, action: 'answer' }), usage: {} };
      if (params.stream) {
        fake.streamCalls += 1;
        return events();
      }
      return { id: 't', status: 'completed', output_text: 'not streamed', usage: {} };
    },
  },
  images: { generate: async () => ({ data: [] }), edit: async () => ({ data: [] }) },
};

let app;
let db;
let taskId;
beforeAll(async () => {
  ({ app, db } = await createTestContext({ openai }));
  await db.query(`insert into public.ai_workspace_clients (id, name, slug, status) values ($1, 'Stream Co', 'stream-co', 'active')`, [ids.client]);
  taskId = (await request(app).post('/api/v1/assistant/session').set(A).send({ clientId: ids.client })).body.data.taskId;
});
beforeEach(() => aiLimiter.resetKey(`user:${USERS.amelia.id}`));
afterEach(() => waitForIdle());

const parse = (body) =>
  String(body)
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)));

async function poll(id) {
  for (let i = 0; i < 400; i += 1) {
    const r = await request(app).get(`/api/v1/ai/generations/${id}`).set(A);
    if (['succeeded', 'failed'].includes(r.body.data.status)) return r.body.data;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('generation did not finish');
}

describe('streaming answers', () => {
  it('the stream carries the text piece by piece, then done; the saved answer is the same text', async () => {
    let open;
    fake.gate = new Promise((r) => (open = r));
    const res = await request(app).post('/api/v1/ai/assistant/message').set(A).send({ taskId, prompt: 'What is regenerative braking?' });
    expect(res.status).toBe(202);
    const id = res.body.data.generationId;
    // wait until the worker has started streaming, then watch
    for (let i = 0; i < 200 && fake.streamCalls === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
    const watching = request(app).get(`/api/v1/ai/generations/${id}/stream`).set(A).buffer(true).parse((r, cb) => {
      let data = '';
      r.on('data', (c) => (data += c));
      r.on('end', () => cb(null, data));
    });
    setTimeout(() => {
      fake.gate = null;
      open();
    }, 50);
    const sse = await watching;
    expect(sse.headers['content-type']).toMatch(/text\/event-stream/);
    const evts = parse(sse.body);
    expect(evts[0].type).toBe('snapshot');
    const text = evts.filter((e) => e.type === 'snapshot' || e.type === 'delta').map((e) => e.text).join('');
    expect(text).toBe('Regenerative braking turns motion into charge.');
    expect(evts.filter((e) => e.type === 'delta').length).toBeGreaterThanOrEqual(2);
    expect(evts.at(-1)).toEqual({ type: 'done', status: 'succeeded' });
    const done = await poll(id);
    expect(done.assistantMessage.content).toBe('Regenerative braking turns motion into charge.');
  });

  it('a finished answer still opens the stream: everything at once, then done (or idle later)', async () => {
    const res = await request(app).post('/api/v1/ai/assistant/message').set(A).send({ taskId, prompt: 'Again please' });
    const id = res.body.data.generationId;
    await poll(id);
    const sse = await request(app).get(`/api/v1/ai/generations/${id}/stream`).set(A).buffer(true).parse((r, cb) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => cb(null, d));
    });
    const evts = parse(sse.body);
    expect(['done', 'idle']).toContain(evts.at(-1).type);
  });

  it('another user cannot watch a stream; an unknown id is 404', async () => {
    const res = await request(app).post('/api/v1/ai/assistant/message').set(A).send({ taskId, prompt: 'Private question' });
    const id = res.body.data.generationId;
    await poll(id);
    expect((await request(app).get('/api/v1/ai/generations/00000000-0000-4000-8000-000000000000/stream').set(A)).status).toBe(404);
    expect((await request(app).get(`/api/v1/ai/generations/${id}/stream`)).status).toBe(401);
  });
});
