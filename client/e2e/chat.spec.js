import { createRequire } from 'node:module';
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { closeDb, createQaClient, dbRead, login, spendOpenAI, watchPage } from './helpers.js';

/**
 * The chat workspace end to end — real API, real database, real OpenAI
 * (4 text calls, 3 image calls). Every AI result is checked in the database too.
 */
const SHOTS = 'e2e/.results/chat';
test.afterAll(closeDb);
test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

async function pickClient(page, name) {
  await page.getByRole('button', { name: /^(choose a client|client: .*change client)$/i }).first().click();
  await page.getByRole('combobox').fill(name.slice(0, 20));
  await page.getByRole('option', { name }).click();
}
const activeMessages = (conversationId) =>
  dbRead(
    `select role, content, metadata from public.ai_workspace_messages
      where conversation_id = $1 and role <> 'system' and metadata ->> 'supersededAt' is null order by created_at`,
    [conversationId],
  );

test('write → quick change → approve → reload → edit an earlier message → find it in history', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const client = await createQaClient(`Chat Write ${Date.now().toString(36)}`, { brand: { tone: 'Friendly' } });
  const problems = watchPage(page);
  await login(page);

  // A — start: nothing can be sent without a client
  await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();
  await expect(page.getByText('Choose the client first.')).toBeVisible();
  await pickClient(page, client.name);
  await expect(page.locator('header').getByText(client.name)).toBeVisible();

  await page.locator('[data-options-trigger]').click();
  await page.getByRole('radio', { name: 'Email' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const draft = 'hi john, just checkin in about the googel ads campain. we can start next monday if u approve the $1,200 budget. let me no.';
  await page.locator('#chat-input').fill(draft);
  spendOpenAI('text', 'chat improve email');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const conversationId = page.url().split('/').pop();
  await expect(page.locator('#chat-input')).toHaveValue(''); // cleared only after the server accepted it
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(1, { timeout: 180_000 });
  await page.screenshot({ path: `${SHOTS}/1-answer.png` });
  let msgs = await activeMessages(conversationId);
  expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);

  // quick change uses the chat memory
  spendOpenAI('text', 'chat shorter');
  await page.getByRole('button', { name: 'Shorter' }).click();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(2, { timeout: 180_000 });
  const outs = await dbRead(
    `select o.id, v.content from public.ai_workspace_outputs o join public.ai_workspace_output_versions v on v.id = o.current_version_id where o.conversation_id = $1 order by o.created_at`,
    [conversationId],
  );
  expect(outs).toHaveLength(2);
  expect(outs[1].content).toContain('1,200');

  // approve the shorter one, reload, still approved
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
  await page.getByRole('button', { name: 'Approve version' }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const [approved] = await dbRead('select approved_version_id from public.ai_workspace_outputs where id = $1', [outs[1].id]);
  expect(approved.approved_version_id).toBeTruthy();

  // C — edit the first message: the later turns are hidden, the AI answers again
  const firstBubble = page.locator('li', { hasText: 'googel ads campain' }).first();
  await firstBubble.hover();
  await firstBubble.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Change your message').fill('Write a short email to John: the Google Ads campaign can start next Monday once he approves the $1,500 budget.');
  spendOpenAI('text', 'chat edited message');
  await page.getByRole('button', { name: 'Save & send' }).click();
  await expect(page.getByText('Edited', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(1, { timeout: 180_000 });
  await expect(page.getByText('googel ads campain')).toHaveCount(0);
  msgs = await activeMessages(conversationId);
  expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  expect(msgs[0].metadata.replacesMessageId).toBeTruthy();
  const [latest] = await dbRead(
    `select v.content from public.ai_workspace_outputs o join public.ai_workspace_output_versions v on v.id = o.current_version_id where o.conversation_id = $1 order by o.created_at desc limit 1`,
    [conversationId],
  );
  expect(latest.content).toContain('1,500');
  expect(latest.content).not.toContain('1,200');
  // nothing was deleted: the approved draft is still approved
  const [still] = await dbRead('select approved_version_id from public.ai_workspace_outputs where id = $1', [outs[1].id]);
  expect(still.approved_version_id).toBe(approved.approved_version_id);
  await page.screenshot({ path: `${SHOTS}/2-edited.png` });

  // E — history: search by a word, then by today's date
  await page.getByPlaceholder('Search chats').fill('Google Ads');
  await expect(page.getByRole('navigation', { name: 'Chat history' }).locator(`a[href="/chat/${conversationId}"]`)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Find by date' }).click();
  const d = new Date();
  await page.locator('input[type="date"]').fill(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  await page.getByRole('button', { name: 'Show chats' }).click();
  await expect(page.getByRole('navigation', { name: 'Chat history' }).locator(`a[href="/chat/${conversationId}"]`)).toBeVisible();
  expect(problems).toEqual([]);
});

test('photo: friendly upload errors → upload → edit → “Edit this image” → “use Image 1”', async ({ page }) => {
  test.setTimeout(700_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const client = await createQaClient(`Chat Photo ${Date.now().toString(36)}`);
  const problems = watchPage(page);
  await login(page);
  await pickClient(page, client.name);
  const input = page.getByTestId('chat-file-input');

  // F — HEIC and too-big files are explained, never uploaded
  await input.setInputFiles({ name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('not really a heic') });
  await expect(page.getByText('This is an iPhone HEIC photo. Please save it as JPG and add it again.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove IMG_0001.heic' }).click();
  await input.setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(16 * 1024 * 1024, 1) });
  await expect(page.getByText(/File is bigger than 15 MB/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove huge.jpg' }).click();

  // B — a real photo: thumbnail, "Ready to send", then the picture
  const photo = await page.screenshot({ type: 'png', clip: { x: 300, y: 0, width: 640, height: 640 } });
  await input.setInputFiles({ name: 'background.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByText(/Ready to send/)).toBeVisible({ timeout: 60_000 });
  await page.locator('#chat-input').fill('Turn my photo into a soft pastel illustration, keep the layout, no new text');
  spendOpenAI('image', 'chat photo edit');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const conversationId = page.url().split('/').pop();
  await expect(page.getByRole('button', { name: 'Edit this image' })).toHaveCount(1, { timeout: 240_000 });
  await expect(page.getByText('Image 1', { exact: true })).toBeVisible(); // the uploaded photo
  await expect(page.locator('article[aria-label^="Image 2"]')).toBeVisible(); // the result
  const [upload] = await dbRead(`select id from public.ai_workspace_files where client_id = $1 and source_type <> 'generated'`, [client.id]);
  let [run] = await dbRead(`select request_options from public.ai_workspace_generation_runs where conversation_id = $1 order by started_at desc limit 1`, [conversationId]);
  expect(run.request_options.mode).toBe('photo_edit'); // understood as an edit of the photo, not a new picture
  expect(run.request_options.imageInputs[0]).toMatchObject({ fileId: upload.id, role: 'source' }); // the photo really reached the AI
  await page.screenshot({ path: `${SHOTS}/3-photo-result.png` });

  // "Edit this image" → the exact picture is attached as a visible chip
  await page.getByRole('button', { name: 'Edit this image' }).click();
  await expect(page.getByText('Using Image 2')).toBeVisible();
  await page.locator('#chat-input').fill('Make the sky pink');
  spendOpenAI('image', 'chat edit this image');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('article[aria-label^="Image 3"]')).toBeVisible({ timeout: 240_000 });
  const outputs = await dbRead(`select id from public.ai_workspace_outputs where conversation_id = $1`, [conversationId]);
  expect(outputs).toHaveLength(1); // a new version of the same picture, not a new picture
  const versions = await dbRead(`select id, version_number from public.ai_workspace_output_versions where output_id = $1 order by version_number`, [outputs[0].id]);
  expect(versions.map((v) => v.version_number)).toEqual([1, 2]);
  [run] = await dbRead(`select request_options from public.ai_workspace_generation_runs where conversation_id = $1 order by started_at desc limit 1`, [conversationId]);
  expect(run.request_options).toMatchObject({ mode: 'image_edit', targetOutputId: outputs[0].id, sourceVersionId: versions[0].id });
  // Image 2 still shows version 1; Image 3 shows version 2
  await expect(page.locator('article[aria-label^="Image 2"]')).toContainText('v1');
  await expect(page.locator('article[aria-label^="Image 3"]')).toContainText('v2');

  // D — "use Image 1" picks the uploaded photo, shown before sending
  await page.locator('#chat-input').fill('Use Image 1 and add a thin gold frame');
  await expect(page.getByText('Using Image 1')).toBeVisible();
  spendOpenAI('image', 'chat use image 1');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('article[aria-label^="Image 4"]')).toBeVisible({ timeout: 240_000 });
  [run] = await dbRead(`select request_options from public.ai_workspace_generation_runs where conversation_id = $1 order by started_at desc limit 1`, [conversationId]);
  expect(run.request_options.mode).toBe('photo_edit');
  expect(run.request_options.imageInputs[0].fileId).toBe(upload.id);
  await page.screenshot({ path: `${SHOTS}/4-image-refs.png` });
  expect(problems).toEqual([]);
});

test('a plain question gets a plain answer in the chat (no draft, no picture)', async ({ page }) => {
  test.setTimeout(240_000);
  const client = await createQaClient(`Chat Ask ${Date.now().toString(36)}`);
  const problems = watchPage(page);
  await login(page);
  await pickClient(page, client.name);
  await page.locator('#chat-input').fill('What is artificial intelligence? Answer in two sentences.');
  spendOpenAI('text', 'chat question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const conversationId = page.url().split('/').pop();
  await expect(page.getByRole('button', { name: 'Copy', exact: true }).last()).toBeVisible({ timeout: 120_000 });
  const answer = () => dbRead(`select content, metadata from public.ai_workspace_messages where conversation_id = $1 and role = 'assistant' order by created_at desc limit 1`, [conversationId]);
  await expect.poll(async () => (await answer()).length, { timeout: 120_000 }).toBe(1);
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  const [m] = await answer();
  expect(m.metadata.intent).toBe('answer');
  const firstWords = m.content.replace(/[*`#]/g, '').split('\n')[0].slice(0, 30);
  await expect(page.getByText(firstWords).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/0-answer.png` });
  expect(problems).toEqual([]);
});

test('a Word document: upload shows it was read, and a question about it is answered from its text', async ({ page }) => {
  test.setTimeout(240_000);
  const JSZip = createRequire(import.meta.url)('../../server/node_modules/jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Staff uniform policy: all sales staff wear the navy EV Auto polo shirt from 1 December.</w:t></w:r></w:p></w:body></w:document>');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const client = await createQaClient(`Chat Doc ${Date.now().toString(36)}`);
  const problems = watchPage(page);
  await login(page);
  await pickClient(page, client.name);
  await page.getByTestId('chat-file-input').setInputFiles({ name: 'uniform-policy.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  await expect(page.getByText(/Read · ready to send/)).toBeVisible({ timeout: 60_000 });
  await page.locator('#chat-input').fill('What does this document say, and from when?');
  spendOpenAI('text', 'chat docx question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const conversationId = page.url().split('/').pop();
  const answer = () => dbRead(`select content, metadata from public.ai_workspace_messages where conversation_id = $1 and role = 'assistant' order by created_at desc limit 1`, [conversationId]);
  await expect.poll(async () => (await answer()).length, { timeout: 120_000 }).toBe(1);
  const [m] = await answer();
  expect(m.metadata.intent).toBe('answer');
  expect(m.content).toMatch(/navy/i);
  expect(m.content).toMatch(/1 December/i);
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/6-docx-answer.png` });
  expect(problems).toEqual([]);
});

test('client isolation: switching client clears the draft and files (no AI call)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const a = await createQaClient(`Chat Iso A ${Date.now().toString(36)}`);
  const b = await createQaClient(`Chat Iso B ${Date.now().toString(36)}`);
  await login(page);
  await pickClient(page, a.name);
  await page.getByTestId('chat-file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Private notes for client A') });
  await expect(page.getByText(/ready to send/i)).toBeVisible({ timeout: 60_000 });
  await page.locator('#chat-input').fill('Private draft for A');
  await pickClient(page, b.name);
  await page.getByRole('button', { name: 'Yes, start new chat' }).click();
  await expect(page.locator('header').getByText(b.name)).toBeVisible();
  await expect(page.locator('#chat-input')).toHaveValue('');
  await expect(page.getByText('notes.txt')).toHaveCount(0);
});

test('mobile: drawer, client and composer fit a 390px screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: 'Open menu and chat history' }).click();
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add photo or file' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${SHOTS}/5-mobile.png` });
});
