/**
 * Minimal promise wrapper around IndexedDB.
 *
 * Stores:
 *  - projects: project JSON (keyPath id)
 *  - covers:   small cover image per project (key: project id)
 *  - media:    original media blobs (key: asset id) — never modified
 *  - derived:  thumbnails and waveform data (key: asset id)
 */
import type { Project } from '../model/types';

const DB_NAME = 'kinora';
const DB_VERSION = 1;

export interface DerivedData {
  /** Filmstrip frames (JPEG) for videos, or a single thumbnail for photos. */
  thumbs: Blob[];
  /** Seconds between filmstrip frames. */
  thumbInterval: number;
  /** Peak amplitude per 10 ms (0..1). */
  peaks?: Float32Array;
  /** RMS level per 10 ms (0..1). */
  rms?: Float32Array;
}

export interface ProjectSummary {
  id: string;
  name: string;
  kind: Project['kind'];
  width: number;
  height: number;
  updatedAt: number;
  duration: number;
  clipCount: number;
  cover?: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function isStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      if (!db.objectStoreNames.contains('derived')) db.createObjectStore('derived');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is blocked by another tab'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await open();
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
  });
  const result = await fn(t);
  await done;
  return result;
}

/* ---------------------------------------------------------------- projects */

export async function saveProject(p: Project): Promise<void> {
  await tx('projects', 'readwrite', (t) => {
    t.objectStore('projects').put(p);
  });
}

export async function saveCover(projectId: string, cover: Blob): Promise<void> {
  await tx('covers', 'readwrite', (t) => {
    t.objectStore('covers').put(cover, projectId);
  });
}

export async function loadProject(id: string): Promise<unknown | undefined> {
  return tx('projects', 'readonly', (t) => reqToPromise(t.objectStore('projects').get(id)));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return tx(['projects', 'covers'], 'readonly', async (t) => {
    const all = (await reqToPromise(t.objectStore('projects').getAll())) as Project[];
    const covers = t.objectStore('covers');
    const out: ProjectSummary[] = [];
    for (const p of all) {
      let duration = 0;
      let clipCount = 0;
      for (const tr of p.tracks ?? []) {
        for (const c of tr.clips ?? []) {
          clipCount++;
          duration = Math.max(duration, c.start + c.duration);
        }
      }
      const cover = (await reqToPromise(covers.get(p.id))) as Blob | undefined;
      out.push({
        id: p.id,
        name: p.name,
        kind: p.kind,
        width: p.width,
        height: p.height,
        updatedAt: p.updatedAt,
        duration,
        clipCount,
        cover,
      });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  });
}

/** Deletes a project and every media file no other project still uses. */
export async function deleteProject(id: string): Promise<void> {
  await tx(['projects', 'covers', 'media', 'derived'], 'readwrite', async (t) => {
    const projects = t.objectStore('projects');
    const target = (await reqToPromise(projects.get(id))) as Project | undefined;
    projects.delete(id);
    t.objectStore('covers').delete(id);
    if (!target) return;
    const others = ((await reqToPromise(projects.getAll())) as Project[]).filter((p) => p.id !== id);
    const stillUsed = new Set<string>();
    for (const p of others) for (const a of Object.keys(p.assets ?? {})) stillUsed.add(a);
    for (const assetId of Object.keys(target.assets ?? {})) {
      if (!stillUsed.has(assetId)) {
        t.objectStore('media').delete(assetId);
        t.objectStore('derived').delete(assetId);
      }
    }
  });
}

/* ------------------------------------------------------------------- media */

export async function putMedia(assetId: string, blob: Blob): Promise<void> {
  await tx('media', 'readwrite', (t) => {
    t.objectStore('media').put(blob, assetId);
  });
}

export async function getMedia(assetId: string): Promise<Blob | undefined> {
  return tx('media', 'readonly', (t) => reqToPromise(t.objectStore('media').get(assetId)));
}

export async function putDerived(assetId: string, data: DerivedData): Promise<void> {
  await tx('derived', 'readwrite', (t) => {
    t.objectStore('derived').put(data, assetId);
  });
}

export async function getDerived(assetId: string): Promise<DerivedData | undefined> {
  return tx('derived', 'readonly', (t) => reqToPromise(t.objectStore('derived').get(assetId)));
}

/** Asks the browser not to evict our data when space runs low. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
