/** Auto-save: every change is written to IndexedDB shortly after it happens. */
import type { Project } from '../model/types';
import * as db from '../storage/db';
import { project, toast } from './store';

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: Project | null = null;
let lastCover = 0;
let coverFor: string | null = null;
let failedOnce = false;

/** Supplied by the stage: renders a small cover image of the current frame. */
let coverProvider: (() => Promise<Blob | null>) | null = null;
export function setCoverProvider(fn: (() => Promise<Blob | null>) | null): void {
  coverProvider = fn;
}

export function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void save(), 700);
}

export async function flushSave(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  await save(true);
}

async function save(forceCover = false): Promise<void> {
  const p = project.peek();
  if (!p) return;
  if (p !== lastSaved) {
    try {
      await db.saveProject(p);
      lastSaved = p;
      failedOnce = false;
    } catch (err) {
      console.error('Autosave failed', err);
      if (!failedOnce) {
        failedOnce = true;
        toast("Couldn't save to this device (storage may be full or blocked).", 'error');
      }
      return;
    }
  }
  const now = Date.now();
  if (coverProvider && (forceCover || coverFor !== p.id || now - lastCover > 15000)) {
    lastCover = now;
    coverFor = p.id;
    try {
      const blob = await coverProvider();
      if (blob) await db.saveCover(p.id, blob);
    } catch {
      /* covers are optional */
    }
  }
}

if (typeof window !== 'undefined') {
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      void save(true);
    }
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });
}
