/** Decoded still images (ImageBitmap) for preview and export, keyed by asset. */
import { getBlob } from './mediaStore';

interface Entry {
  bmp: ImageBitmap;
  maxDim: number;
  full: boolean;
}

const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<ImageBitmap | null>>();
const listeners = new Set<() => void>();

export function onImageDecoded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Cached bitmap if good enough for `maxDim`, otherwise starts decoding and returns what we have. */
export function peekImage(assetId: string, maxDim: number): ImageBitmap | null {
  const e = cache.get(assetId);
  if (e && (e.full || e.maxDim >= maxDim)) return e.bmp;
  void loadImage(assetId, maxDim);
  return e?.bmp ?? null;
}

export function loadImage(assetId: string, maxDim: number): Promise<ImageBitmap | null> {
  const e = cache.get(assetId);
  if (e && (e.full || e.maxDim >= maxDim)) return Promise.resolve(e.bmp);
  const key = `${assetId}@${maxDim}`;
  let p = pending.get(key);
  if (p) return p;
  p = (async () => {
    const blob = await getBlob(assetId);
    if (!blob) return null;
    try {
      // Decode once at natural size to learn the dimensions, then downscale if needed.
      let bmp = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
        premultiplyAlpha: 'premultiply',
      });
      let full = true;
      const big = Math.max(bmp.width, bmp.height);
      if (big > maxDim) {
        const s = maxDim / big;
        const scaled = await createImageBitmap(bmp, {
          resizeWidth: Math.max(1, Math.round(bmp.width * s)),
          resizeHeight: Math.max(1, Math.round(bmp.height * s)),
          resizeQuality: 'high',
          premultiplyAlpha: 'premultiply',
        });
        bmp.close();
        bmp = scaled;
        full = false;
      }
      const old = cache.get(assetId);
      cache.set(assetId, { bmp, maxDim, full });
      if (old && old.bmp !== bmp) old.bmp.close();
      for (const fn of listeners) fn();
      return bmp;
    } catch (err) {
      console.warn('Image decode failed', err);
      return null;
    }
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

export function releaseImages(keep: Set<string>): void {
  for (const [id, e] of cache) {
    if (!keep.has(id)) {
      e.bmp.close();
      cache.delete(id);
    }
  }
}
