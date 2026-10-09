import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));

/** Opens the app with the tour already done (tests drive the UI themselves). */
export async function openApp(page: Page, opts: { tour?: boolean } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.evaluate((tour) => {
    localStorage.setItem('kinora.settings', JSON.stringify({ theme: 'dark', hints: true, tourDone: !tour }));
  }, !!opts.tour);
  await page.reload();
  await expect(page.locator('.goal').first()).toBeVisible();
  return errors;
}

/** Clicks something that opens the file picker and chooses fixture files. */
export async function chooseFiles(page: Page, click: () => Promise<void>, files: string[]): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click()]);
  await chooser.setFiles(files.map((f) => path.join(FIXTURES, f)));
}

/** Reads the exported file shown in the export dialog. */
export async function exportedFile(page: Page): Promise<{ type: string; size: number; width: number; height: number; duration: number }> {
  return page.evaluate(async () => {
    const el = document.querySelector<HTMLVideoElement | HTMLImageElement>('.export-preview')!;
    const blob = await fetch(el.src).then((r) => r.blob());
    if (el instanceof HTMLVideoElement) {
      if (el.readyState < 1) await new Promise((r) => el.addEventListener('loadedmetadata', r, { once: true }));
      return { type: blob.type, size: blob.size, width: el.videoWidth, height: el.videoHeight, duration: el.duration };
    }
    if (!el.complete) await new Promise((r) => el.addEventListener('load', r, { once: true }));
    return { type: blob.type, size: blob.size, width: el.naturalWidth, height: el.naturalHeight, duration: 0 };
  });
}
