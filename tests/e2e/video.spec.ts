import { expect, test } from '@playwright/test';
import { chooseFiles, exportedFile, openApp } from './helpers';

test('make a video: import, split, undo, title, export', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openApp(page);
  await page.getByRole('button', { name: /Make a video/ }).click();
  await chooseFiles(page, () => page.getByRole('button', { name: /Not sure — match my video/ }).click(), ['clip.webm', 'photo.jpg']);
  const mainClips = page.locator('.tl-lane.main .tl-clip');
  await expect(mainClips).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('.time-total')).toHaveText('0:07.0');

  // Jump to 1.5 s with the keyboard, select the first clip and split it.
  await page.keyboard.press('Home');
  for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowRight');
  await mainClips.first().click();
  await page.locator('[data-coach="tool-split"]').first().click();
  await expect(mainClips).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(mainClips).toHaveCount(2);

  // A title at the start.
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  await page.locator('[data-coach="tool-text"]').first().click();
  await page.locator('.preset-tile').first().click();
  await page.locator('.text-input').fill('My trip');
  await expect(page.locator('.tl-lane.overlay .tl-clip')).toHaveCount(1);

  // Export a small file.
  await page.locator('[data-coach="export"]').click();
  await page.getByRole('radio', { name: /Small file/ }).click();
  await page.locator('[data-coach="export-go"]').click();
  await expect(page.locator('.export-done')).toBeVisible({ timeout: 200_000 });
  const out = await exportedFile(page);
  expect(out.type).toMatch(/video\/(mp4|webm)/);
  expect(out.size).toBeGreaterThan(20_000);
  expect(Math.min(out.width, out.height)).toBe(720);
  expect(out.duration).toBeGreaterThan(6.5);
  expect(out.duration).toBeLessThan(7.6);
  expect(errors).toEqual([]);
});
