import { expect, test } from '@playwright/test';
import {
  account, closeDb, createQaClient, createQaJob, dbRead, get, login, record, spendOpenAI, tag, watchPage,
} from './helpers.js';

/**
 * End-to-end workflows through the real UI, verified independently through the
 * API (as another member) and READ ONLY database queries.
 */
test.afterAll(closeDb);

test('client created in the UI is persisted, attributed, visible to another member and survives reload; double-click creates one', async ({ page }) => {
  const problems = watchPage(page);
  await login(page);
  const name = tag(`UI Client ${Date.now().toString(36)}`);
  await page.goto('/clients/new');
  await page.getByRole('textbox', { name: 'Client name' }).fill(name);
  await page.getByRole('combobox', { name: 'Industry' }).fill('Automotive').catch(async () => page.getByLabel('Industry').fill('Automotive'));
  const submit = page.getByRole('button', { name: 'Create client' });
  await submit.dblclick();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop();
  record('client', id, { via: 'ui' });
  const rows = await dbRead('select id, created_by from public.ai_workspace_clients where name = $1', [name]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual({ id, created_by: account('QA_MEMBER_A').id });
  expect((await get(`/clients/${id}`, { as: 'QA_MEMBER_B' })).data.name).toBe(name);
  await page.reload();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  expect(problems).toEqual([]);
});

test('client created through the API appears in the UI list and search; duplicate slug shows a field error', async ({ page }) => {
  const c = await createQaClient(`API Visible ${Date.now().toString(36)}`, {}, 'QA_MEMBER_B');
  await login(page);
  await page.goto(`/clients`);
  await page.getByRole('searchbox').first().fill(c.name).catch(() => {});
  await expect(page.locator('main a', { hasText: c.name }).first()).toBeVisible();
  await page.goto(`/search?q=${encodeURIComponent(c.name)}`);
  await expect(page.locator('main a', { hasText: c.name }).first()).toBeVisible();
  // duplicate slug → field-level error (was only a toast before the fix)
  await page.goto('/clients/new');
  await page.getByRole('textbox', { name: 'Client name' }).fill(c.name);
  await page.getByRole('textbox', { name: /internal identifier/i }).fill(c.slug);
  await page.getByRole('combobox', { name: 'Industry' }).fill('Automotive').catch(async () => page.getByLabel('Industry').fill('Automotive'));
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page.locator('p[role="alert"]').filter({ hasText: /identifier|slug/i })).toBeVisible();
});

test('task created in the UI persists and opens the workspace; AI email generated in the browser is saved, approved and listed in Approved Work', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = watchPage(page);
  const client = await createQaClient(`UI Flow ${Date.now().toString(36)}`, { brand: { phone: '+44 20 7946 0999' } });
  const job = await createQaJob(client.id, 'UI Flow Job');
  await login(page);
  await page.goto(`/tasks/new?clientId=${client.id}&jobId=${job.id}`);
  await page.getByRole('combobox', { name: 'Client' }).selectOption(client.id).catch(() => {});
  await page.getByRole('combobox', { name: 'Job' }).selectOption(job.id).catch(() => {});
  await page.getByRole('radio', { name: /writing/i }).first().click();
  const title = tag('UI Task');
  await page.getByRole('textbox', { name: 'Task title' }).fill(title);
  await page.getByRole('button', { name: /create & open workspace/i }).click();
  await expect(page).toHaveURL(/workspace/);
  const [task] = await dbRead('select id, client_id, job_id, created_by from public.ai_workspace_tasks where title = $1', [title]);
  expect(task).toMatchObject({ client_id: client.id, job_id: job.id, created_by: account('QA_MEMBER_A').id });
  record('task', task.id, { via: 'ui' });

  // Real OpenAI call from the browser flow
  spendOpenAI('text', 'e2e ui email');
  await page.locator('#ws-prompt').fill('Write a short email inviting customers to our open day on Saturday.');
  await page.getByRole('button', { name: /^(send|generate)/i }).last().click();
  await expect(page.getByText(/generating/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /approve v1/i }).first()).toBeVisible({ timeout: 180_000 });
  const [out] = await dbRead('select id, approved_version_id from public.ai_workspace_outputs where task_id = $1', [task.id]);
  expect(out.approved_version_id).toBeNull();
  await page.getByRole('button', { name: /approve v1/i }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve version' }).click();
  await expect.poll(async () => (await dbRead('select approved_version_id from public.ai_workspace_outputs where id = $1', [out.id]))[0].approved_version_id).not.toBeNull();
  await page.reload();
  await expect(page.getByText(/approved/i).first()).toBeVisible();
  await page.goto('/approved');
  const [o] = await dbRead('select title from public.ai_workspace_outputs where id = $1', [out.id]);
  await expect(page.locator('main').getByText(o.title).first()).toBeVisible();
  // the conversation survives a new login session
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await login(page, 'QA_MEMBER_B');
  await page.goto(`/tasks/${task.id}/workspace`);
  await expect(page.getByText(/open day/i).first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('dashboard numbers come from the real database', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  const api = (await get('/dashboard/summary')).data.metrics;
  await expect(page.getByText(String(api.clients.value)).first()).toBeVisible();
  const [c] = await dbRead(`select count(*)::int n from public.ai_workspace_clients where status <> 'archived'`);
  expect(api.clients.value).toBe(c.n);
});
