import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeDb, createQaClient, dbRead, post, spendOpenAI, waitForGeneration } from './helpers/live.js';

/**
 * LIVE: documents in the chat with real OpenAI — the exact case from the client's
 * screen recording (an HR manager asks what a Word form is, with pros and cons),
 * a spreadsheet question, and an email written later from the same document.
 *   QA_OPENAI_TEXT_BUDGET=40 npx vitest run -c vitest.live.config.js tests/live/documents.live.test.js
 */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function docx(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;')}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const HR_FORM = [
  'EV GROUP — Employment and Medical Background Application (online use)',
  'Section 1: Personal details — full name, date of birth, address, phone, email.',
  'Section 2: Employment history — last three employers, reasons for leaving, referees.',
  'Section 3: Licences — current driver licence class and any suspensions in the last 5 years.',
  'Section 4: Medical background — list any pre-existing injuries or medical conditions, medications, previous workers compensation claims, and whether you can perform heavy lifting.',
  'Section 5: Declaration — I consent to EV GROUP contacting my doctors and previous employers. False information may lead to termination.',
  'Completed forms are emailed to hr@evgroup.example and kept on file indefinitely.',
];

let client;
let taskId;
async function upload(buffer, name, type) {
  const form = new FormData();
  form.append('clientId', client.id);
  form.append('taskId', taskId);
  form.append('category', 'attachment');
  form.append('file', new Blob([buffer], { type }), name);
  const r = await api('POST', '/files/upload', { form });
  if (r.status !== 201) throw new Error(`upload ${r.status} ${JSON.stringify(r.error)}`);
  return r.data;
}
async function say(body, label) {
  spendOpenAI('text', `router: ${label}`);
  spendOpenAI('text', label);
  const r = await post('/ai/assistant/message', { taskId, ...body });
  if (![200, 202].includes(r.status)) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.error)}`);
  if (r.status === 200) return { reply: r.data };
  const done = await waitForGeneration(r.data.generationId);
  const [run] = await dbRead('select request_options from public.ai_workspace_generation_runs where id = $1', [r.data.generationId]);
  return { done, run };
}

beforeAll(async () => {
  client = await createQaClient('Docs EV Auto');
  taskId = (await post('/assistant/session', { clientId: client.id })).data.taskId;
});
afterAll(closeDb);

describe('live documents', () => {
  let conversationId;
  let form;

  it('the client’s case: “explain this Word document, advantages and disadvantages” → a real answer from its text', async () => {
    form = await upload(await docx(HR_FORM), 'OCT26 EV GROUP Employment and Medical Background Application online use.docx', DOCX);
    expect(form.extract).toMatchObject({ status: 'ok' });
    const { done, run } = await say(
      {
        prompt: "I'm a HR manager in Automotive retail business. My boss just sent me this document and wants me to use it. Can you please explain what the document is and what the advantages and disadvantages of using it are?",
        attachmentIds: [form.id],
      },
      'hr docx',
    );
    conversationId = done.conversation.id;
    expect(run.request_options.mode).toBe('answer');
    expect(done.outputs).toEqual([]);
    const text = done.assistantMessage.content;
    console.log('\n--- HR answer ---\n', text, '\n---');
    expect(text).not.toMatch(/email, an SMS or a WhatsApp/i);
    expect(text).not.toMatch(/need to see the document|paste the text|upload it/i);
    expect(text).toMatch(/medical/i);
    expect(text).toMatch(/advantage|benefit/i);
    expect(text).toMatch(/disadvantage|risk/i);
    expect(text).toMatch(/privacy|consent|discriminat/i);
  });

  it('a spreadsheet question is answered from the sheet data', async () => {
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet('Q3 Sales');
    s.addRows([['Model', 'Units sold', 'Revenue AUD'], ['EV Hatch', 42, 1260000], ['EV SUV', 57, 2850000], ['EV Ute', 18, 1170000]]);
    const sheet = await upload(Buffer.from(await wb.xlsx.writeBuffer()), 'q3-sales.xlsx', XLSX);
    const { done, run } = await say({ conversationId, prompt: 'Which model sold the most units last quarter, and how much revenue did it bring in?', attachmentIds: [sheet.id] }, 'xlsx');
    expect(run.request_options.mode).toBe('answer');
    expect(done.assistantMessage.content).toMatch(/EV SUV/);
    expect(done.assistantMessage.content).toMatch(/57/);
    expect(done.assistantMessage.content.replace(/[,\s]/g, '')).toMatch(/2850000|2\.85(million|m)/i);
  });

  it('later, “write an email to staff about this form” writes an email from the earlier document', async () => {
    const { done, run } = await say({ conversationId, prompt: 'Now write a short email to our sales staff explaining that they need to fill in the new form from my boss.' }, 'email from doc');
    expect(run.request_options.mode).toBe('generate');
    expect(run.request_options.attachmentIds).toContain(form.id); // the earlier document was used
    expect(done.outputs[0].format).toBe('email');
    const [v] = await dbRead('select v.content from public.ai_workspace_outputs o join public.ai_workspace_output_versions v on v.id = o.current_version_id where o.id = $1', [done.outputs[0].id]);
    console.log('\n--- email ---\n', v.content, '\n---');
    expect(v.content).toMatch(/form|application/i);
    expect(done.userMessage.attachmentIds).toEqual([]);
  });
});
