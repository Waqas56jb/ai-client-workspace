import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { closeDb, createQaClient, dbRead, login, spendOpenAI, watchPage } from './helpers.js';

/**
 * Browser edge cases for the chat (real API, database and OpenAI — 3 text calls):
 * odd input, every file type through the real upload, broken files, folders,
 * paste and drag-and-drop, limits, script injection, reload while working,
 * rename / archive and the dark theme.
 */
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const JSZip = requireServer('jszip');
const ExcelJS = requireServer('exceljs');
const SHOTS = 'e2e/.results/edge';
test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));
test.afterAll(closeDb);

const T = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
async function docx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
async function pptx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>');
  zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0"?><p:sld xmlns:p="x" xmlns:a="y"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
async function xlsx() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('S').addRows([['A', 'B'], [1, 2]]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n186\n%%EOF',
  'latin1',
);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function pickClient(page, name) {
  await page.getByRole('button', { name: /^(choose a client|client: .*change client)$/i }).first().click();
  await page.getByRole('combobox').fill(name.slice(0, 20));
  await page.getByRole('option', { name }).click();
}
const chips = (page) => page.locator('ul[aria-label="Attached to this message"] > li');
const send = (page) => page.getByRole('button', { name: 'Send', exact: true });

test('typing: empty and blank cannot be sent; Shift+Enter is a new line; 8000 characters is the limit', async ({ page }) => {
  const client = await createQaClient(`Edge Typing ${Date.now().toString(36)}`);
  await login(page);
  await pickClient(page, client.name);
  await expect(send(page)).toBeDisabled();
  await page.locator('#chat-input').fill('     \n   ');
  await expect(send(page)).toBeDisabled();
  await page.locator('#chat-input').fill('line one');
  await page.locator('#chat-input').press('Shift+Enter');
  await page.locator('#chat-input').type('line two');
  await expect(page.locator('#chat-input')).toHaveValue('line one\nline two');
  await page.locator('#chat-input').fill('x'.repeat(9000));
  expect((await page.locator('#chat-input').inputValue()).length).toBe(8000);
});

test('every document type uploads through the browser and shows whether it was read', async ({ page }) => {
  test.setTimeout(180_000);
  const client = await createQaClient(`Edge Files ${Date.now().toString(36)}`);
  const problems = watchPage(page, { allow: [/415/, /files\/upload/] });
  await login(page);
  await pickClient(page, client.name);
  const input = page.getByTestId('chat-file-input');
  const files = [
    { name: 'policy.docx', mimeType: T.docx, buffer: await docx('Policy text') },
    { name: 'sheet.xlsx', mimeType: T.xlsx, buffer: await xlsx() },
    { name: 'deck.pptx', mimeType: T.pptx, buffer: await pptx('Slide text') },
    { name: 'scan.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2') },
    { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') },
    { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
  ];
  await input.setInputFiles(files);
  await expect(chips(page)).toHaveCount(files.length);
  await expect(page.getByText(/Uploading/)).toHaveCount(0, { timeout: 90_000 });
  for (const f of files) {
    const chip = chips(page).filter({ hasText: f.name });
    // ready (read), or — only if the server cannot store that type yet — a clear message, never a silent failure
    await expect(chip).toContainText(/ready to send|Read|can.?t be stored yet/i);
  }
  await page.screenshot({ path: `${SHOTS}/1-all-types.png` });
  expect(problems.filter((p) => !/415/.test(p))).toEqual([]);
});

test('broken, fake and unsupported files are explained in the chip; removing them unblocks sending', async ({ page }) => {
  const client = await createQaClient(`Edge Bad ${Date.now().toString(36)}`);
  await login(page);
  await pickClient(page, client.name);
  const input = page.getByTestId('chat-file-input');
  await input.setInputFiles([
    { name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') },
    { name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
    { name: 'fake.docx', mimeType: T.docx, buffer: PNG }, // passes the browser check, refused by the server
  ]);
  await expect(chips(page).filter({ hasText: 'archive.zip' })).toContainText(/not a file type we accept/);
  await expect(chips(page).filter({ hasText: 'evil.svg' })).toContainText(/not a file type we accept/);
  await expect(chips(page).filter({ hasText: 'fake.docx' })).toContainText(/does not match|Upload failed|not supported/i, { timeout: 30_000 });
  await page.locator('#chat-input').fill('hello');
  await expect(send(page)).toBeDisabled(); // a failed upload must be retried or removed first
  await chips(page).filter({ hasText: 'fake.docx' }).getByRole('button', { name: /Remove/ }).click();
  await expect(send(page)).toBeEnabled();
});

test('a folder with mixed files adds only the usable ones; more than 20 files is refused politely', async ({ page }) => {
  const client = await createQaClient(`Edge Folder ${Date.now().toString(36)}`);
  await login(page);
  await pickClient(page, client.name);
  // a real folder on disk (the folder picker only accepts a directory)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-folder-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.writeFileSync(path.join(dir, 'b.csv'), 'x,y');
  fs.writeFileSync(path.join(dir, 'setup.exe'), 'MZ');
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
  await page.getByTestId('chat-folder-input').setInputFiles(dir);
  await expect(page.getByText(/can.?t be used here and (was|were) skipped/)).toBeVisible();
  await expect(chips(page)).toHaveCount(2);
  await page.getByRole('button', { name: /Remove a\.txt/ }).click();
  await page.getByRole('button', { name: /Remove b\.csv/ }).click();

  const many = Array.from({ length: 21 }, (_, i) => ({ name: `n${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from(String(i)) }));
  await page.getByTestId('chat-file-input').setInputFiles(many);
  await expect(page.getByText('You can add up to 20 files to one message.')).toBeVisible();
});

test('paste and drag-and-drop add a picture', async ({ page }) => {
  const client = await createQaClient(`Edge Paste ${Date.now().toString(36)}`);
  await login(page);
  await pickClient(page, client.name);
  await page.locator('#chat-input').focus();
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    document.querySelector('#chat-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG.toString('base64'));
  await expect(chips(page).filter({ hasText: 'pasted.png' })).toBeVisible();
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    const main = document.querySelector('main');
    for (const type of ['dragenter', 'dragover', 'drop']) main.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, PNG.toString('base64'));
  await expect(chips(page).filter({ hasText: 'dropped.png' })).toBeVisible();
  await expect(page.getByText(/ready to send/i)).toHaveCount(2, { timeout: 60_000 });
});

test('script in a message is shown as text; code answers are formatted; reload while thinking keeps the answer', async ({ page }) => {
  test.setTimeout(300_000);
  const client = await createQaClient(`Edge XSS ${Date.now().toString(36)}`);
  let dialog = false;
  page.on('dialog', async (d) => {
    dialog = true;
    await d.dismiss();
  });
  await login(page);
  await pickClient(page, client.name);
  const evil = '<img src=x onerror="alert(1)"> <script>alert(2)</script> What is 2+2?';
  await page.locator('#chat-input').fill(evil);
  spendOpenAI('text', 'edge xss');
  await send(page).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const conversationId = page.url().split('/').pop();
  await expect(page.getByText(evil)).toBeVisible(); // shown literally
  // reload while the answer is being made: the status comes back and the answer still arrives
  await page.reload();
  const count = () => dbRead(`select count(*)::int n from public.ai_workspace_messages where conversation_id = $1 and role = 'assistant'`, [conversationId]);
  await expect.poll(async () => (await count())[0].n, { timeout: 120_000 }).toBe(1);
  await expect(page.getByText(/\b4\b|four/i).first()).toBeVisible({ timeout: 60_000 });
  expect(dialog).toBe(false);
  expect(await page.locator('img[src="x"]').count()).toBe(0);

  await page.locator('#chat-input').fill('Write a 3-line JavaScript function that adds two numbers. Show only the code in a code block.');
  spendOpenAI('text', 'edge code');
  await send(page).click();
  await expect.poll(async () => (await count())[0].n, { timeout: 120_000 }).toBe(2);
  await expect(page.locator('pre code').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('pre code').first()).toContainText(/function|=>/);
  await page.screenshot({ path: `${SHOTS}/2-code.png` });

  // rename and archive from the chat menu
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('menuitem', { name: 'Rename chat' }).click();
  await page.getByLabel('Chat name').fill('Renamed edge chat');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('header').getByText('Renamed edge chat')).toBeVisible();
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('menuitem', { name: 'Archive chat' }).click();
  await expect(page).toHaveURL(/\/$/);
  const [conv] = await dbRead('select archived_at, title from public.ai_workspace_conversations where id = $1', [conversationId]);
  expect(conv.title).toBe('Renamed edge chat');
  expect(conv.archived_at).not.toBeNull();
});

test('dark theme from the More menu, and it survives a reload', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /^More$/ }).click();
  await page.getByRole('menuitem', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `${SHOTS}/3-dark.png` });
  await page.getByRole('button', { name: /^More$/ }).click();
  await page.getByRole('menuitem', { name: 'Light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
