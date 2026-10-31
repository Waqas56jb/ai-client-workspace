import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';
import { aiLimiter } from '../../src/middleware/rateLimiter.js';
import { waitForIdle } from '../../src/jobs/generationQueue.js';
import { extractDocument, DOCX, XLSX, PPTX } from '../../src/services/documents.service.js';
import { maybeSummarise } from '../../src/services/ai/memory.service.js';

/**
 * Documents (Word, Excel, PowerPoint, CSV) are really read and given to the AI;
 * earlier files of a chat stay usable; the assistant remembers client facts and
 * summarises long chats. The fake OpenAI records exactly what each model received.
 */

const ids = { ev: 'a7000000-0000-4000-8000-000000000001', other: 'a7100000-0000-4000-8000-000000000001' };
const A = authHeader(USERS.amelia);
const calls = { router: [], text: [] };
const blank = { summary: '', writing_format: 'unknown', source_image: null, reference_images: [], look_at_images: [], use_files: [], change: '', preserve: [], edit_scope: 'local', use_brand_style: false, width: null, height: null, question: null, limitation: null, remember: [], forget: [] };
const fake = { route: () => ({ ...blank, action: 'answer' }) };
const openai = {
  responses: {
    create: async (params) => {
      if (params.text?.format?.name === 'route') {
        calls.router.push(params);
        return { id: 'r', status: 'completed', output_text: JSON.stringify(fake.route(params)), usage: {} };
      }
      calls.text.push(params);
      const summary = /running summary of a long chat/.test(params.instructions || '');
      return { id: 't', model: params.model, status: 'completed', output_text: summary ? 'Original goal: plan the open day.' : 'Here is my answer.', usage: {} };
    },
  },
  images: { generate: async () => ({ data: [] }), edit: async () => ({ data: [] }) },
};

async function docx(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
async function xlsx() {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Q3 Sales');
  s.addRow(['Model', 'Units', 'Revenue']);
  s.addRow(['EV Hatch', 42, 1260000]);
  s.addRow(['EV SUV', 57, 2850000]);
  s.addRow(['Total', { formula: 'B2+B3', result: 99 }, { formula: 'C2+C3', result: 4110000 }]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function pptx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>');
  zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
  const slide = (t) => `<?xml version="1.0"?><p:sld xmlns:p="x" xmlns:a="y"><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
  zip.file('ppt/slides/slide2.xml', slide('Pricing &amp; offers'));
  zip.file('ppt/slides/slide1.xml', slide('Open day plan'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

let app;
let db;
let taskId;
beforeAll(async () => {
  ({ app, db } = await createTestContext({ openai }));
  await db.query(`insert into public.ai_workspace_clients (id, name, slug, status) values ($1, 'EV Auto', 'ev-auto', 'active'), ($2, 'Other Co', 'other-co', 'active')`, [ids.ev, ids.other]);
  taskId = (await request(app).post('/api/v1/assistant/session').set(A).send({ clientId: ids.ev })).body.data.taskId;
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
const upload = async (buffer, filename, contentType, task = taskId, clientId = ids.ev) =>
  request(app).post('/api/v1/files/upload').set(A).field('clientId', clientId).field('taskId', task).field('category', 'attachment').attach('file', buffer, { filename, contentType });
const say = (body, task = taskId) => request(app).post('/api/v1/ai/assistant/message').set(A).send({ taskId: task, ...body });
const lastText = () => JSON.stringify(calls.text.at(-1).input);
const routerText = () => calls.router.at(-1).input[0].content[0].text;

describe('reading documents', () => {
  it('Word, Excel (with formulas), PowerPoint (slides in order) and CSV become text; old formats and damaged files are honest', async () => {
    const w = await extractDocument(await docx(['Employment application', 'Section 4: medical history']), DOCX);
    expect(w).toMatchObject({ status: 'ok' });
    expect(w.text).toContain('Section 4: medical history');
    const x = await extractDocument(await xlsx(), XLSX);
    expect(x.text).toMatch(/### Sheet “Q3 Sales”/);
    expect(x.text).toMatch(/EV SUV\t57\t2850000/);
    expect(x.text).toMatch(/Total\t99\t4110000/);
    const p = await extractDocument(await pptx(), PPTX);
    expect(p.text.indexOf('Slide 1')).toBeLessThan(p.text.indexOf('Slide 2'));
    expect(p.text).toContain('Pricing & offers');
    expect((await extractDocument(Buffer.from('a,b\n1,2'), 'text/csv')).text).toBe('a,b\n1,2');
    expect(await extractDocument(Buffer.from('x'), 'application/msword')).toMatchObject({ status: 'unsupported', error: expect.stringMatching(/save it as \.docx/) });
    expect(await extractDocument(Buffer.from('not a zip'), DOCX)).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not be opened/) });
  });

  it('upload records whether the document could be read', async () => {
    const res = await upload(await pptx(), 'plan.pptx', PPTX);
    expect(res.status).toBe(201);
    expect(res.body.data.extract).toMatchObject({ status: 'ok', parts: [{ label: 'Slide 1' }, { label: 'Slide 2' }] });
  });
});

describe('the HR document from the client recording', () => {
  let conversationId;
  let fileId;
  it('a question about an uploaded .docx is answered from its real text (no format question, no draft)', async () => {
    fileId = (await upload(await docx(['EV GROUP Employment and Medical Background Application', 'Q12: List any medical conditions.']), 'OCT26 EV GROUP Employment.docx', DOCX)).body.data.id;
    fake.route = () => ({ ...blank, action: 'answer', use_files: [1] });
    const res = await say({ prompt: 'Can you please explain what the document is and the advantages and disadvantages of using it?', attachmentIds: [fileId] });
    expect(res.status).toBe(202);
    const done = await poll(res.body.data.generationId);
    conversationId = done.conversation.id;
    expect(done.outputs).toEqual([]); // a chat answer, not an approvable draft
    expect(routerText()).toContain('File 1 — Word document “OCT26 EV GROUP Employment.docx” (added with THIS message): read');
    expect(routerText()).toContain('Q12: List any medical conditions.'); // the router saw the start of the document
    expect(lastText()).toContain('Q12: List any medical conditions.'); // the answer model got the real text
    expect(calls.text.at(-1).instructions).toMatch(/HR, medical, legal or financial documents/);
  });

  it('later: “write an email to staff about this form” uses the earlier file without re-attaching it', async () => {
    fake.route = () => ({ ...blank, action: 'write', writing_format: 'email', use_files: [1] });
    const res = await say({ conversationId, prompt: 'Now write an email to staff explaining the new form.' });
    const done = await poll(res.body.data.generationId);
    expect(done.outputs[0].format).toBe('email');
    expect(lastText()).toContain('Q12: List any medical conditions.');
    expect(done.userMessage.attachmentIds).toEqual([]); // shown once, where it was added
    const { rows } = await db.query('select request_options from public.ai_workspace_generation_runs where id = $1', [res.body.data.generationId]);
    expect(rows[0].request_options.attachmentIds).toEqual([fileId]);
  });

  it('a spreadsheet question gets the sheet data', async () => {
    const x = (await upload(await xlsx(), 'sales.xlsx', XLSX)).body.data.id;
    fake.route = () => ({ ...blank, action: 'answer', use_files: [2] });
    const res = await say({ conversationId, prompt: 'Which model sold best?', attachmentIds: [x] });
    await poll(res.body.data.generationId);
    expect(lastText()).toContain('EV SUV\\t57\\t2850000');
  });
});

describe('client memory', () => {
  it('a fact the user states is remembered for that client only, can be listed, used, and forgotten', async () => {
    fake.route = () => ({ ...blank, action: 'answer', remember: [{ category: 'person', fact: 'Sarah is the HR Manager at EV Auto and signs emails as “Sarah, HR Manager”.' }] });
    const res = await say({ prompt: 'I am Sarah, the HR manager. Please sign my emails as “Sarah, HR Manager”.' });
    expect(res.body.data.memoryUpdates).toEqual({ added: ['Sarah is the HR Manager at EV Auto and signs emails as “Sarah, HR Manager”.'], removed: [] });
    await poll(res.body.data.generationId);
    const list = (await request(app).get(`/api/v1/clients/${ids.ev}/memories`).set(A)).body.data;
    expect(list).toHaveLength(1);

    fake.route = () => ({ ...blank, action: 'answer' });
    const next = await say({ prompt: 'Draft a quick note to the team.' });
    await poll(next.body.data.generationId);
    expect(routerText()).toContain('Memory 1: Sarah is the HR Manager');
    expect(lastText()).toContain('Remembered about this client');

    // never in another client's chat
    const otherTask = (await request(app).post('/api/v1/assistant/session').set(A).send({ clientId: ids.other })).body.data.taskId;
    const o = await say({ prompt: 'Hello' }, otherTask);
    await poll(o.body.data.generationId);
    expect(routerText()).toContain('Remembered about this client: nothing yet');
    expect(lastText()).not.toContain('Sarah');

    fake.route = () => ({ ...blank, action: 'answer', forget: [1] });
    const f = await say({ prompt: 'Forget what I said about signing emails.' });
    expect(f.body.data.memoryUpdates.removed).toHaveLength(1);
    await poll(f.body.data.generationId);
    expect((await request(app).get(`/api/v1/clients/${ids.ev}/memories`).set(A)).body.data).toEqual([]);
  });

  it('the team can add and delete memories by hand; duplicates are refused', async () => {
    const add = await request(app).post(`/api/v1/clients/${ids.ev}/memories`).set(A).send({ fact: 'Prices always include GST.' });
    expect(add.status).toBe(201);
    expect((await request(app).post(`/api/v1/clients/${ids.ev}/memories`).set(A).send({ fact: '  prices always include  GST. ' })).status).toBe(400);
    expect((await request(app).delete(`/api/v1/clients/${ids.ev}/memories/${add.body.data.id}`).set(A)).status).toBe(200);
  });
});

describe('long chats', () => {
  it('when a chat passes the memory window, the older part is summarised and used', async () => {
    fake.route = () => ({ ...blank, action: 'answer' });
    const first = await say({ prompt: 'Let us plan the EV Auto open day on 14 November.' });
    const conversationId = (await poll(first.body.data.generationId)).conversation.id;
    // 52 more messages straight into the database (the API path is covered above)
    for (let i = 0; i < 26; i += 1) {
      await db.query(`insert into public.ai_workspace_messages (conversation_id, role, content, message_type, metadata, created_at) values ($1, 'user', $2, 'prompt', '{}', clock_timestamp()), ($1, 'assistant', 'ok', 'response', '{}', clock_timestamp())`, [conversationId, `detail ${i}`]);
    }
    await maybeSummarise(conversationId, USERS.amelia.id);
    const { rows } = await db.query(`select content, metadata from public.ai_workspace_messages where conversation_id = $1 and role = 'system'`, [conversationId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.kind).toBe('summary');
    // nothing visible in the chat
    const visible = (await request(app).get(`/api/v1/conversations/${conversationId}/messages?limit=200`).set(A)).body.data;
    expect(visible.some((m) => m.role === 'system')).toBe(false);

    const res = await say({ conversationId, prompt: 'What date did we pick?' });
    await poll(res.body.data.generationId);
    expect(routerText()).toContain('Summary of the earlier part of this chat:\nOriginal goal: plan the open day.');
    expect(lastText()).toContain('(Summary of the earlier part of this chat)');
    expect(lastText()).toContain('(First request in this chat) Let us plan the EV Auto open day on 14 November.');
  });
});
