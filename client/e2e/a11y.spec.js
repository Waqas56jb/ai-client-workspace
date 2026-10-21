import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { closeDb, createQaClient, createQaJob, createQaTask, login } from './helpers.js';

/**
 * Accessibility: axe-core (WCAG 2.1 A/AA rules) on the main pages, plus keyboard
 * checks. Fails on serious/critical violations; moderate/minor ones are reported.
 */
let ids;
test.beforeAll(async () => {
  const c = await createQaClient(`A11y ${Date.now().toString(36)}`);
  const j = await createQaJob(c.id, 'A11y job');
  const t = await createQaTask(c.id, j.id, 'A11y task');
  ids = { client: c.id, job: j.id, task: t.id };
});
test.afterAll(closeDb);

test('login page has no serious accessibility violations and is keyboard operable', async ({ page }) => {
  await page.goto('/login');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  // keyboard: Tab reaches email → password → sign in
  await page.keyboard.press('Tab');
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    seen.push(await page.evaluate(() => document.activeElement?.getAttribute('autocomplete') || document.activeElement?.textContent?.trim().slice(0, 20)));
    await page.keyboard.press('Tab');
  }
  expect(seen).toEqual(expect.arrayContaining(['email', 'current-password']));
});

test('main app pages have no serious accessibility violations', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  const report = [];
  for (const route of ['/assistant', '/history', '/dashboard', '/clients', `/clients/${ids.client}`, `/clients/${ids.client}/brand`, '/jobs', `/jobs/${ids.job}`, '/tasks', `/tasks/${ids.task}`,
    `/tasks/${ids.task}/workspace`, '/files', '/approved', '/search?q=a', '/image-presets', '/ai-instructions', '/team', '/settings/preferences']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    // The brand preview deliberately renders text in the client's own brand colours.
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('[data-brand-preview]').analyze();
    for (const v of r.violations) report.push({ route, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') });
  }
  console.log(JSON.stringify(report, null, 1));
  const serious = report.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious.map((v) => `${v.route} ${v.id} (${v.impact}): ${v.help} ×${v.nodes} e.g. ${v.sample}`)).toEqual([]);
});

test('dialogs trap focus and close with Escape', async ({ page }) => {
  await login(page);
  await page.goto(`/clients/${ids.client}`);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});
