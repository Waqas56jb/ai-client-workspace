import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { closeDb, createQaClient, dbRead, login, spendOpenAI, watchPage } from './helpers.js';

/**
 * AI Assistant end to end (real API, real database, real OpenAI — 2 text calls):
 * start a chat with just a client, improve a pasted email, use a quick change
 * that relies on conversation memory, then find the chat in the date-grouped history.
 */
const SHOTS = 'e2e/.results/assistant';
test.afterAll(closeDb);

test('write → quick change (memory) → chat history by date', async ({ page }) => {
  test.setTimeout(400_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 940 });
  const client = await createQaClient(`Assistant ${Date.now().toString(36)}`, { brand: { tone: 'Friendly', phone: '0400 111 222' } });
  const problems = watchPage(page);
  await login(page);

  // 1. Start screen
  await page.goto('/assistant');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await page.screenshot({ path: `${SHOTS}/1-home.png` });
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('alert')).toContainText(/Choose the client/);

  await page.locator('select').first().selectOption(client.id);
  await page.getByRole('radio', { name: 'Email' }).click();
  const draft = 'hi john, just checkin in about the googel ads campain. we can start next monday if u approve the $1,200 budget. let me no.';
  await page.locator('#assistant-prompt').fill(draft);
  spendOpenAI('text', 'assistant improve email');
  await page.getByRole('button', { name: 'Send' }).click();

  // 2. The chat opens and the first message is sent automatically
  await expect(page).toHaveURL(/\/assistant\/c\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const conversationId = page.url().split('/').pop();
  await expect(page.getByRole('button', { name: /approve v1/i }).first()).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: `${SHOTS}/2-result.png` });
  const [first] = await dbRead(
    `select v.content from public.ai_workspace_outputs o join public.ai_workspace_output_versions v on v.id = o.current_version_id
      where o.conversation_id = $1 order by o.created_at limit 1`,
    [conversationId],
  );
  expect(first.content).toContain('1,200'); // facts and pricing kept
  expect(first.content).not.toMatch(/^Subject:/im); // no subject line unless asked
  expect(first.content).not.toMatch(/\p{Extended_Pictographic}/u); // no emojis

  // 3. Quick change uses conversation memory (no new format question)
  spendOpenAI('text', 'assistant quick change');
  await page.getByRole('button', { name: 'Shorter' }).first().click();
  await expect.poll(async () => (await dbRead('select count(*)::int n from public.ai_workspace_outputs where conversation_id = $1', [conversationId]))[0].n, { timeout: 180_000 }).toBe(2);
  await expect(page.getByText(/which (format|one)|email, an SMS or a WhatsApp/i)).toHaveCount(0);
  const outs = await dbRead(
    `select v.content from public.ai_workspace_outputs o join public.ai_workspace_output_versions v on v.id = o.current_version_id
      where o.conversation_id = $1 order by o.created_at`,
    [conversationId],
  );
  expect(outs[1].content.length).toBeLessThan(outs[0].content.length + 40);
  expect(outs[1].content).toContain('1,200');
  await page.screenshot({ path: `${SHOTS}/3-quick-change.png` });

  // 4. History panel (grouped by date) and the full history page with date filters
  await expect(page.getByRole('navigation', { name: 'Chat history' }).getByText('Today')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Chat history' }).locator(`a[href="/assistant/c/${conversationId}"]`)).toBeVisible();
  await page.goto('/history');
  await expect(page.locator(`a[href="/assistant/c/${conversationId}"]`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/4-history.png` });
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await page.locator('input[type="date"]').fill(ymd);
  await expect(page.locator(`a[href="/assistant/c/${conversationId}"]`)).toBeVisible();
  await page.locator('input[type="date"]').fill('2024-01-15');
  await expect(page.getByText('No chats match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await page.getByPlaceholder('Words in the chat or email…').fill('googel ads');
  await expect(page.locator(`a[href="/assistant/c/${conversationId}"]`)).toBeVisible();

  // 5. Reopening the chat from history shows the whole conversation
  await page.locator(`a[href="/assistant/c/${conversationId}"]`).click();
  await expect(page.getByRole('button', { name: /approve v1/i })).toHaveCount(2, { timeout: 30_000 });
  expect(problems).toEqual([]);
});

test('image: upload a photo and change it with a prompt → exact-size result', async ({ page }) => {
  test.setTimeout(400_000);
  await page.setViewportSize({ width: 1920, height: 940 });
  const client = await createQaClient(`Assistant Img ${Date.now().toString(36)}`);
  await login(page);
  await page.goto('/assistant');
  const photo = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 640, height: 640 } });
  await page.locator('select').first().selectOption(client.id);
  await page.getByRole('radio', { name: 'Create an image' }).click();
  await expect(page.locator('select').nth(1)).not.toHaveValue('');
  await page.locator('input[type="file"]').setInputFiles({ name: 'my-photo.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByText('my-photo.png')).toBeVisible();
  await page.locator('#assistant-prompt').fill('Turn this into a soft pastel illustration, keep the layout, no new text');
  spendOpenAI('image', 'assistant photo edit');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page).toHaveURL(/\/assistant\/c\//, { timeout: 60_000 });
  const conversationId = page.url().split('/').pop();
  await expect(page.getByRole('button', { name: /approve/i }).first()).toBeVisible({ timeout: 240_000 });
  await page.screenshot({ path: `${SHOTS}/5-image.png` });
  const [run] = await dbRead(
    `select status, request_options -> 'attachmentIds' as att, output_metadata from public.ai_workspace_generation_runs where conversation_id = $1 order by started_at desc limit 1`,
    [conversationId],
  );
  expect(run.status).toBe('succeeded');
  expect(run.att).toHaveLength(1); // the uploaded photo was sent as the image to edit
  const [v] = await dbRead(
    `select v.image_meta from public.ai_workspace_outputs o join public.ai_workspace_output_versions v on v.id = o.current_version_id where o.conversation_id = $1`,
    [conversationId],
  );
  expect(v.image_meta.actualWidth).toBe(v.image_meta.requestedWidth);
  expect(v.image_meta.actualHeight).toBe(v.image_meta.requestedHeight);
});
