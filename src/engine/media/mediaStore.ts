/**
 * In-memory access to original media blobs (backed by IndexedDB) and their
 * object URLs. Blobs are loaded lazily and URLs are revoked when no longer needed.
 */
import { getDerived, getMedia, type DerivedData } from '../../storage/db';

const blobs = new Map<string, Blob>();
const urls = new Map<string, string>();
const pending = new Map<string, Promise<Blob | undefined>>();
const derived = new Map<string, DerivedData>();
const derivedPending = new Map<string, Promise<DerivedData | undefined>>();
const listeners = new Set<(assetId: string) => void>();

/** Called when a blob or derived data for an asset becomes available. */
export function onMediaReady(fn: (assetId: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(id: string): void {
  for (const fn of listeners) fn(id);
}

/** Registers a freshly imported file (before/while it is written to IndexedDB). */
export function registerBlob(assetId: string, blob: Blob): void {
  blobs.set(assetId, blob);
  notify(assetId);
}

export function registerDerived(assetId: string, data: DerivedData): void {
  derived.set(assetId, data);
  notify(assetId);
}

export function peekBlob(assetId: string): Blob | undefined {
  return blobs.get(assetId);
}

export async function getBlob(assetId: string): Promise<Blob | undefined> {
  const b = blobs.get(assetId);
  if (b) return b;
  let p = pending.get(assetId);
  if (!p) {
    p = getMedia(assetId)
      .then((blob) => {
        if (blob) {
          blobs.set(assetId, blob);
          notify(assetId);
        }
        return blob;
      })
      .catch(() => undefined)
      .finally(() => pending.delete(assetId));
    pending.set(assetId, p);
  }
  return p;
}

/** Object URL for an asset if its blob is loaded (starts loading otherwise). */
export function peekUrl(assetId: string): string | undefined {
  const u = urls.get(assetId);
  if (u) return u;
  const b = blobs.get(assetId);
  if (!b) {
    void getBlob(assetId);
    return undefined;
  }
  const url = URL.createObjectURL(b);
  urls.set(assetId, url);
  return url;
}

export async function getUrl(assetId: string): Promise<string | undefined> {
  await getBlob(assetId);
  return peekUrl(assetId);
}

export function peekDerived(assetId: string): DerivedData | undefined {
  const d = derived.get(assetId);
  if (d) return d;
  if (!derivedPending.has(assetId)) {
    const p = getDerived(assetId)
      .then((data) => {
        if (data) {
          derived.set(assetId, data);
          notify(assetId);
        }
        return data;
      })
      .catch(() => undefined)
      .finally(() => derivedPending.delete(assetId));
    derivedPending.set(assetId, p);
  }
  return undefined;
}

export async function getDerivedData(assetId: string): Promise<DerivedData | undefined> {
  return derived.get(assetId) ?? (await getDerived(assetId).catch(() => undefined));
}

/** Frees memory for assets that are not part of the open project. */
export function releaseExcept(keep: Set<string>): void {
  for (const id of [...blobs.keys()]) {
    if (keep.has(id)) continue;
    blobs.delete(id);
    const u = urls.get(id);
    if (u) URL.revokeObjectURL(u);
    urls.delete(id);
    derived.delete(id);
  }
}
