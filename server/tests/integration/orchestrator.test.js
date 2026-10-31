import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';
import { aiLimiter } from '../../src/middleware/rateLimiter.js';
import { waitForIdle } from '../../src/jobs/generationQueue.js';

/**
 * POST /ai/assistant/message — the chat works out what each message needs.
 * The fake OpenAI plays the router (structured output named "route") and the
 * generators, and records exactly what each model received.
 */

const ids = { alpha: 'f0000000-0000-4000-8000-000000000001', beta: 'f1000000-0000-4000-8000-000000000001' };
const A = authHeader(USERS.amelia);
const calls = { router: [], text: [], generate: [], edit: [] };
const blank = { summary: '', writing_format: 'unknown', source_image: null, reference_images: [], look_at_images: [], change: '', preserve: [], edit_scope: 'local', use_brand_style: false, width: null, height: null, question: null, limitation: null };
const fake = { route: () => ({ ...blank, action: 'answer' }), routerFail: null, answer: 'Artificial intelligence is software that learns patterns from data.', imageColour: { r: 20, g: 20, b: 20 } };

const png = (w, h, colour) => sharp({ create: { width: w, height: h, channels: 3, background: colour } }).png().toBuffer();
const sizeOf = (s) => s.split('x').map(Number);
const openai = {
  responses: {
    create: async (params) => {
      if (params.text?.format?.name === 'route') {
        calls.router.push(params);
        if (fake.routerFail) throw fake.routerFail;
        return { id: 'r', status: 'completed', output_text: JSON.stringify(fake.route(params)), usage: {} };
      }
      calls.text.push(params);
      return { id: 't', model: params.model, status: 'completed', output_text: fake.answer, usage: {} };
    },
  },
  images: {
    generate: async (params) => {
      calls.generate.push(params);
      return { data: [{ b64_json: (await png(...sizeOf(params.size), { r: 30, g: 60, b: 220 })).toString('base64') }] };
    },
    edit: async (params) => {
      calls.edit.push(params);
      return { data: [{ b64_json: (await png(...sizeOf(params.size), fake.imageColour)).toString('base64') }] };
    },
  },
};

let app;
let db;
let taskId;
let presetId;
beforeAll(async () => {
  ({ app, db } = await createTestContext({ openai }));
  await db.query(
    `insert into public.ai_workspace_clients (id, name, slug, status, primary_colour) values ($1, 'Alpha Cars', 'alpha-cars', 'active', '#123456'), ($2, 'Beta Bakes', 'beta-bakes', 'active', '#ff00aa')`,
    [ids.alpha, ids.beta],
  );
  taskId = (await request(app).post('/api/v1/assistant/session').set(A).send({ clientId: ids.alpha })).body.data.taskId;
  const { rows } = await db.query(`insert into public.ai_workspace_image_presets (name, width_px, height_px, is_custom, is_active) values ('Square', 1080, 1080, false, true) returning id`);
  presetId = rows[0].id;
});
beforeEach(() => {
  aiLimiter.resetKey(`user:${USERS.amelia.id}`);
  fake.routerFail = null;
});
afterEach(() => waitForIdle());

async function poll(id) {
  for (let i = 0; i < 400; i += 1) {
    const r = await request(app).get(`/api/v1/ai/generations/${id}`).set(A);
    if (['succeeded', 'failed'].includes(r.body.data.status)) return r.body.data;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('generation did not finish');
}
const say = (body) => request(app).post('/api/v1/ai/assistant/message').set(A).send({ taskId, options: { presetId }, ...body });
const upload = async (buffer, name = 'car.png', clientId = ids.alpha, task = taskId) =>
  (await request(app).post('/api/v1/files/upload').set(A).field('clientId', clientId).field('taskId', task).field('category', 'attachment').attach('file', buffer, { filename: name, contentType: 'image/png' })).body.data;
const routerText = () => calls.router.at(-1).input[0].content[0].text;
const messages = async (cid) => (await request(app).get(`/api/v1/conversations/${cid}/messages`).set(A)).body.data;

describe('understanding the message', () => {
  it('TEST 1 — a normal question gets a direct answer, no image call, no saved draft', async () => {
    const before = calls.generate.length + calls.edit.length;
    fake.route = () => ({ ...blank, action: 'answer', summary: 'Asks what AI is' });
    const res = await say({ prompt: 'What is artificial intelligence?' });
    expect(res.status).toBe(202);
    const done = await poll(res.body.data.generationId);
    expect(done.status).toBe('succeeded');
    expect(done.outputs).toEqual([]);
    expect(done.assistantMessage.content).toBe(fake.answer);
    expect(done.assistantMessage.intent).toBe('answer');
    expect(calls.generate.length + calls.edit.length).toBe(before);
    expect(calls.text.at(-1).instructions).toMatch(/StudioFlow AI, the assistant of a marketing and automotive agency/);
  });

  it('TEST 10 — an unsupported request gets an honest limitation (no run, nothing generated)', async () => {
    fake.route = () => ({ ...blank, action: 'unsupported', limitation: 'I can’t send emails. I can write it for you to copy.' });
    const runs = (await db.query('select count(*)::int n from public.ai_workspace_generation_runs')).rows[0].n;
    const res = await say({ prompt: 'Email this to the client now' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('answered');
    expect(res.body.data.assistantMessage.content).toMatch(/can’t send emails/);
    expect((await db.query('select count(*)::int n from public.ai_workspace_generation_runs')).rows[0].n).toBe(runs);
  });

  it('TEST 11 — a provider error while understanding: an error, and the message is not stored', async () => {
    fake.routerFail = Object.assign(new Error('boom'), { status: 500 });
    const res = await say({ prompt: 'Hello?' });
    expect(res.status).toBe(502);
    expect(res.body.error.message).toMatch(/not sent/);
    const { rows } = await db.query(`select count(*)::int n from public.ai_workspace_messages where content = 'Hello?'`);
    expect(rows[0].n).toBe(0);
  });
});

describe('pictures', () => {
  let conversationId;
  let photoId;
  let generated;

  it('TEST 2 + 6 — a new picture is generated at exactly the stated size', async () => {
    fake.route = () => ({ ...blank, action: 'generate_image', change: 'A professional landscape poster for a car dealer portfolio', width: 1200, height: 628 });
    const res = await say({ prompt: 'Create a professional landscape poster for my portfolio, 1200 × 628' });
    const done = await poll(res.body.data.generationId);
    expect(done.status).toBe('succeeded');
    conversationId = done.conversation.id;
    generated = done.outputs[0];
    expect(generated.currentVersion.image).toMatchObject({ actualWidth: 1200, actualHeight: 628 });
    expect(calls.generate.at(-1).prompt).toContain('A professional landscape poster');
    expect(calls.edit.length).toBe(0);
  });

  it('TEST 3/4 — an uploaded photo is EDITED (the real photo is the first input), keeps its own size, and is checked', async () => {
    const car = await png(800, 600, { r: 200, g: 20, b: 20 });
    photoId = (await upload(car)).id;
    fake.imageColour = { r: 15, g: 15, b: 15 };
    fake.route = () => ({
      ...blank,
      action: 'edit_image',
      source_image: 2, // Image 1 is the poster, Image 2 the new photo
      change: 'Change the car colour to black',
      preserve: ['the wheels', 'the background'],
      edit_scope: 'local',
    });
    const res = await say({ conversationId, prompt: 'Change the car colour to black. Keep its size, shape, wheels, position and background.', attachmentIds: [photoId] });
    expect(res.status).toBe(202);
    const done = await poll(res.body.data.generationId);
    expect(done.status).toBe('succeeded');
    const edit = calls.edit.at(-1);
    const first = await sharp(Buffer.from(await edit.image[0].arrayBuffer())).stats();
    expect(first.channels[0].mean).toBeGreaterThan(150); // the red photo itself went to the editor
    expect(edit.image).toHaveLength(1); // not sent twice
    expect(edit.input_fidelity).toBeUndefined(); // gpt-image-2: must be omitted
    expect(edit.prompt).toContain('Change only this: Change the car colour to black');
    expect(edit.prompt).toContain('- the wheels');
    expect(edit.prompt).not.toMatch(/Headline in the upper third|Preset/);
    const v = done.outputs[0].currentVersion.image;
    expect(v).toMatchObject({ actualWidth: 800, actualHeight: 600, sourceFileId: photoId, editedFrom: 'Image 2', resizeStrategy: 'fill' });
    expect(v.changeCheck.similarity).toBeGreaterThan(0);
    expect(done.assistantMessage.content).toMatch(/Edited Image 2 — saved as a new picture \(your photo is unchanged\) at 800 × 600px\. Change check/);
  });

  it('TEST 5 + 8 — the router sees every picture by number and the chat history; “the original photo” is found after many messages', async () => {
    fake.route = () => ({ ...blank, action: 'answer' });
    for (let i = 0; i < 20; i += 1) {
      const r = await say({ conversationId, prompt: `Side question number ${i}` });
      await poll(r.body.data.generationId);
      aiLimiter.resetKey(`user:${USERS.amelia.id}`);
    }
    fake.route = () => ({ ...blank, action: 'edit_image', source_image: 2, change: 'Change only the heading to “SALE”' });
    const res = await say({ conversationId, prompt: 'Go back to the original photo and change only the heading' });
    const text = routerText();
    expect(text).toContain('Image 1 — made by the AI');
    expect(text).toContain('Image 2 — photo the user added: “car.png”');
    expect(text).toContain('Image 3 — made by the AI');
    expect(text).toContain('First request in this chat');
    expect(text).toContain('Side question number 19');
    const done = await poll(res.body.data.generationId);
    const first = await sharp(Buffer.from(await calls.edit.at(-1).image[0].arrayBuffer())).stats();
    expect(first.channels[0].mean).toBeGreaterThan(150); // the original red photo, not the black edit
    expect(done.outputs[0].currentVersion.image.editedFrom).toBe('Image 2');
  });

  it('TEST 7 + 12 — a follow-up edit of an APPROVED AI picture makes a new draft version from the chosen version', async () => {
    const out = generated;
    await request(app).post(`/api/v1/outputs/${out.id}/versions/${out.currentVersion.id}/approve`).set(A).send({});
    fake.route = () => ({ ...blank, action: 'edit_image', source_image: 1, change: 'Make it look more professional', edit_scope: 'global' });
    const res = await say({ conversationId, prompt: 'Make it more professional, but keep everything else the same' });
    const done = await poll(res.body.data.generationId);
    expect(done.status).toBe('succeeded');
    const o = done.outputs[0];
    expect(o.id).toBe(out.id);
    expect(o.currentVersion.versionNumber).toBe(2);
    expect(o.currentVersion.status).toBe('draft');
    expect(o.approvedVersionId).toBe(out.currentVersion.id); // the approved v1 stays approved
    expect(o.currentVersion.image).toMatchObject({ actualWidth: 1200, actualHeight: 628, editedFrom: 'Image 1' });
    const thread = await messages(conversationId);
    expect(thread.at(-1).versionIds).toEqual([o.currentVersion.id]);
  });

  it('the user’s own picture choice wins over the router; an unknown picture number asks which one', async () => {
    fake.route = () => ({ ...blank, action: 'edit_image', source_image: 99, change: 'Brighter' });
    const ask = await say({ conversationId, prompt: 'Make that one brighter' });
    expect(ask.status).toBe(200);
    expect(ask.body.data.assistantMessage.content).toMatch(/Which picture should I change\? Image 1, Image 2/);

    const res = await say({ conversationId, prompt: 'Make that one brighter', imageRefs: [{ fileId: photoId }] });
    expect(routerText()).toContain('explicit_selection: Image 2');
    const done = await poll(res.body.data.generationId);
    expect(done.outputs[0].currentVersion.image.sourceFileId).toBe(photoId);
  });

  it('TEST 9 — another client’s picture can never be used', async () => {
    const betaTask = (await request(app).post('/api/v1/assistant/session').set(A).send({ clientId: ids.beta })).body.data.taskId;
    const betaPhoto = await upload(await png(64, 64, { r: 1, g: 2, b: 3 }), 'beta.png', ids.beta, betaTask);
    const res = await say({ conversationId, prompt: 'Use this', imageRefs: [{ fileId: betaPhoto.id }] });
    expect(res.status).toBe(404);
    const res2 = await say({ conversationId, prompt: 'Use this', attachmentIds: [betaPhoto.id] });
    expect(res2.status).toBe(404);
  });

  it('a photo with a question is looked at (vision) and answered, not edited', async () => {
    const edits = calls.edit.length;
    fake.route = () => ({ ...blank, action: 'answer', look_at_images: [2] });
    const res = await say({ conversationId, prompt: 'What is in this image?' });
    await poll(res.body.data.generationId);
    const content = calls.text.at(-1).input[0].content;
    expect(content.some((c) => c.type === 'input_image' && /^data:image\/jpeg;base64,/.test(c.image_url))).toBe(true);
    expect(calls.edit.length).toBe(edits);
  });
});
