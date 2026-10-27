/**
 * E2E helpers. API/database verification reuses the server's live QA helpers
 * (real API, READ ONLY database queries) so the browser result is checked
 * independently of the UI.
 */
import { expect } from '@playwright/test';

export * from '../../server/tests/live/helpers/live.js';
import { account } from '../../server/tests/live/helpers/live.js';

/** Signs in through the real login form. */
export async function login(page, key = 'QA_MEMBER_A') {
  const { email, password } = account(key);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // The chat is the home screen after signing in.
  await expect(page).toHaveURL(/:\d+\/(chat\/[0-9a-f-]+)?(\?.*)?$/, { timeout: 30_000 });
}

/**
 * Collects console errors and failed API calls for a page. `allow` filters out
 * intentionally triggered failures.
 */
export function watchPage(page, { allow = [] } = {}) {
  const problems = [];
  const allowed = (s) => allow.some((re) => re.test(s));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !allowed(msg.text())) problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    const url = res.url();
    if (/\/api\/v1\//.test(url) && res.status() >= 400 && !allowed(`${res.status()} ${url}`)) problems.push(`api ${res.status()} ${res.request().method()} ${url}`);
  });
  page.on('requestfailed', (req) => {
    const s = `${req.failure()?.errorText} ${req.url()}`;
    if (/\/api\/v1\//.test(req.url()) && !/ERR_ABORTED/.test(s) && !allowed(s)) problems.push(`requestfailed: ${s}`);
  });
  return problems;
}

/** Fails when the document is wider than the viewport (horizontal page scroll). */
export async function expectNoHorizontalOverflow(page, label) {
  const { scroll, client, culprit } = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    let culprit = '';
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 && r.width > 0) {
        culprit = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} "${(el.textContent || '').trim().slice(0, 40)}" right=${Math.round(r.right)}`;
        break;
      }
    }
    return { scroll: document.documentElement.scrollWidth, client: w, culprit };
  });
  expect(scroll, `${label}: page scrolls horizontally (${scroll} > ${client}) first overflowing: ${culprit}`).toBeLessThanOrEqual(client + 1);
}
