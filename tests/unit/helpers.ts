import { createMediaClip, createProject } from '../../src/model/defaults';
import { addAsset, insertMainClips } from '../../src/model/ops';
import type { Asset, Project } from '../../src/model/types';

let n = 0;
export function videoAsset(duration = 10, extra: Partial<Asset> = {}): Asset {
  n++;
  return {
    id: `a${n}`,
    kind: 'video',
    name: `clip${n}.mp4`,
    mime: 'video/mp4',
    size: 1000,
    width: 1920,
    height: 1080,
    duration,
    hasAudio: true,
    addedAt: 0,
    ...extra,
  };
}

export function imageAsset(extra: Partial<Asset> = {}): Asset {
  n++;
  return {
    id: `i${n}`,
    kind: 'image',
    name: `photo${n}.jpg`,
    mime: 'image/jpeg',
    size: 1000,
    width: 4000,
    height: 3000,
    duration: 0,
    hasAudio: false,
    addedAt: 0,
    ...extra,
  };
}

/** A video project with the given media on the main track. */
export function projectWith(...assets: Asset[]): Project {
  let p = createProject({ kind: 'video', width: 1920, height: 1080 });
  for (const a of assets) p = addAsset(p, a);
  return insertMainClips(
    p,
    assets.map((a) => createMediaClip(a)),
  );
}

export const mainClips = (p: Project) => p.tracks.find((t) => t.kind === 'main')!.clips;
