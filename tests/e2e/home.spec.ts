import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('home screen offers goal-first starts and works offline-ready', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.getByRole('heading', { name: /What do you want to/ })).toBeVisible();
  for (const name of ['Edit a photo', 'Make a video', 'Photo slideshow', 'Quick trim', 'Make a meme', 'Use a template']) {
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
