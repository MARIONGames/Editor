import { describe, expect, it } from 'vitest';
import {
  createMediaClip,
  createProject,
  createStickerClip,
  createTextClip,
  MIN_CLIP_DURATION,
  PHOTO_TIME,
} from '../../src/model/defaults';
import {
  addAsset,
  addAudioClip,
  addLayer,
  addOverlayClip,
  canSplit,
  duplicateClip,
  findClip,
  moveClip,
  moveClipToNewLane,
  normalizeProject,
  projectDuration,
  removeClips,
  reorderMainClip,
  replaceWithSegments,
  setMainDurations,
  setSpeed,
  setTransition,
  setTransitionAll,
  splitClip,
  trimClip,
} from '../../src/model/ops';
import { imageAsset, mainClips, projectWith, videoAsset } from './helpers';

describe('main track (magnetic)', () => {
  it('packs clips back to back from zero', () => {
    const p = projectWith(videoAsset(5), imageAsset(), videoAsset(4));
    expect(mainClips(p).map((c) => c.start)).toEqual([0, 5, 8]);
    expect(projectDuration(p)).toBe(12);
  });

  it('overlaps clips by the transition length and clamps it to half the shorter clip', () => {
    let p = projectWith(videoAsset(5), imageAsset(), videoAsset(4));
    const [, b, c] = mainClips(p);
    p = setTransition(p, b!.id, { type: 'fade', duration: 1 });
    expect(mainClips(p)[1]!.start).toBe(4);
    p = setTransition(p, c!.id, { type: 'fade', duration: 10 });
    // photo is 3s long → at most 1.5s
    expect(mainClips(p)[2]!.transition!.duration).toBe(1.5);
    expect(mainClips(p)[2]!.start).toBe(4 + 3 - 1.5);
  });

  it('never gives the first clip a transition', () => {
    let p = projectWith(videoAsset(5), videoAsset(5));
    p = setTransitionAll(p, { type: 'fade', duration: 0.5 });
    expect(mainClips(p)[0]!.transition).toBeNull();
    expect(mainClips(p)[1]!.transition).toEqual({ type: 'fade', duration: 0.5 });
    p = reorderMainClip(p, mainClips(p)[1]!.id, 0);
    expect(mainClips(p)[0]!.transition).toBeNull();
  });

  it('closes the gap when a clip is deleted (ripple)', () => {
    const p = projectWith(videoAsset(5), videoAsset(3), videoAsset(4));
    const mid = mainClips(p)[1]!;
    const q = removeClips(p, [mid.id]);
    expect(mainClips(q).map((c) => c.start)).toEqual([0, 5]);
    expect(projectDuration(q)).toBe(9);
    // the unused asset is pruned
    expect(Object.keys(q.assets)).toHaveLength(2);
  });

  it('reorders clips', () => {
    const p = projectWith(videoAsset(5), videoAsset(3), videoAsset(4));
    const [a, b, c] = mainClips(p);
    const q = reorderMainClip(p, c!.id, 0);
    expect(mainClips(q).map((x) => x.id)).toEqual([c!.id, a!.id, b!.id]);
    expect(mainClips(q).map((x) => x.start)).toEqual([0, 4, 9]);
  });
});

describe('split', () => {
  it('cuts a video into two pieces that play the same media', () => {
    const p = projectWith(videoAsset(10));
    const clip = mainClips(p)[0]!;
    const res = splitClip(p, clip.id, 4)!;
    const [l, r] = mainClips(res.project);
    expect(res.leftId).toBe(clip.id);
    expect(l!.duration).toBe(4);
    expect(r!.duration).toBe(6);
    expect(r!.start).toBe(4);
    expect(r!.type === 'media' && r!.in).toBe(4);
  });

  it('respects speed when computing the second in-point', () => {
    let p = projectWith(videoAsset(10));
    const id = mainClips(p)[0]!.id;
    p = setSpeed(p, id, 2); // 5s long now
    expect(mainClips(p)[0]!.duration).toBe(5);
    const res = splitClip(p, id, 1)!;
    const r = mainClips(res.project)[1]!;
    expect(r.type === 'media' && r.in).toBe(2);
  });

  it('refuses tiny pieces', () => {
    const p = projectWith(videoAsset(10));
    const c = mainClips(p)[0]!;
    expect(canSplit(c, 0.01)).toBe(false);
    expect(splitClip(p, c.id, 9.99)).toBeNull();
  });

  it('keeps fades and animations on the outer ends', () => {
    let p = projectWith(videoAsset(10));
    const c = mainClips(p)[0]!;
    p = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((x) => ({ ...x, fadeIn: 1, fadeOut: 2 })) })) };
    const [l, r] = mainClips(splitClip(p, c.id, 5)!.project);
    expect(l!.type === 'media' && [l!.fadeIn, l!.fadeOut]).toEqual([1, 0]);
    expect(r!.type === 'media' && [r!.fadeIn, r!.fadeOut]).toEqual([0, 2]);
  });
});

describe('trim', () => {
  it('cannot extend a video beyond its source', () => {
    const p = projectWith(videoAsset(10));
    const c = mainClips(p)[0]!;
    const q = trimClip(p, c.id, 'end', 5);
    expect(mainClips(q)[0]!.duration).toBe(10);
    const s = trimClip(p, c.id, 'end', -20);
    expect(mainClips(s)[0]!.duration).toBe(MIN_CLIP_DURATION);
  });

  it('trimming the start on the main track ripples the following clips', () => {
    const p = projectWith(videoAsset(10), videoAsset(5));
    const c = mainClips(p)[0]!;
    const q = trimClip(p, c.id, 'start', 3);
    const [a, b] = mainClips(q);
    expect(a!.duration).toBe(7);
    expect(a!.type === 'media' && a!.in).toBe(3);
    expect(b!.start).toBe(7);
    // and cannot pull the start before the media begins
    const r = trimClip(q, c.id, 'start', -10);
    expect(mainClips(r)[0]!.duration).toBe(10);
  });

  it('trimming an overlay start moves it on the timeline', () => {
    let p = projectWith(videoAsset(10));
    const t = createTextClip('Hi', {}, { start: 2, duration: 3 });
    p = addOverlayClip(p, t);
    const q = trimClip(p, t.id, 'start', 1);
    const c = findClip(q, t.id)!.clip;
    expect([c.start, c.duration]).toEqual([3, 2]);
    const r = trimClip(p, t.id, 'start', -5);
    expect(findClip(r, t.id)!.clip.start).toBe(0);
  });
});

describe('overlay lanes', () => {
  it('puts overlapping overlays on separate lanes and removes empty lanes', () => {
    let p = projectWith(videoAsset(10));
    const a = createTextClip('A', {}, { start: 0, duration: 4 });
    const b = createTextClip('B', {}, { start: 2, duration: 4 });
    const c = createStickerClip('🔥', { start: 5, duration: 2 });
    p = addOverlayClip(p, a);
    p = addOverlayClip(p, b);
    p = addOverlayClip(p, c);
    const lanes = p.tracks.filter((t) => t.kind === 'overlay');
    expect(lanes).toHaveLength(3);
    expect(findClip(p, b.id)!.trackIndex).toBeGreaterThan(findClip(p, a.id)!.trackIndex);
    // c overlaps b (5-7 vs 2-6) so it must be above b
    expect(findClip(p, c.id)!.trackIndex).toBeGreaterThan(findClip(p, b.id)!.trackIndex);
    p = removeClips(p, [b.id, c.id]);
    expect(p.tracks.filter((t) => t.kind === 'overlay')).toHaveLength(1);
  });

  it('moving onto a busy lane bumps the clip to a free lane above', () => {
    let p = projectWith(videoAsset(10));
    const a = createTextClip('A', {}, { start: 0, duration: 4 });
    const b = createTextClip('B', {}, { start: 5, duration: 2 });
    p = addOverlayClip(p, a);
    p = addOverlayClip(p, b);
    const laneA = findClip(p, a.id)!.track.id;
    expect(findClip(p, b.id)!.track.id).toBe(laneA);
    const q = moveClip(p, b.id, 1, laneA);
    expect(findClip(q, b.id)!.track.id).not.toBe(laneA);
    expect(findClip(q, b.id)!.clip.start).toBe(1);
    const r = moveClipToNewLane(p, b.id, 6);
    expect(r.tracks.filter((t) => t.kind === 'overlay')).toHaveLength(2);
  });

  it('keeps audio lanes after overlay lanes', () => {
    let p = projectWith(videoAsset(10));
    const music = videoAsset(30, { kind: 'audio', width: 0, height: 0 });
    p = addAsset(p, music);
    p = addAudioClip(p, createMediaClip(music, { start: 0 }));
    p = addOverlayClip(p, createTextClip('T', {}, { start: 0 }));
    expect(p.tracks.map((t) => t.kind)).toEqual(['main', 'overlay', 'audio']);
  });
});

describe('speed, duplicate, segments', () => {
  it('slowing down is limited by nothing but making it longer is fine', () => {
    let p = projectWith(videoAsset(10));
    const id = mainClips(p)[0]!.id;
    p = setSpeed(p, id, 0.5);
    expect(mainClips(p)[0]!.duration).toBe(20);
  });

  it('duplicates a main clip right after the original', () => {
    const p = projectWith(videoAsset(5), videoAsset(3));
    const first = mainClips(p)[0]!;
    const res = duplicateClip(p, first.id)!;
    const clips = mainClips(res.project);
    expect(clips).toHaveLength(3);
    expect(clips[1]!.id).toBe(res.newId);
    expect(clips[1]!.start).toBe(5);
  });

  it('replaces a clip with kept segments (silence removal)', () => {
    const p = projectWith(videoAsset(10), videoAsset(2));
    const id = mainClips(p)[0]!.id;
    const q = replaceWithSegments(p, id, [
      { in: 0, out: 2 },
      { in: 4, out: 7 },
    ]);
    const clips = mainClips(q);
    expect(clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 2],
      [2, 3],
      [5, 2],
    ]);
    expect(clips[1]!.type === 'media' && clips[1]!.in).toBe(4);
  });

  it('sets several durations at once', () => {
    const p = projectWith(imageAsset(), imageAsset());
    const [a, b] = mainClips(p);
    const q = setMainDurations(p, { [a!.id]: 1.5, [b!.id]: 2.25 });
    expect(mainClips(q).map((c) => c.duration)).toEqual([1.5, 2.25]);
  });
});

describe('photo projects', () => {
  it('stacks layers and pins them to the single photo frame', () => {
    let p = createProject({ kind: 'photo', width: 4000, height: 3000 });
    const img = imageAsset();
    p = addAsset(p, img);
    p = addLayer(p, createMediaClip(img));
    p = addOverlayClip(p, createTextClip('Hello', {}, { start: 5, duration: 9 }));
    expect(p.tracks).toHaveLength(2);
    for (const t of p.tracks) {
      expect(t.clips[0]!.start).toBe(0);
      expect(t.clips[0]!.duration).toBe(PHOTO_TIME);
    }
    expect(projectDuration(p)).toBe(PHOTO_TIME);
  });
});

describe('normalizeProject', () => {
  it('returns the same object when nothing changes (cheap re-renders)', () => {
    const p = projectWith(videoAsset(5), videoAsset(5));
    expect(normalizeProject(p)).toBe(p);
  });
});
