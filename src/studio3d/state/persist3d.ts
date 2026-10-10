/** Auto-save for 3D scenes: written to IndexedDB shortly after every change. */
import { toast } from '../../state/store';
import * as db from '../../storage/db';
import type { Scene3D } from '../model/types';
import { scene3d } from './store3d';

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: Scene3D | null = null;
let lastCover = 0;
let coverFor: string | null = null;
let failedOnce = false;
let coverProvider: (() => Promise<Blob | null>) | null = null;

/** Supplied by the viewport: renders a small picture for the home screen. */
export function setSceneCoverProvider(fn: (() => Promise<Blob | null>) | null): void {
  coverProvider = fn;
}

export function scheduleSave3d(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void save(), 800);
}

export async function flushSave3d(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  await save(true);
}

async function save(forceCover = false): Promise<void> {
  const s = scene3d.peek();
  if (!s) return;
  if (s !== lastSaved) {
    try {
      await db.saveScene(s);
      lastSaved = s;
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
  if (coverProvider && (forceCover || coverFor !== s.id || now - lastCover > 20000)) {
    lastCover = now;
    coverFor = s.id;
    try {
      const blob = await coverProvider();
      if (blob) await db.saveCover(s.id, blob);
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
