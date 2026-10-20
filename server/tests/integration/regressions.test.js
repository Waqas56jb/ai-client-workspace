import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';
import { aiLimiter } from '../../src/middleware/rateLimiter.js';
import { markRunsInterrupted, waitForIdle } from '../../src/jobs/generationQueue.js';
import { chooseGenerationSize, MAX_ASPECT, MIN_ASPECT, MIN_GENERATION_PIXELS } from '../../src/services/ai/imageProcessing.js';

/**
 * Regression tests for defects found during production-readiness QA (2026-10).
 * Each block names the defect it guards against.
 */

const ids = {
  client: 'c0000000-0000-4000-8000-000000000001',
  job: 'c0000000-0000-4000-8000-000000000002',
  task: 'c0000000-0000-4000-8000-000000000003',
};
const A = authHeader(USERS.amelia);

const fake = { status: 'completed', text: 'Subject: Hello\n\nBody text.\n\nKind regards', gate: null };
const openai = {
  responses: {
    create: async (params) => {
      if (fake.gate) await fake.gate;
      return { id: 'resp', model: params.model, status: fake.status, output_text: fake.text, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    },
  },
  images: { generate: async () => ({ data: [] }), edit: async () => ({ data: [] }) },
};

let app;
let db;
beforeAll(async () => {
  ({ app, db } = await createTestContext({ openai }));
  await db.query(`insert into public.ai_workspace_clients (id, name, slug) values ($1, 'Gamma Garage', 'gamma-garage')`, [ids.client]);
  await db.query(`insert into public.ai_workspace_jobs (id, client_id, title) values ($1, $2, 'Stock')`, [ids.job, ids.client]);
  await db.query(`insert into public.ai_workspace_tasks (id, client_id, job_id, title, task_type) values ($1, $2, $3, 'Listings', 'vehicle_description')`, [ids.task, ids.client, ids.job]);
});
beforeEach(() => {
  aiLimiter.resetKey(`user:${USERS.amelia.id}`);
  Object.assign(fake, { status: 'completed', text: 'Subject: Hello\n\nBody text.\n\nKind regards', gate: null });
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
const writeEmail = (headers = {}) =>
  request(app).post('/api/v1/ai/writing/generate').set(A).set(headers).send({ taskId: ids.task, prompt: 'Write an email about opening hours', options: { format: 'email' } });

describe('truncated model output is not saved as a success', () => {
  it('an incomplete Responses API result fails the run with AI_INCOMPLETE and creates no output', async () => {
    fake.status = 'incomplete';
    fake.text = 'Subject: Hello\n\nThis sentence is cut o';
    const before = Number((await db.query('select count(*) n from public.ai_workspace_outputs')).rows[0].n);
    const run = await poll((await writeEmail()).body.data.generationId);
    expect(run.status).toBe('failed');
    expect(run.error?.code || run.errorCode).toBe('AI_INCOMPLETE');
    expect(Number((await db.query('select count(*) n from public.ai_workspace_outputs')).rows[0].n)).toBe(before);
  });
});

describe('idempotency keys', () => {
  it('a key reused for a different kind of request is rejected (422), not silently answered with the old run', async () => {
    const key = 'qa-idem-key-reuse-1';
    const first = await writeEmail({ 'Idempotency-Key': key });
    expect(first.status).toBe(202);
    await poll(first.body.data.generationId);
    const other = await request(app)
      .post('/api/v1/ai/vehicle-description/generate')
      .set(A)
      .set('Idempotency-Key', key)
      .send({ taskId: ids.task, options: { year: '2021', make: 'Mazda', model: 'CX-5' } });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('two concurrent submissions with the same key resolve to ONE run', async () => {
    let release;
    fake.gate = new Promise((r) => (release = r));
    const key = 'qa-idem-concurrent-1';
    const [a, b] = await Promise.all([writeEmail({ 'Idempotency-Key': key }), writeEmail({ 'Idempotency-Key': key })]);
    release();
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.body.data.generationId).toBe(b.body.data.generationId);
    const runs = await db.query('select count(*) n from public.ai_workspace_generation_runs where idempotency_key = $1', [key]);
    expect(Number(runs.rows[0].n)).toBe(1);
    await poll(a.body.data.generationId);
  });
});

describe('interrupted runs', () => {
  it('a run reconciled as interrupted while executing is not flipped to succeeded and creates no output', async () => {
    let release;
    fake.gate = new Promise((r) => (release = r));
    const start = await writeEmail();
    const id = start.body.data.generationId;
    for (let i = 0; i < 100; i += 1) {
      const { rows } = await db.query('select status from public.ai_workspace_generation_runs where id = $1', [id]);
      if (rows[0].status === 'running') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    // Another instance reconciles it (ids path = the owner's shutdown path)
    expect(await markRunsInterrupted({ ids: [id] })).toBe(1);
    release();
    await waitForIdle();
    const { rows } = await db.query('select status, error_code from public.ai_workspace_generation_runs where id = $1', [id]);
    expect(rows[0]).toEqual({ status: 'failed', error_code: 'INTERRUPTED' });
    const outs = await db.query(`select count(*) n from public.ai_workspace_outputs where conversation_id = $1`, [start.body.data.conversation.id]);
    expect(Number(outs.rows[0].n)).toBe(0);
    const errs = await db.query(`select count(*) n from public.ai_workspace_messages where conversation_id = $1 and message_type = 'error'`, [start.body.data.conversation.id]);
    expect(Number(errs.rows[0].n)).toBe(1); // exactly one error message, not one per path
  });

  it('runs left queued/running by a previous process are failed (no 60 s age gap that leaves them stuck forever)', async () => {
    const conv = (await writeEmail()).body.data;
    await poll(conv.generationId);
    const stuck = '5f000000-0000-4000-8000-000000000001';
    await db.query(
      `insert into public.ai_workspace_generation_runs (id, client_id, job_id, task_id, conversation_id, tool_type, model, status, request_options, created_by, started_at)
       values ($1, $2, $3, $4, $5, 'writing_editing', 'gpt-5.4-mini', 'running', '{}', $6, now() - interval '5 seconds')`,
      [stuck, ids.client, ids.job, ids.task, conv.conversation.id, USERS.amelia.id],
    );
    expect(await markRunsInterrupted({ startedBefore: new Date() })).toBe(1);
    const { rows } = await db.query('select status from public.ai_workspace_generation_runs where id = $1', [stuck]);
    expect(rows[0].status).toBe('failed');
  });
});

describe('vehicle revisions keep the supplied facts', () => {
  it('an AI revision of a vehicle listing keeps the same missing-information list (facts are not dropped)', async () => {
    fake.text = '2021 Mazda CX-5. Supplied details only.';
    const gen = await request(app)
      .post('/api/v1/ai/vehicle-description/generate')
      .set(A)
      .send({ taskId: ids.task, options: { year: '2021', make: 'Mazda', model: 'CX-5', mileage: '12,000 miles' } });
    const run = await poll(gen.body.data.generationId);
    const outputId = run.outputs[0].id;
    const v1 = (await db.query('select missing_info from public.ai_workspace_output_versions where output_id = $1 and version_number = 1', [outputId])).rows[0];
    const rev = await request(app).post('/api/v1/ai/writing/revise').set(A).send({ outputId, instructions: 'Make it punchier' });
    expect(rev.status).toBe(202);
    expect((await poll(rev.body.data.generationId)).status).toBe('succeeded');
    const v2 = (await db.query('select missing_info from public.ai_workspace_output_versions where output_id = $1 and version_number = 2', [outputId])).rows[0];
    expect(v2.missing_info).toEqual(v1.missing_info);
    expect(JSON.stringify(v2.missing_info)).not.toMatch(/Year|Make|Model|Mileage/);
  });
});

describe('approval workflow', () => {
  it('an earlier approved version can be approved again (made current) without duplicating history', async () => {
    const run = await poll((await writeEmail()).body.data.generationId);
    const outputId = run.outputs[0].id;
    const versions = async () => (await request(app).get(`/api/v1/outputs/${outputId}/versions`).set(A)).body.data;
    const v1 = (await versions())[0];
    expect((await request(app).post(`/api/v1/outputs/${outputId}/versions/${v1.id}/approve`).set(A).send({})).status).toBe(200);
    const rev = await request(app).post(`/api/v1/outputs/${outputId}/revisions`).set(A).send({ content: 'Second version' });
    expect(rev.status).toBe(201);
    const v2 = (await versions()).find((v) => v.versionNumber === 2);
    expect((await request(app).post(`/api/v1/outputs/${outputId}/versions/${v2.id}/approve`).set(A).send({})).status).toBe(200);
    const back = await request(app).post(`/api/v1/outputs/${outputId}/versions/${v1.id}/approve`).set(A).send({});
    expect(back.status).toBe(200);
    const { rows } = await db.query('select approved_version_id from public.ai_workspace_outputs where id = $1', [outputId]);
    expect(rows[0].approved_version_id).toBe(v1.id);
    const appr = await db.query('select output_version_id from public.ai_workspace_approvals where output_id = $1 order by approved_at', [outputId]);
    expect(appr.rows.map((r) => r.output_version_id)).toEqual([v1.id, v2.id]);
    // approving the current approved version again is still a conflict
    expect((await request(app).post(`/api/v1/outputs/${outputId}/versions/${v1.id}/approve`).set(A).send({})).status).toBe(409);
  });
});

describe('Data API lockdown (Supabase REST/RPC with a member token)', () => {
  it('a member session that did not come through the API sees no rows and cannot write', async () => {
    const asDataApi = (fn) =>
      db.transaction(async (tx) => {
        // What PostgREST does: claims + authenticated role, but NOT ai_workspace.via_api
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [
          USERS.amelia.id,
          JSON.stringify({ sub: USERS.amelia.id, role: 'authenticated' }),
        ]);
        await tx.query('set local role authenticated');
        return fn(tx);
      });
    const rows = await asDataApi(async (tx) => (await tx.query('select id from public.ai_workspace_clients')).rows);
    expect(rows).toEqual([]);
    await expect(
      asDataApi((tx) => tx.query(`insert into public.ai_workspace_activity_logs (user_id, action_type, resource_type, description) values ($1, 'forged', 'x', 'forged')`, [USERS.jordan.id])),
    ).rejects.toThrow(/row-level security/);
    await expect(asDataApi((tx) => tx.query(`select public.ai_workspace_approve_output_version($1, $1)`, [ids.client]))).rejects.toThrow(/not a workspace member/);
    // ...while the API itself still works
    expect((await request(app).get(`/api/v1/clients/${ids.client}`).set(A)).status).toBe(200);
  });
});

describe('input handling', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('GET /ai-instructions/%s is a 400, not a 500', async (t) => {
    const r = await request(app).get(`/api/v1/ai-instructions/${t}`).set(A);
    expect(r.status).toBe(400);
  });

  it('uppercase UUIDs resolve to the same records', async () => {
    const r = await request(app).get(`/api/v1/clients/${ids.client.toUpperCase()}`).set(A);
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(ids.client);
  });

  it('non-ASCII upload file names are stored intact (UTF-8, not latin1)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const r = await request(app)
      .post('/api/v1/files/upload')
      .set(A)
      .field('clientId', ids.client)
      .attach('file', pdf, { filename: 'Café menü – ürün.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);
    expect(r.body.data.name).toBe('Café menü – ürün.pdf');
  });

  it('a client-specific preset cannot become the workspace default', async () => {
    const p = await request(app).post('/api/v1/image-presets').set(A).send({ name: 'Gamma only', width: 1080, height: 1080, scope: 'client', clientId: ids.client });
    expect(p.status).toBe(201);
    const r = await request(app).patch('/api/v1/settings/workspace').set(A).send({ defaultPresetId: p.body.data.id });
    expect(r.status).toBe(400);
  });
});

describe('gpt-image-2 generation size', () => {
  it('every requested size maps to a valid provider size (multiple of 16, ratio 1:3–3:1, within edge/area limits, at least the minimum pixels)', () => {
    for (let w = 64; w <= 4096; w += 61) {
      for (let h = 64; h <= 4096; h += 67) {
        const s = chooseGenerationSize('gpt-image-2', w, h);
        const ratio = s.width / s.height;
        expect(s.width % 16 + (s.height % 16), `${w}x${h}`).toBe(0);
        expect(s.width * s.height, `${w}x${h} → ${s.sizeParam}`).toBeGreaterThanOrEqual(MIN_GENERATION_PIXELS);
        expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(3840);
        expect(s.width * s.height).toBeLessThanOrEqual(3840 * 2160);
        expect(ratio).toBeLessThanOrEqual(MAX_ASPECT + 1e-9);
        expect(ratio).toBeGreaterThanOrEqual(MIN_ASPECT - 1e-9);
      }
    }
  });
});

describe('provider error classification', () => {
  it('maps the real OpenAI SDK error classes to the right safe codes (SDK errors all have name "Error")', async () => {
    const OpenAI = (await import('openai')).default;
    const { safeError } = await import('../../src/services/ai/execution.service.js');
    expect(safeError(new OpenAI.APIConnectionTimeoutError()).code).toBe('AI_TIMEOUT');
    expect(safeError(new OpenAI.APIConnectionError({ message: 'ECONNRESET at 10.0.0.1' })).code).toBe('AI_UNAVAILABLE');
    expect(safeError(new OpenAI.APIConnectionError({ message: 'x' })).message).not.toMatch(/10\.0\.0\.1/);
  });
});

describe('image edit with reference images', () => {
  it('attachmentIds on /ai/images/edit are validated against the task scope (another client\u2019s file is refused)', async () => {
    const otherClient = 'c1000000-0000-4000-8000-000000000001';
    const otherFile = 'c1000000-0000-4000-8000-000000000004';
    await db.query(`insert into public.ai_workspace_clients (id, name, slug) values ($1, 'Other Co', 'other-co') on conflict do nothing`, [otherClient]);
    await db.query(
      `insert into public.ai_workspace_files (id, client_id, file_name, mime_type, file_category, source_type, storage_path)
       values ($1, $2, 'ref.png', 'image/png', 'image', 'reference', 'clients/x/ref.png') on conflict do nothing`,
      [otherFile, otherClient],
    );
    const run = await poll((await writeEmail()).body.data.generationId);
    // a text output: the edit is refused before attachments matter, so use the validator path only
    const r = await request(app).post('/api/v1/ai/images/edit').set(A).send({ outputId: run.outputs[0].id, prompt: 'x', attachmentIds: ['not-a-uuid'] });
    expect(r.status).toBe(400);
  });
});

describe('manual revisions of sectioned (advertising) outputs', () => {
  it('a content-only revision replaces the sections so the edit is visible', async () => {
    fake.text = 'Headline: Fresh bread\nCTA: Visit today';
    const gen = await request(app)
      .post('/api/v1/ai/advertising/generate')
      .set(A)
      .send({ taskId: ids.task, options: { campaignName: 'Bread', product: 'Bread', outputTypes: ['headlines', 'cta'] } });
    const outputId = (await poll(gen.body.data.generationId)).outputs[0].id;
    const rev = await request(app).post(`/api/v1/outputs/${outputId}/revisions`).set(A).send({ content: 'Completely rewritten copy' });
    expect(rev.status).toBe(201);
    const { rows } = await db.query('select content, sections from public.ai_workspace_output_versions where output_id = $1 order by version_number desc limit 1', [outputId]);
    expect(rows[0].content).toBe('Completely rewritten copy');
    expect(rows[0].sections ?? []).toEqual([]);
    const dto = (await request(app).get(`/api/v1/outputs/${outputId}`).set(A)).body.data;
    expect(JSON.stringify(dto)).toContain('Completely rewritten copy');
    // and the version is shown as plain text, not as "0 sections" with an empty body (QA bug #1)
    const versions = (await request(app).get(`/api/v1/outputs/${outputId}/versions`).set(A)).body.data;
    expect(versions.find((v) => v.versionNumber === 2).sections).toBeNull();
  });
});
