/**
 * Minimal promise wrapper around IndexedDB.
 *
 * Stores:
 *  - projects: project JSON (keyPath id)
 *  - covers:   small cover image per project (key: project id)
 *  - media:    original media blobs (key: asset id) — never modified
 *  - derived:  thumbnails and waveform data (key: asset id)
 *  - scenes:   3D scenes (keyPath id); their covers share `covers`, files share `media`
 */
import type { Project } from '../model/types';

const DB_NAME = 'kinora';
const DB_VERSION = 2;

/** The part of a 3D scene the home screen and storage cleanup need (no three.js import). */
interface StoredScene {
  id: string;
  name: string;
  kind: '3d';
  updatedAt: number;
  objects: Record<string, { kind: string }>;
  assets: Record<string, unknown>;
  textures: Record<string, { assetId: string }>;
  world?: { hdri?: string | null };
}

export interface SceneSummary {
  id: string;
  name: string;
  updatedAt: number;
  objectCount: number;
  cover?: Blob;
}

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
      if (!db.objectStoreNames.contains('projects'))
        db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      if (!db.objectStoreNames.contains('derived')) db.createObjectStore('derived');
      if (!db.objectStoreNames.contains('scenes'))
        db.createObjectStore('scenes', { keyPath: 'id' });
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

/** Media files a stored 3D scene uses. */
export function sceneAssets(sc: StoredScene): string[] {
  const out = new Set(Object.keys(sc.assets ?? {}));
  for (const t of Object.values(sc.textures ?? {})) out.add(t.assetId);
  if (sc.world?.hdri) out.add(sc.world.hdri);
  return [...out];
}

/** Removes media no remaining project or scene uses. */
async function dropUnusedMedia(
  t: IDBTransaction,
  candidates: string[],
  skipId: string,
): Promise<void> {
  if (!candidates.length) return;
  const stillUsed = new Set<string>();
  const projects = (await reqToPromise(t.objectStore('projects').getAll())) as Project[];
  for (const p of projects)
    if (p.id !== skipId) for (const a of Object.keys(p.assets ?? {})) stillUsed.add(a);
  const scenes = (await reqToPromise(t.objectStore('scenes').getAll())) as StoredScene[];
  for (const sc of scenes) if (sc.id !== skipId) for (const a of sceneAssets(sc)) stillUsed.add(a);
  for (const assetId of candidates) {
    if (!stillUsed.has(assetId)) {
      t.objectStore('media').delete(assetId);
      t.objectStore('derived').delete(assetId);
    }
  }
}

/** Deletes a project and every media file no other project still uses. */
export async function deleteProject(id: string): Promise<void> {
  await tx(['projects', 'scenes', 'covers', 'media', 'derived'], 'readwrite', async (t) => {
    const projects = t.objectStore('projects');
    const target = (await reqToPromise(projects.get(id))) as Project | undefined;
    projects.delete(id);
    t.objectStore('covers').delete(id);
    if (target) await dropUnusedMedia(t, Object.keys(target.assets ?? {}), id);
  });
}

/* ------------------------------------------------------------------ scenes */

export async function saveScene<T extends { id: string }>(scene: T): Promise<void> {
  await tx('scenes', 'readwrite', (t) => {
    t.objectStore('scenes').put(scene);
  });
}

export async function loadScene(id: string): Promise<unknown | undefined> {
  return tx('scenes', 'readonly', (t) => reqToPromise(t.objectStore('scenes').get(id)));
}

export async function listScenes(): Promise<SceneSummary[]> {
  return tx(['scenes', 'covers'], 'readonly', async (t) => {
    const all = (await reqToPromise(t.objectStore('scenes').getAll())) as StoredScene[];
    const covers = t.objectStore('covers');
    const out: SceneSummary[] = [];
    for (const sc of all) {
      const cover = (await reqToPromise(covers.get(sc.id))) as Blob | undefined;
      const objectCount = Object.values(sc.objects ?? {}).filter(
        (o) => o.kind === 'mesh' || o.kind === 'model',
      ).length;
      out.push({ id: sc.id, name: sc.name, updatedAt: sc.updatedAt, objectCount, cover });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  });
}

export async function deleteScene(id: string): Promise<void> {
  await tx(['projects', 'scenes', 'covers', 'media', 'derived'], 'readwrite', async (t) => {
    const scenes = t.objectStore('scenes');
    const target = (await reqToPromise(scenes.get(id))) as StoredScene | undefined;
    scenes.delete(id);
    t.objectStore('covers').delete(id);
    if (target) await dropUnusedMedia(t, sceneAssets(target), id);
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

/* ------------------------------------------------------- cloud backup access */

export type LocalKind = 'project' | 'scene';

export interface LocalItem {
  id: string;
  kind: LocalKind;
  name: string;
  updatedAt: number;
  /** Media files it uses. */
  assets: string[];
}

const STORE: Record<LocalKind, string> = { project: 'projects', scene: 'scenes' };

/** Every project and 3D scene on this device (for cloud backup). */
export async function listLocal(): Promise<LocalItem[]> {
  return tx(['projects', 'scenes'], 'readonly', async (t) => {
    const ps = (await reqToPromise(t.objectStore('projects').getAll())) as Project[];
    const ss = (await reqToPromise(t.objectStore('scenes').getAll())) as StoredScene[];
    return [
      ...ps.map((p) => ({
        id: p.id,
        kind: 'project' as const,
        name: p.name,
        updatedAt: p.updatedAt,
        assets: Object.keys(p.assets ?? {}),
      })),
      ...ss.map((sc) => ({
        id: sc.id,
        kind: 'scene' as const,
        name: sc.name,
        updatedAt: sc.updatedAt,
        assets: sceneAssets(sc),
      })),
    ];
  });
}

export async function getLocal(kind: LocalKind, id: string): Promise<unknown | undefined> {
  return tx(STORE[kind], 'readonly', (t) => reqToPromise(t.objectStore(STORE[kind]).get(id)));
}

export async function putLocal(kind: LocalKind, value: { id: string }): Promise<void> {
  await tx(STORE[kind], 'readwrite', (t) => {
    t.objectStore(STORE[kind]).put(value);
  });
}

export async function deleteLocal(kind: LocalKind, id: string): Promise<void> {
  if (kind === 'project') await deleteProject(id);
  else await deleteScene(id);
}
