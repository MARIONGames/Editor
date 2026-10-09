/** Object URLs for filmstrip thumbnails, cached per asset. */
import { signal } from '@preact/signals';
import { onMediaReady, peekDerived } from '../../engine/media/mediaStore';
import type { DerivedData } from '../../storage/db';

const urls = new Map<string, string[]>();
/** Bumped when new thumbnails/waveforms arrive so the timeline re-renders. */
export const derivedVersion = signal(0);

onMediaReady(() => derivedVersion.value++);

export function thumbUrls(assetId: string): string[] {
  const cached = urls.get(assetId);
  if (cached) return cached;
  const d = peekDerived(assetId);
  if (!d) return [];
  const list = d.thumbs.map((b) => URL.createObjectURL(b));
  urls.set(assetId, list);
  return list;
}

export function derived(assetId: string): DerivedData | undefined {
  return peekDerived(assetId);
}
