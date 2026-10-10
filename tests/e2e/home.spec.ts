import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('home screen offers goal-first starts and works offline-ready', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.getByRole('heading', { name: /What do you want to/ })).toBeVisible();
  for (const name of [
    'Edit a photo',
    'Make a video',
    'Photo slideshow',
    'Quick trim',
    'Make a meme',
    'Use a template',
  ]) {
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }
  // Glossary explains editing words in plain language.
  await page.getByRole('button', { name: /Learn/ }).first().click();
  await page.getByRole('textbox', { name: 'Search the glossary' }).fill('cut');
  await expect(page.locator('.glossary-item').first()).toContainText('Cut');
  await page.keyboard.press('Escape');
  // Templates dialog lists designs.
  await page.getByRole('button', { name: /Use a template/ }).click();
  await expect(page.locator('.template-card')).toHaveCount(7);
  expect(errors).toEqual([]);
});

test('first use asks to accept the license agreement', async ({ page }) => {
  await page.goto('/');
  const gate = page.getByRole('dialog', { name: /Welcome to Kinora/ });
  await expect(gate).toBeVisible();
  await expect(gate).toContainText('Kinora End User License Agreement');
  await expect(gate).toContainText('© 2026 Marios Kouretis. All rights reserved.');
  const agree = page.getByRole('button', { name: 'Agree and continue' });
  await expect(agree).toBeDisabled();
  await page.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByRole('heading', { name: 'Kinora needs your agreement' })).toBeVisible();
  await page.getByRole('button', { name: 'Read the agreement again' }).click();
  await page.getByRole('checkbox').check();
  await agree.click();
  await expect(gate).toBeHidden();
  // Accepted once: not asked again.
  await page.reload();
  await expect(page.locator('.goal').first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Welcome to Kinora/ })).toHaveCount(0);
  await expect(page.locator('.home-footer')).toContainText('Marios Kouretis');
});
