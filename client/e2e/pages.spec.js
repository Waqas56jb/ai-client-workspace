import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { closeDb, createQaClient, createQaJob, createQaTask, expectNoHorizontalOverflow, get, login, watchPage } from './helpers.js';

/**
 * Opens every route directly (deep link) with real records at four viewports.
 * Checks: page renders (no error boundary / 404), loading finishes, no console
 * errors, no failed API calls, no horizontal page overflow. Saves screenshots.
 */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];
const STATE = 'e2e/.results/state-member-a.json';
const SHOTS = 'e2e/.results/screens';
let ids;

test.beforeAll(async ({ browser }) => {
  // Real records (created through the API) so detail pages have data — including a very long name.
  const client = await createQaClient(`E2E Pages ${Date.now().toString(36)} ${'Long Name '.repeat(5)}`.slice(0, 60), { brand: { warranty: 'E2E warranty' } });
  const job = await createQaJob(client.id, 'E2E Pages Job With A Deliberately Long Title For Wrapping');
  const task = await createQaTask(client.id, job.id, 'E2E Pages Task', 'writing');
  const file = (await get('/files', { query: { limit: 1 } })).data?.[0];
  const preset = (await get('/image-presets')).data[0];
  ids = { client: client.id, job: job.id, task: task.id, file: file?.id, preset: preset.id };
  const page = await browser.newPage({ storageState: { cookies: [], origins: [] } });
  await login(page, 'QA_MEMBER_A');
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.context().storageState({ path: STATE });
  await page.close();
});
test.afterAll(closeDb);
test.use({ storageState: STATE });

const ROUTES = () => [
  '/dashboard', '/clients', '/clients/new', `/clients/${ids.client}`, `/clients/${ids.client}/edit`, `/clients/${ids.client}/jobs`,
  `/clients/${ids.client}/brand`, `/clients/${ids.client}/reference-files`, `/clients/${ids.client}/activity`,
  '/jobs', '/jobs/new', `/jobs/${ids.job}`, `/jobs/${ids.job}/edit`,
  '/tasks', '/tasks/new', `/tasks/${ids.task}`, `/tasks/${ids.task}/edit`, `/tasks/${ids.task}/workspace`,
  '/ai-workspace', `/ai-workspace/${ids.task}`, '/files', ...(ids.file ? [`/files/${ids.file}`] : []), '/approved', '/search?q=QA',
  '/image-presets', '/image-presets/new', `/image-presets/${ids.preset}/edit`, '/ai-instructions', '/team',
  '/settings', '/settings/profile', '/settings/preferences', '/settings/storage', '/settings/security',
];

for (const vp of VIEWPORTS) {
  test(`every route renders cleanly at ${vp.name} ${vp.width}×${vp.height}`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const failures = [];
    for (const route of ROUTES()) {
      const problems = watchPage(page);
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main, [role="main"]').first()).toBeVisible();
      // loading skeletons gone
      await expect(page.locator('[role="status"][aria-label="Loading"]')).toHaveCount(0, { timeout: 20_000 }).catch(() => problems.push('loading skeleton never finished'));
      const body = await page.locator('body').innerText();
      if (/something went wrong|page not found|unexpected application error/i.test(body)) problems.push('error/404 page shown');
      if (/demo mode|simulated|demo data/i.test(body)) problems.push('demo/simulated wording visible in API mode');
      try {
        await expectNoHorizontalOverflow(page, route);
      } catch (e) {
        problems.push(e.message.split('\n')[0]);
      }
      if (vp.name === 'desktop' || vp.name === 'mobile') {
        await page.screenshot({ path: `${SHOTS}/${vp.name}${route.replace(/[/?=]+/g, '_').replace(/_[0-9a-f-]{36}/g, '_id')}.png`, fullPage: false });
      }
      if (problems.length) failures.push(`${route}: ${problems.join(' | ')}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
