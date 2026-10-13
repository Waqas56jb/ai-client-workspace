import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, authHeader, USERS } from '../helpers/testApp.js';
import { DEFAULT_INSTRUCTIONS } from '../../src/constants/defaults.js';

let app;
let db;
const A = authHeader(USERS.amelia);
const count = async () => Number((await db.query('select count(*) from public.ai_workspace_ai_instructions')).rows[0].count);

beforeAll(async () => {
  ({ app, db } = await createTestContext());
});

describe('AI instructions', () => {
  it('lists 4 tools in display order with defaults marked and nothing written', async () => {
    const res = await request(app).get('/api/v1/ai-instructions').set(A);
    expect(res.status).toBe(200);
    expect(res.body.data.map((i) => i.toolId)).toEqual(['writing', 'image', 'advertising', 'vehicle']);
    expect(res.body.data.every((i) => i.isDefault)).toBe(true);
    expect(res.body.data[0]).toMatchObject({ name: DEFAULT_INSTRUCTIONS.writing_editing.name, systemInstruction: DEFAULT_INSTRUCTIONS.writing_editing.systemInstruction, examples: [], active: true });
    expect(await count()).toBe(0);
  });

  it('gets one tool by frontend id and rejects unknown tools', async () => {
    const res = await request(app).get('/api/v1/ai-instructions/vehicle').set(A);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ toolId: 'vehicle', isDefault: true });
    expect((await request(app).get('/api/v1/ai-instructions/video').set(A)).status).toBe(400);
  });

  it('PATCH inserts when missing, then bumps the version on each save and logs activity', async () => {
    const first = await request(app)
      .patch('/api/v1/ai-instructions/writing')
      .set(A)
      .send({ systemInstruction: 'Write short, friendly copy for the client only.', examples: [{ input: 'SMS', output: 'Hi there' }, { id: 'ex_1', input: 'Email', output: 'Dear…' }], updatedBy: USERS.sam.id });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ toolId: 'writing', version: 1, isDefault: false, updatedBy: USERS.amelia.id, name: DEFAULT_INSTRUCTIONS.writing_editing.name });
    expect(first.body.data.updatedByUser).toMatchObject({ id: USERS.amelia.id });
    expect(first.body.data.examples).toHaveLength(2);
    expect(first.body.data.examples[0].id).toMatch(/^ex_/);
    expect(first.body.data.examples[1].id).toBe('ex_1');

    const second = await request(app)
      .put('/api/v1/ai-instructions/writing')
      .set(authHeader(USERS.jordan))
      .send({ active: false, modelConfiguration: { model: 'gpt-5.4', maxOutputTokens: 1200 } });
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ version: 2, active: false, updatedBy: USERS.jordan.id, modelConfiguration: { model: 'gpt-5.4', maxOutputTokens: 1200 }, systemInstruction: 'Write short, friendly copy for the client only.' });
    const { rows } = await db.query(`select model_configuration from public.ai_workspace_ai_instructions where tool_type = 'writing_editing'`);
    expect(rows[0].model_configuration).toEqual({ model: 'gpt-5.4', max_output_tokens: 1200 });
    const acts = await db.query(`select count(*)::int as n from public.ai_workspace_activity_logs where action_type = 'instructions_updated' and resource_id = 'writing'`);
    expect(acts.rows[0].n).toBe(2);
  });

  it('rejects invalid PATCH bodies', async () => {
    const bad = async (tool, body) => request(app).patch(`/api/v1/ai-instructions/${tool}`).set(A).send(body);
    expect((await bad('writing', { systemInstruction: 'too short' })).status).toBe(400);
    expect((await bad('writing', { modelConfiguration: { model: 'gpt-image-2' } })).status).toBe(400); // image model on text tool
    expect((await bad('writing', { modelConfiguration: { model: 'evil-model' } })).status).toBe(400);
    expect((await bad('image', { modelConfiguration: { model: 'gpt-5.4' } })).status).toBe(400); // text model on image tool
    const unknown = await bad('writing', { modelConfiguration: { model: 'gpt-5.4', temperature: 2 } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');
    expect((await bad('writing', { modelConfiguration: { quality: 'high' } })).status).toBe(400); // quality is image-only
    expect((await bad('writing', { modelConfiguration: { maxOutputTokens: 9000 } })).status).toBe(400);
    expect((await bad('writing', { examples: Array.from({ length: 21 }, () => ({ input: 'a', output: 'b' })) })).status).toBe(400);
    expect((await bad('writing', { examples: [{ input: 'a'.repeat(4001), output: 'b' }] })).status).toBe(400);
    expect((await bad('writing', { examples: [{ id: 'bad id!', input: 'a', output: 'b' }] })).status).toBe(400);
    expect((await bad('writing', {})).status).toBe(400);
    const okImage = await bad('image', { modelConfiguration: { model: 'gpt-image-2', quality: 'high' } });
    expect(okImage.status).toBe(200);
    expect(okImage.body.data.modelConfiguration).toEqual({ model: 'gpt-image-2', quality: 'high' });
    const { rows } = await db.query(`select version from public.ai_workspace_ai_instructions where tool_type = 'writing_editing'`);
    expect(rows[0].version).toBe(2); // failed saves never bump
  });

  it('reset restores the default template and bumps the version', async () => {
    const res = await request(app).post('/api/v1/ai-instructions/writing/reset').set(A);
    expect(res.status).toBe(200);
    const d = DEFAULT_INSTRUCTIONS.writing_editing;
    expect(res.body.data).toMatchObject({
      version: 3,
      active: true,
      systemInstruction: d.systemInstruction,
      outputRules: d.outputRules,
      formatting: d.formatting,
      constraints: d.constraints,
      examples: [],
      modelConfiguration: {},
      isDefault: false,
    });
    const fresh = await request(app).post('/api/v1/ai-instructions/advertising_copy/reset').set(A);
    expect(fresh.body.data).toMatchObject({ toolId: 'advertising', version: 1 });
    const list = await request(app).get('/api/v1/ai-instructions').set(A);
    expect(list.body.data.map((i) => [i.toolId, i.isDefault])).toEqual([
      ['writing', false],
      ['image', false],
      ['advertising', false],
      ['vehicle', true],
    ]);
  });

  it('rejects outsiders', async () => {
    expect((await request(app).get('/api/v1/ai-instructions').set(authHeader(USERS.outsider))).status).toBe(403);
    expect((await request(app).post('/api/v1/ai-instructions/writing/reset').set(authHeader(USERS.inactive))).status).toBe(403);
  });
});
