import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

const API = 'https://kinora-api.rubby-studios.com';

// The account service is answered locally here: this checks the app's side (addresses,
// requests, screens), not the live server.
test('create an account, save the recovery code, sign out', async ({ page }) => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*',
        },
      });
    calls.push({
      path,
      body: req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : {},
    });
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (path === '/v1/auth/signup') {
      return route.fulfill({
        status: 201,
        headers,
        body: JSON.stringify({
          token: 't1',
          user: { id: 'u1', email: 'ada@example.com', name: 'Ada', createdAt: 1 },
          recoveryCode: 'ABCDE-FGHJK-LMNPQ-RSTUV',
        }),
      });
    }
    return route.fulfill({ status: 204, headers });
  });
  const errors = await openApp(page);
  await page
    .getByRole('button', { name: /Sign in/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('a long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('.recovery-code')).toHaveText('ABCDE-FGHJK-LMNPQ-RSTUV');
  expect(calls[0]).toMatchObject({
    path: '/v1/auth/signup',
    body: { name: 'Ada', email: 'ada@example.com', eula: expect.any(String) },
  });
  await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Account: Ada' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: /Sign in/ }).first()).toBeVisible();
  expect(calls.at(-1)?.path).toBe('/v1/auth/logout');
  expect(errors).toEqual([]);
});
