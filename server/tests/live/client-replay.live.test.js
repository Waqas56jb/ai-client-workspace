import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeDb, createQaClient, dbRead, post, signIn, spendOpenAI, waitForGeneration, API } from './helpers/live.js';

/**
 * LIVE replay of the client's real conversations (recordings of 31 Oct and 1 Nov):
 *  1. "Can you convert a PDF to Word?" → PDF sent with no text → "I need it in an attachment."
 *  2. An email about project payments from their spreadsheet (figures must be exact and correctly labelled).
 * Real API, database and OpenAI. Run with QA_OPENAI_TEXT_BUDGET=60.
 */

/** A small valid PDF (text on one page per call of `pages`). */
function pdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null];
  const kids = [];
  for (const lines of pages) {
    const stream = lines.map((l, i) => `BT /F1 11 Tf 50 ${770 - i * 16} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
    const contentNo = objs.length + 2;
    kids.push(objs.length + 1);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNo} 0 R /Resources << /Font << /F1 FONT 0 R >> >> >>`);
    objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  const fontNo = objs.length + 1;
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o.replace('FONT', fontNo)}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const FORM = [
  [
    'Superannuation standard choice form',
    'Section A: Employee to complete',
    'Your name: ____________________',
    'Employee identification number: ____________',
    'Tax file number (TFN): ____________',
    'Option 1: My existing super fund. Fund ABN: ________  Fund USI: ________',
    'Option 2: A self-managed super fund (SMSF). Bank account BSB: ________',
    'Option 3: The super fund nominated by my employer (default fund).',
  ],
  ['Section B: Employer to complete', 'Business name: ____________', 'Employer ABN: ____________', 'Date you received the form: __/__/____', 'Keep this form for your records. Do not send it to the ATO.'],
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
  if (r.status === 200) return { status: 200, msg: r.data.assistantMessage, conversationId: r.data.conversation.id };
  if (r.status !== 202) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.error)}`);
  const done = await waitForGeneration(r.data.generationId);
  return { status: 202, msg: done.assistantMessage, done, conversationId: done.conversation.id };
}
async function docxText(messageId) {
  const s = await signIn('QA_MEMBER_A');
  const res = await fetch(`${API}/exports/docx?messageId=${messageId}`, { headers: { Authorization: `Bearer ${s.token}` } });
  expect(res.status).toBe(200);
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  return (await zip.file('word/document.xml').async('string')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

beforeAll(async () => {
  client = await createQaClient('Replay EV Auto');
  taskId = (await post('/assistant/session', { clientId: client.id })).data.taskId;
});
afterAll(closeDb);

describe('replay: PDF → Word (recording of 1 Nov)', () => {
  let conversationId;
  it('1. “Can you convert a PDF into Word?” — an honest yes', async () => {
    const r = await say({ prompt: 'If I send you a PDF document, are you able to convert it into Word for me?' }, 'can you convert');
    conversationId = r.conversationId;
    console.log('\n[1]', r.msg.content.slice(0, 400));
    expect(r.msg.content).toMatch(/yes|can/i);
    expect(r.msg.content).not.toMatch(/can.?t (attach|create|make|generate) (a )?(\.docx|word)/i);
  });

  it('2. the PDF arrives with no text → it is converted straight away, as a Word file, with every field', async () => {
    const f = await upload(pdf(FORM), 'Superannuation standard choice form.pdf', 'application/pdf');
    const r = await say({ conversationId, prompt: '', attachmentIds: [f.id] }, 'pdf no text');
    console.log('\n[2]', r.msg.content.slice(0, 600));
    expect(r.msg.exportAs).toBe('docx');
    expect(r.msg.content).not.toMatch(/what would you like (me )?to do/i);
    for (const s of ['Section A', 'Tax file number', 'Option 2', 'self-managed super fund', 'Section B', 'Employer ABN', 'Do not send it to the ATO']) expect(r.msg.content).toContain(s);
    const word = await docxText(r.msg.id);
    expect(word).toContain('Tax file number');
    expect(word).toContain('Employer ABN');
  });

  it('3. “I need it in an attachment.” → a Word file again, never “I can’t attach”', async () => {
    const r = await say({ conversationId, prompt: 'I need it in an attachment.' }, 'attachment');
    console.log('\n[3]', r.msg.content.slice(0, 300));
    expect(r.msg.content).not.toMatch(/can.?t (generate|attach|create|make)|cannot (generate|attach|create|make)|unable to (generate|attach|create)/i);
    expect(r.msg.exportAs).toBe('docx');
    expect(await docxText(r.msg.id)).toContain('Section B');
  });
});

describe('replay: payment email from a spreadsheet (recording of 31 Oct)', () => {
  it('figures are copied exactly and labelled correctly (2,764 is the remaining balance, not an overall total)', async () => {
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet('Sheet1');
    s.addRow(['Project Code', 'Project Name', 'Project Budget', 'Paid', 'Remaining']);
    s.addRow(['CFO', 'Cash Flow Optimizer', 400, 400, null]);
    s.addRow(['ERP', 'Business Management Platform', 2000, 200, 1800]);
    s.addRow(['EOS', 'Engineering Operating System', 1000, 436, 564]);
    s.addRow(['HRX', 'HOREXA Platform', 500, 100, 400]);
    s.addRow(['MFG', 'Manufacturing Platform']);
    s.getRow(15).values = ['Subscription', 'ClaudeAI', 100];
    s.getRow(22).values = [null, null, null, 'Total', 2764];
    const f = await upload(Buffer.from(await wb.xlsx.writeBuffer()), 'project_records.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const r = await say(
      { prompt: 'write client perfeshional email to Muhammad my client name i am waqas naveed let him know each project total price received payment and panding payment clearly with price values', attachmentIds: [f.id] },
      'payment email',
    );
    const [v] = await dbRead('select v.content from public.ai_workspace_outputs o join public.ai_workspace_output_versions v on v.id = o.current_version_id where o.id = $1', [r.done.outputs[0].id]);
    console.log('\n[email]\n', v.content);
    const t = v.content.replace(/,(?=\d{3})/g, '');
    for (const n of ['2000', '200', '1800', '1000', '436', '564', '500', '100', '400']) expect(t).toMatch(new RegExp(`\\b${n}\\b`));
    // 2764 may appear only as the outstanding/remaining/pending balance
    for (const m of t.matchAll(/[^\n]*\b2764\b[^\n]*/g)) expect(m[0]).toMatch(/remain|outstanding|pending|balance|due|owing/i);
    expect(t).not.toMatch(/overall total[^\n]*2764/i);
    expect(v.content).toMatch(/Waqas Naveed/);
    expect(v.content).toMatch(/Muhammad/);
  });
});

describe('replay: swim club refund email (recording of 2 Nov — compared with ChatGPT)', () => {
  it('a soft, complete email: real date, the sender’s role, no refusal, within 300 words, written by the writing model', async () => {
    const brief = `On the president of the Melbourne open water swimming club. Our biggest Swimming event of the year is on Melbourne Cup day which is tomorrow. Unfortunately due to the weather we had to reschedule our event. The rescheduling date is this Saturday the seventh. When people bought their tickets online, we mentioned that the rescheduling date, in case of whether was the seventh. I said this afternoon we made a call that the event would be postponed tomorrow as we could see the weather was gonna be bad and we reschedule it to Saturday. We're getting in in data with people now asking for refunds. It's not that we don't want to give a refund, but at the moment we're still concentrating on trying to get an event off the ground on Saturday. I don't want to burn people either and tell them they don't get a refund as down the track who's to say that we're not gonna have to reschedule this Saturday as well due to weather. Even though they're not necessarily entitled to a discount, we may offer them down the track the ability to change to one of our other events during the year as we have them on many occasions. I want to write an email that we can send to clients if they email us to ask us for a refund. I need it to be nice and softly toned but in a nice way to basically tell them look at this stage the event is scheduled for Saturday as per the conditions when they signed up. It doesn't mean to say down the track we might not look at giving a refund or a credit for other events but at this time we've just rescheduled the event and that's all we are concentrating on doing. We are a nonprofit organisation and work on a limited funds but more importantly work on limited resources. We understand that people might be doing a tough and want a refund however it's a bit like them stepping on our grave straight away if that makes sense. Please write me an email in 300 words or less to explain all this in a nice way to bye us some bit of time of one to 2 weeks. Does this make sense?`;
    const r = await say({ prompt: brief }, 'swim club refund email');
    expect(r.status).toBe(202);
    const [run] = await dbRead('select model from public.ai_workspace_generation_runs where id = $1', [r.done.id ?? r.done.generationId]);
    const [v] = await dbRead('select v.content from public.ai_workspace_outputs o join public.ai_workspace_output_versions v on v.id = o.current_version_id where o.id = $1', [r.done.outputs[0].id]);
    console.log(`\n[swim club — ${run?.model}]\n`, v.content);
    expect(run?.model).toBe('gpt-5.5');
    const text = v.content;
    expect(text).toMatch(/Saturday,? 7(th)? November/i); // the date is worked out, never "7 [month]"
    expect(text).not.toMatch(/\[month\]|\[date\]/i);
    expect(text).toMatch(/President/);
    expect(text).toMatch(/Melbourne Open Water Swimming Club/i);
    expect(text).toMatch(/not-for-profit|non-?profit/i);
    expect(text).toMatch(/(one|1)\s*(to|–|-)\s*(two|2) weeks/i);
    expect(text).toMatch(/credit|another (club )?event|other events/i);
    // what the client did NOT want: a refusal, or their private metaphor
    expect(text).not.toMatch(/not in a position to (process|offer|give)|not (currently )?processing refund|unable to (offer|give|process) (a )?refund|no refunds?/i);
    expect(text).not.toMatch(/grave/i);
    expect(text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(300);
  });
});
