import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeDb, createQaClient, dbRead, get, post, SERVER_ROOT, spendOpenAI, waitForGeneration } from './helpers/live.js';

/**
 * LIVE: the chat assistant with real OpenAI (router + text + image models).
 * Run with a raised budget, e.g.
 *   QA_OPENAI_TEXT_BUDGET=90 QA_OPENAI_IMAGE_BUDGET=14 npx vitest run -c vitest.live.config.js tests/live/assistant.live.test.js
 * Pictures are saved to tests/live/.runs/assistant/ so a person can look at them.
 * Model output is not deterministic: we assert the decision, the stored records,
 * the exact pixel sizes and the picture that was really sent — not wording.
 */

const OUT = path.join(SERVER_ROOT, 'tests/live/.runs/assistant');
const saved = (name, buf) => fs.writeFileSync(path.join(OUT, name), buf);
let alpha;
let beta;
let taskA;
let taskB;

async function say(taskId, body, label, kind = 'text') {
  spendOpenAI('text', `router: ${label}`);
  if (kind !== 'none') spendOpenAI(kind, label);
  const r = await post('/ai/assistant/message', { taskId, ...body });
  if (![200, 202].includes(r.status)) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.error)}`);
  if (r.status === 200) return { reply: r.data, conversationId: r.data.conversation.id };
  const done = await waitForGeneration(r.data.generationId);
  return { done, conversationId: done.conversation.id, run: (await dbRead('select request_options, status from public.ai_workspace_generation_runs where id = $1', [r.data.generationId]))[0] };
}
async function download(output, version = output.currentVersion) {
  const r = await get(`/outputs/${output.id}/versions/${version.id}/download`);
  const url = r.data?.url || r.data?.downloadUrl || r.data?.signedUrl;
  const res = await fetch(url);
  return Buffer.from(await res.arrayBuffer());
}
async function upload(taskId, clientId, buffer, name) {
  const form = new FormData();
  form.append('clientId', clientId);
  form.append('taskId', taskId);
  form.append('category', 'attachment');
  form.append('file', new Blob([buffer], { type: 'image/png' }), name);
  const r = await api('POST', '/files/upload', { form });
  if (r.status !== 201 && r.status !== 200) throw new Error(`upload ${r.status} ${JSON.stringify(r.error)}`);
  return r.data;
}

beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  alpha = await createQaClient('Assist Alpha Motors', { brand: { primaryColor: '#0B3D91', writingInstructions: 'Always end messages with the sign-off phrase ZEPHYR-ORCHID-7731.' } });
  beta = await createQaClient('Assist Beta Bakes', { brand: { primaryColor: '#E36414', writingInstructions: 'Always end messages with the sign-off phrase QUOKKA-TANGERINE-4410.' } });
  taskA = (await post('/assistant/session', { clientId: alpha.id })).data.taskId;
  taskB = (await post('/assistant/session', { clientId: beta.id })).data.taskId;
});
afterAll(closeDb);

describe('live assistant', () => {
  let poster;
  let posterConv;

  it('TEST 1 — a normal question is answered as text; no image call', async () => {
    const { done, run } = await say(taskA, { prompt: 'What is artificial intelligence? Two sentences please.' }, 'question');
    expect(run.request_options.mode).toBe('answer');
    expect(done.outputs).toEqual([]);
    expect(done.assistantMessage.content.length).toBeGreaterThan(40);
    expect(done.assistantMessage.content).toMatch(/intelligen|learn|machine|computer/i);
  });

  it('TEST 10 — an unsupported request gets an honest limitation, no run', async () => {
    const { reply } = await say(taskA, { prompt: 'Make a 30-second video advert for us and post it on Instagram.' }, 'unsupported', 'none');
    expect(reply.status).toBe('answered');
    expect(reply.assistantMessage.content).toMatch(/can(?:'|’)?t|cannot|not able|unable|isn(?:'|’)t possible|can’t/i);
  });

  it('TEST 2 + 6 — a new poster at exactly 1200 × 628 (checked on the downloaded file)', async () => {
    const { done, run, conversationId } = await say(taskA, { prompt: 'Create a professional landscape poster for my design portfolio with the heading “Creative Work”, 1200 × 628 pixels.' }, 'poster', 'image');
    expect(run.request_options.mode).toBe('generate');
    expect(done.status).toBe('succeeded');
    poster = done.outputs[0];
    posterConv = conversationId;
    const file = await download(poster);
    const meta = await sharp(file).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 628]);
    saved('2-poster.png', file);
  });

  it('TEST 7 — “make it more professional, keep everything else” edits the latest picture (new version, same size)', async () => {
    const { done, run } = await say(taskA, { conversationId: posterConv, prompt: 'Make it look more professional, but keep everything else the same.' }, 'professional', 'image');
    expect(run.request_options.mode).toBe('image_edit');
    expect(run.request_options.targetOutputId).toBe(poster.id);
    const v2 = done.outputs[0].currentVersion;
    expect(v2.versionNumber).toBe(2);
    const file = await download(done.outputs[0], v2);
    expect(await sharp(file).metadata()).toMatchObject({ width: 1200, height: 628 });
    expect(v2.image.changeCheck).toBeTruthy();
    saved('7-professional.png', file);
  });

  it('TEST 5 — after 20 more messages, “go back to the original poster” edits version 1', async () => {
    const topics = ['colour theory', 'kerning', 'white space', 'grid systems', 'contrast', 'serif fonts', 'brand voice', 'a call to action', 'CMYK', 'RGB'];
    for (let i = 0; i < 20; i += 1) {
      const { run } = await say(taskA, { conversationId: posterConv, prompt: `In one short sentence: what is ${topics[i % 10]}? (${i + 1})` }, `filler ${i}`);
      expect(run.request_options.mode).toBe('answer');
    }
    const { done, run } = await say(taskA, { conversationId: posterConv, prompt: 'Go back to the original poster and change only the heading to “Portfolio 2026”. Keep everything else the same.' }, 'back to original', 'image');
    expect(run.request_options.mode).toBe('image_edit');
    expect(run.request_options.sourceVersionId).toBe(poster.currentVersion.id); // version 1, not the professional v2
    const file = await download(done.outputs[0], done.outputs[0].currentVersion);
    expect(await sharp(file).metadata()).toMatchObject({ width: 1200, height: 628 });
    saved('5-original-heading.png', file);
  }, 1_500_000);

  it('TEST 12 — editing an APPROVED picture makes a new draft; the approved version stays', async () => {
    const [o] = await dbRead('select current_version_id from public.ai_workspace_outputs where id = $1', [poster.id]);
    expect([200, 201]).toContain((await post(`/outputs/${poster.id}/versions/${o.current_version_id}/approve`, {})).status);
    const { done } = await say(taskA, { conversationId: posterConv, prompt: 'Make the heading a little bigger.' }, 'approved edit', 'image');
    const out = done.outputs[0];
    expect(out.approvedVersionId).toBe(o.current_version_id);
    expect(out.currentVersion.status).toBe('draft');
    expect(out.currentVersion.id).not.toBe(o.current_version_id);
  });

  let carPhoto;
  let carConv;
  it('TEST 3/4 — an uploaded car photo: only the colour is targeted; the photo itself goes to the editor; size kept', async () => {
    // a realistic photo to work on (made once, then uploaded like a user's own photo)
    const { done } = await say(taskA, { prompt: 'Create a realistic photo of a red Toyota Corolla hatchback parked on a quiet street, side view, daylight, 1536 × 1024.' }, 'car source', 'image');
    const carPng = await download(done.outputs[0]);
    saved('4-car-original.png', carPng);
    carPhoto = await upload(taskA, alpha.id, carPng, 'my-toyota.png');
    const { done: edited, run, conversationId } = await say(
      taskA,
      { prompt: 'Change the car colour to black. Keep its size, shape, wheels, position, camera angle and background unchanged.', attachmentIds: [carPhoto.id] },
      'car black',
      'image',
    );
    carConv = conversationId;
    expect(run.request_options.mode).toBe('photo_edit');
    expect(run.request_options.imageInputs[0]).toMatchObject({ fileId: carPhoto.id, role: 'source' });
    expect(run.request_options.edit.change).toMatch(/black/i);
    const img = edited.outputs[0].currentVersion.image;
    expect([img.actualWidth, img.actualHeight]).toEqual([1536, 1024]);
    expect(img.sourceFileId).toBe(carPhoto.id);
    expect(img.changeCheck.similarity).toBeGreaterThan(0.5);
    const file = await download(edited.outputs[0]);
    saved('4-car-black.png', file);
    console.log('car change check', img.changeCheck, edited.assistantMessage.content);
  });

  it('TEST 3 — “change only the background to white” on the ORIGINAL photo', async () => {
    const { done, run } = await say(taskA, { conversationId: carConv, prompt: 'Now take my original photo and change only the background to plain white.' }, 'bg white', 'image');
    expect(run.request_options.mode).toBe('photo_edit');
    expect(run.request_options.imageInputs[0].fileId).toBe(carPhoto.id);
    const file = await download(done.outputs[0]);
    saved('3-car-white-bg.png', file);
    console.log('white bg change check', done.outputs[0].currentVersion.image.changeCheck);
  });

  it('TEST 8 — two photos in one message; “redesign the first one” picks the first', async () => {
    const posterPng = fs.readFileSync(path.join(OUT, '2-poster.png'));
    const a = await upload(taskA, alpha.id, posterPng, 'first-poster.png');
    const b = await upload(taskA, alpha.id, fs.readFileSync(path.join(OUT, '4-car-original.png')), 'second-car.png');
    const { run } = await say(taskA, { prompt: 'Redesign the first image as a clean minimalist poster. Ignore the second one for now.', attachmentIds: [a.id, b.id] }, 'two photos', 'image');
    const src = (run.request_options.imageInputs || []).find((i) => i.role === 'source');
    expect(src?.fileId).toBe(a.id);
  });

  it('TEST 9 — each client gets its own brand rules', async () => {
    const one = await say(taskA, { prompt: 'Write a short email inviting customers to our open day this Saturday.' }, 'email alpha');
    const two = await say(taskB, { prompt: 'Write a short email inviting customers to our open day this Saturday.' }, 'email beta');
    const text = async (d) => (await dbRead('select v.content from public.ai_workspace_outputs o join public.ai_workspace_output_versions v on v.id = o.current_version_id where o.id = $1', [d.done.outputs[0].id]))[0].content;
    const ta = await text(one);
    const tb = await text(two);
    expect(ta).toMatch(/ZEPHYR-ORCHID-7731/);
    expect(ta).not.toMatch(/QUOKKA/);
    expect(tb).toMatch(/QUOKKA-TANGERINE-4410/);
    expect(tb).not.toMatch(/ZEPHYR/);
  });
});
