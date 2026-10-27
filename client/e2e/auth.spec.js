import { expect, test } from '@playwright/test';
import { account, login, watchPage } from './helpers.js';

test.describe('authentication (real Supabase Auth + API)', () => {
  test('protected routes redirect to /login when signed out', async ({ page }) => {
    for (const path of ['/dashboard', '/clients', '/settings/security', '/ai-workspace']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test('wrong password shows a clear error and stays signed out', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(account('QA_MEMBER_A').email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('definitely-wrong-password');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByText(/invalid|incorrect|wrong/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('empty and malformed email are validated before sending', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('not-an-email');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('x');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a Supabase user who is not a workspace member cannot get in', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(account('QA_OUTSIDER').email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(account('QA_OUTSIDER').password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByText(/not (an active )?member|access/i).first()).toBeVisible();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('member signs in, the session survives a reload, and logout ends it', async ({ page }) => {
    const problems = watchPage(page);
    await login(page, 'QA_MEMBER_A');
    await page.reload();
    await expect(page).toHaveURL(/:\d+\/$/); // the chat is the home screen
    await expect(page.getByText('QA Member A').first()).toBeVisible();
    await page.goto('/settings/security');
    await page.getByRole('button', { name: /log out/i }).first().click();
    const confirm = page.getByRole('dialog').getByRole('button', { name: /log out|sign out/i });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/clients');
    await expect(page).toHaveURL(/\/login/);
    expect(problems).toEqual([]);
  });
});
