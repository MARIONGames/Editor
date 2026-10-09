import { expect, test } from '@playwright/test';
import { chooseFiles, exportedFile, openApp } from './helpers';

test('edit a photo: auto-enhance, add text, export full-resolution PNG', async ({ page }) => {
  const errors = await openApp(page);
  await chooseFiles(page, () => page.getByRole('button', { name: /Edit a photo/ }).click(), ['photo.jpg']);
  // The photo decides the canvas size, and Adjust opens straight away.
  await expect(page.locator('[data-coach="auto-enhance"]')).toBeVisible();
  await page.locator('[data-coach="auto-enhance"]').click();
  await expect(page.locator('.toast.success')).toContainText('Enhanced');
  // Add a caption.
  await page.locator('[data-coach="tool-text"]').first().click();
  await page.locator('.preset-tile').nth(2).click();
  await page.locator('.text-input').fill('Sunny day');
  // Undo works on the last change and can be redone.
  await page.getByRole('button', { name: /^Undo/ }).click();
  await page.getByRole('button', { name: /^Redo/ }).click();
  // Export as PNG.
  await page.locator('[data-coach="export"]').click();
  await page.getByRole('radio', { name: 'PNG' }).click();
  await page.getByRole('button', { name: /Create photo/ }).click();
  await expect(page.locator('.export-done')).toBeVisible({ timeout: 120_000 });
  const out = await exportedFile(page);
  expect(out.type).toBe('image/png');
  expect(out.width).toBe(1200);
  expect(out.height).toBe(800);
  expect(out.size).toBeGreaterThan(50_000);
  expect(errors).toEqual([]);
});
