/**
 * Pure, immutable editing operations.
 *
 * Every function takes a project and returns a new project (or the same object when
 * nothing changed). Unchanged tracks and clips keep their identity, so the UI can
 * cheaply skip re-rendering them and undo/redo is just keeping old references.
 */
import { uid } from '../util/id';
import { clamp, round } from '../util/math';
import {
  MAX_STILL_DURATION,
  MIN_CLIP_DURATION,
  NEUTRAL_ADJUST,
  PHOTO_TIME,
  createTrack,
} from './defaults';
import type {
  AdjustKey,
  Asset,
  Background,
  Clip,
  ClipLocation,
  Effects,
  FilterRef,
  ID,
  MediaClip,
  Project,
  Track,
  TrackKind,
  Transform,
  Transition,
} from './types';

const EPS = 1e-6;
const r6 = (v: number) => round(v, 6);

/* ------------------------------------------------------------------ queries */

export function findClip(p: Project, clipId: ID | null | undefined): ClipLocation | null {
  if (!clipId) return null;
  for (let ti = 0; ti < p.tracks.length; ti++) {
    const track = p.tracks[ti]!;
    const ci = track.clips.findIndex((c) => c.id === clipId);
    if (ci >= 0) return { track, trackIndex: ti, clip: track.clips[ci]!, clipIndex: ci };
  }
  return null;
}

export function getClip(p: Project, clipId: ID | null | undefined): Clip | null {
  return findClip(p, clipId)?.clip ?? null;
}

export function mainTrack(p: Project): Track | undefined {
  return p.tracks.find((t) => t.kind === 'main');
}

export const clipEnd = (c: Clip): number => c.start + c.duration;

export function projectDuration(p: Project): number {
  if (p.kind === 'photo') return PHOTO_TIME;
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return r6(end);
}

export function assetOf(p: Project, clip: Clip | null | undefined): Asset | undefined {
  return clip && clip.type === 'media' ? p.assets[clip.assetId] : undefined;
}

/** Whether the clip's media has a fixed length (video/audio) that limits trimming. */
export function hasFiniteSource(p: Project, clip: Clip): boolean {
  const a = assetOf(p, clip);
  return !!a && (a.kind === 'video' || a.kind === 'audio');
}

/** Longest the clip may be on the timeline from its current in-point. */
export function maxClipDuration(p: Project, clip: Clip): number {
  if (clip.type === 'media' && hasFiniteSource(p, clip)) {
    const a = p.assets[clip.assetId]!;
    return Math.max(MIN_CLIP_DURATION, (a.duration - clip.in) / clip.speed);
  }
  return MAX_STILL_DURATION;
}

/** Clips that are visible/audible at time t on a track. */
export function clipsAt(track: Track, t: number): Clip[] {
  const out: Clip[] = [];
  for (const c of track.clips) if (t >= c.start - EPS && t < clipEnd(c) - EPS) out.push(c);
  return out;
}

export function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - EPS && b0 < a1 - EPS;
}

/** Does any clip on the track (other than `ignoreId`) overlap [start, end)? */
export function trackHasOverlap(track: Track, start: number, end: number, ignoreId?: ID): boolean {
  return track.clips.some((c) => c.id !== ignoreId && rangesOverlap(start, end, c.start, clipEnd(c)));
}

/* --------------------------------------------------------- immutable helpers */

function withTracks(p: Project, tracks: Track[]): Project {
  return tracks === p.tracks ? p : { ...p, tracks };
}

export function mapTrack(p: Project, trackId: ID, fn: (t: Track) => Track): Project {
  let changed = false;
  const tracks = p.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const n = fn(t);
    if (n !== t) changed = true;
    return n;
  });
  return changed ? { ...p, tracks } : p;
}

export function mapClip(p: Project, clipId: ID, fn: (c: Clip) => Clip): Project {
  const loc = findClip(p, clipId);
  if (!loc) return p;
  const next = fn(loc.clip);
  if (next === loc.clip) return p;
  const clips = loc.track.clips.slice();
  clips[loc.clipIndex] = next;
  return mapTrack(p, loc.track.id, (t) => ({ ...t, clips }));
}

/** Shallow-merge a patch into a clip (type-safe for the common fields). */
export function updateClip<C extends Clip>(p: Project, clipId: ID, patch: Partial<C>): Project {
  return normalizeProject(
    mapClip(p, clipId, (c) => {
      for (const k in patch) {
        if ((c as unknown as Record<string, unknown>)[k] !== (patch as Record<string, unknown>)[k]) {
          return { ...c, ...patch } as Clip;
        }
      }
      return c;
    }),
  );
}

/* -------------------------------------------------------------- normalising */

/** Packs the magnetic main track and clamps transitions. */
function layoutMainTrack(track: Track): Track {
  let changed = false;
  const clips: Clip[] = [];
  let prev: Clip | null = null;
  for (let i = 0; i < track.clips.length; i++) {
    let c = track.clips[i]!;
    let transition: Transition | null = c.transition;
    if (i === 0 || !prev) {
      transition = null;
    } else if (transition) {
      const maxT = Math.min(prev.duration, c.duration) / 2;
      if (maxT < 0.1) transition = null;
      else {
        const d = r6(clamp(transition.duration, 0.1, maxT));
        if (d !== transition.duration) transition = { ...transition, duration: d };
      }
    }
    const start: number = prev ? r6(clipEnd(prev) - (transition ? transition.duration : 0)) : 0;
    if (start !== c.start || transition !== c.transition) {
      c = { ...c, start, transition };
      changed = true;
    }
    clips.push(c);
    prev = c;
  }
  return changed ? { ...track, clips } : track;
}

function sortTrack(track: Track): Track {
  for (let i = 1; i < track.clips.length; i++) {
    if (track.clips[i]!.start < track.clips[i - 1]!.start) {
      return { ...track, clips: track.clips.slice().sort((a, b) => a.start - b.start) };
    }
  }
  return track;
}

/** Moves clips that overlap within an overlay/audio lane to a free lane above. */
function resolveLaneOverlaps(tracks: Track[]): Track[] {
  let out = tracks;
  for (let ti = 0; ti < out.length; ti++) {
    const track = out[ti]!;
    if (track.kind === 'main' || track.clips.length < 2) continue;
    const keep: Clip[] = [];
    const bumped: Clip[] = [];
    let end = -Infinity;
    for (const c of track.clips) {
      if (c.start < end - EPS) bumped.push(c);
      else {
        keep.push(c);
        end = clipEnd(c);
      }
    }
    if (!bumped.length) continue;
    out = out.slice();
    out[ti] = { ...track, clips: keep };
    for (const c of bumped) out = placeInLaneAbove(out, track.kind, c, ti);
  }
  return out;
}

/** Puts a clip in the first lane of `kind` above index `fromIndex` that is free; creates one if needed. */
function placeInLaneAbove(tracks: Track[], kind: TrackKind, clip: Clip, fromIndex: number): Track[] {
  for (let i = fromIndex + 1; i < tracks.length; i++) {
    const t = tracks[i]!;
    if (t.kind !== kind) continue;
    if (!trackHasOverlap(t, clip.start, clipEnd(clip))) {
      const out = tracks.slice();
      out[i] = insertSorted(t, clip);
      return out;
    }
  }
  const lane = { ...createTrack(kind), clips: [clip] };
  const out = tracks.slice();
  out.splice(insertIndexForNewLane(tracks, kind, fromIndex), 0, lane);
  return out;
}

function insertIndexForNewLane(tracks: Track[], kind: TrackKind, fromIndex: number): number {
  if (kind === 'audio') return tracks.length;
  // New overlay lanes go directly above the highest overlay lane at/after fromIndex (or main).
  let idx = Math.max(0, fromIndex + 1);
  for (let i = 0; i < tracks.length; i++) if (tracks[i]!.kind !== 'audio') idx = Math.max(idx, i + 1);
  // Keep audio lanes last.
  const firstAudio = tracks.findIndex((t) => t.kind === 'audio');
  return firstAudio >= 0 ? Math.min(idx, firstAudio) : idx;
}

function insertSorted(track: Track, clip: Clip): Track {
  const clips = track.clips.slice();
  let i = clips.findIndex((c) => c.start > clip.start);
  if (i < 0) i = clips.length;
  clips.splice(i, 0, clip);
  return { ...track, clips };
}

/**
 * Restores every invariant of the model. Called after each op.
 * - main track packed from 0, transitions clamped
 * - lanes sorted and overlap-free
 * - empty overlay/audio lanes removed; video projects always have a main track at index 0
 * - photo projects keep every layer at [0, PHOTO_TIME)
 */
export function normalizeProject(p: Project): Project {
  let tracks = p.tracks.map((t) => {
    if (t.kind === 'main') return layoutMainTrack(t);
    if (p.kind === 'photo') {
      let changed = false;
      const clips = t.clips.map((c) => {
        if (c.start === 0 && c.duration === PHOTO_TIME) return c;
        changed = true;
        return { ...c, start: 0, duration: PHOTO_TIME };
      });
      return changed ? { ...t, clips } : t;
    }
    return sortTrack(t);
  });
  if (p.kind === 'video') tracks = resolveLaneOverlaps(tracks);
  if (tracks.some((t) => t.kind !== 'main' && t.clips.length === 0)) {
    tracks = tracks.filter((t) => t.kind === 'main' || t.clips.length > 0);
  }
  if (p.kind === 'video') {
    const mi = tracks.findIndex((t) => t.kind === 'main');
    if (mi < 0) tracks = [createTrack('main'), ...tracks];
    else if (mi > 0) {
      const m = tracks[mi]!;
      tracks = [m, ...tracks.filter((_, i) => i !== mi)];
    }
  }
  // Same contents → keep identity.
  if (tracks.length === p.tracks.length && tracks.every((t, i) => t === p.tracks[i])) return p;
  return { ...p, tracks };
}

/* -------------------------------------------------------------------- assets */

export function addAsset(p: Project, asset: Asset): Project {
  if (p.assets[asset.id] === asset) return p;
  return { ...p, assets: { ...p.assets, [asset.id]: asset } };
}

/** Removes assets no clip uses any more (keeps the project file small). */
export function pruneAssets(p: Project): Project {
  const used = new Set<string>();
  for (const t of p.tracks) for (const c of t.clips) if (c.type === 'media') used.add(c.assetId);
  const ids = Object.keys(p.assets);
  if (ids.every((id) => used.has(id))) return p;
  const assets: Record<string, Asset> = {};
  for (const id of ids) if (used.has(id)) assets[id] = p.assets[id]!;
  return { ...p, assets };
}

/* --------------------------------------------------------------- add clips */

/** Inserts clips on the magnetic main track (at `index`, default: the end). */
export function insertMainClips(p: Project, clips: Clip[], index?: number): Project {
  let track = mainTrack(p);
  let base = p;
  if (!track) {
    track = createTrack('main');
    base = { ...p, tracks: [track, ...p.tracks] };
  }
  const list = track.clips.slice();
  const at = index === undefined ? list.length : clamp(index, 0, list.length);
  list.splice(at, 0, ...clips);
  return normalizeProject(mapTrack(base, track.id, (t) => ({ ...t, clips: list })));
}

/**
 * Adds an overlay (text, sticker, shape, picture-in-picture) at `clip.start`.
 * It goes into a lane above anything it overlaps so new things appear on top.
 */
export function addOverlayClip(p: Project, clip: Clip): Project {
  if (p.kind === 'photo') return addLayer(p, clip);
  return normalizeProject(withTracks(p, placeAuto(p.tracks, 'overlay', clip)));
}

export function addAudioClip(p: Project, clip: Clip): Project {
  return normalizeProject(withTracks(p, placeAuto(p.tracks, 'audio', clip)));
}

function placeAuto(tracks: Track[], kind: TrackKind, clip: Clip): Track[] {
  const start = clip.start;
  const end = clipEnd(clip);
  if (kind === 'overlay') {
    let highestOverlap = -1;
    tracks.forEach((t, i) => {
      if (t.kind === 'overlay' && trackHasOverlap(t, start, end)) highestOverlap = i;
    });
    if (highestOverlap < 0) {
      const first = tracks.findIndex((t) => t.kind === 'overlay');
      if (first >= 0) {
        const out = tracks.slice();
        out[first] = insertSorted(tracks[first]!, clip);
        return out;
      }
      const mi = tracks.findIndex((t) => t.kind === 'main');
      return placeInLaneAbove(tracks, kind, clip, mi);
    }
    return placeInLaneAbove(tracks, kind, clip, highestOverlap);
  }
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]!;
    if (t.kind === kind && !trackHasOverlap(t, start, end)) {
      const out = tracks.slice();
      out[i] = insertSorted(t, clip);
      return out;
    }
  }
  return placeInLaneAbove(tracks, kind, clip, tracks.length - 1);
}

/** Photo projects: a new layer on top of all others. */
export function addLayer(p: Project, clip: Clip): Project {
  const lane: Track = { ...createTrack('overlay'), clips: [{ ...clip, start: 0, duration: PHOTO_TIME }] };
  return normalizeProject({ ...p, tracks: [...p.tracks, lane] });
}

/* ------------------------------------------------------------ remove clips */

export function removeClips(p: Project, ids: ID[]): Project {
  if (!ids.length) return p;
  const set = new Set(ids);
  let changed = false;
  const tracks = p.tracks.map((t) => {
    if (!t.clips.some((c) => set.has(c.id))) return t;
    changed = true;
    return { ...t, clips: t.clips.filter((c) => !set.has(c.id)) };
  });
  return changed ? pruneAssets(normalizeProject({ ...p, tracks })) : p;
}

/* ------------------------------------------------------------------- split */

export interface SplitResult {
  project: Project;
  leftId: ID;
  rightId: ID;
}

/** Can the clip be cut at time t (both pieces must be at least MIN_CLIP_DURATION)? */
export function canSplit(clip: Clip, t: number): boolean {
  const local = t - clip.start;
  return local >= MIN_CLIP_DURATION - EPS && clip.duration - local >= MIN_CLIP_DURATION - EPS;
}

/** Cuts a clip into two pieces at time t. The left piece keeps the original id. */
export function splitClip(p: Project, clipId: ID, t: number): SplitResult | null {
  const loc = findClip(p, clipId);
  if (!loc || p.kind === 'photo') return null;
  const c = loc.clip;
  if (!canSplit(c, t)) return null;
  const local = r6(t - c.start);
  const rightId = uid('c');
  const left = {
    ...c,
    duration: local,
    animation: { ...c.animation, out: 'none' as const },
  } as Clip;
  const right = {
    ...c,
    id: rightId,
    start: r6(t),
    duration: r6(c.duration - local),
    transition: null,
    animation: { ...c.animation, in: 'none' as const },
  } as Clip;
  if (left.type === 'media' && right.type === 'media' && c.type === 'media') {
    left.fadeOut = 0;
    right.fadeIn = 0;
    right.in = r6(c.in + local * c.speed);
  }
  const clips = loc.track.clips.slice();
  clips.splice(loc.clipIndex, 1, left, right);
  const project = normalizeProject(mapTrack(p, loc.track.id, (tr) => ({ ...tr, clips })));
  return { project, leftId: c.id, rightId };
}

/* -------------------------------------------------------------------- trim */

export type Edge = 'start' | 'end';

/**
 * Moves one edge of a clip by `delta` seconds (positive = to the right).
 * On the main track, trimming the start shortens the clip and everything after it
 * slides left (ripple), like every beginner expects.
 */
export function trimClip(p: Project, clipId: ID, edge: Edge, delta: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || p.kind === 'photo') return p;
  const c = loc.clip;
  const isMain = loc.track.kind === 'main';
  if (edge === 'end') {
    const dur = clamp(c.duration + delta, MIN_CLIP_DURATION, maxClipDuration(p, c));
    return updateClip(p, clipId, { duration: r6(dur) });
  }
  // start edge
  let lo = -Infinity;
  const hi = c.duration - MIN_CLIP_DURATION;
  if (c.type === 'media' && hasFiniteSource(p, c)) lo = -c.in / c.speed;
  else lo = c.duration - MAX_STILL_DURATION;
  if (!isMain) lo = Math.max(lo, -c.start);
  const d = clamp(delta, lo, hi);
  if (Math.abs(d) < EPS) return p;
  const patch: Partial<Clip> = { duration: r6(c.duration - d) };
  if (!isMain) patch.start = r6(c.start + d);
  if (c.type === 'media') (patch as Partial<MediaClip>).in = r6(Math.max(0, c.in + d * c.speed));
  return updateClip(p, clipId, patch);
}

/* -------------------------------------------------------------------- move */

/** Reorders a clip on the magnetic main track. */
export function reorderMainClip(p: Project, clipId: ID, toIndex: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.kind !== 'main') return p;
  const clips = loc.track.clips.slice();
  clips.splice(loc.clipIndex, 1);
  const at = clamp(toIndex, 0, clips.length);
  if (at === loc.clipIndex) return p;
  clips.splice(at, 0, loc.clip);
  return normalizeProject(mapTrack(p, loc.track.id, (t) => ({ ...t, clips })));
}

/**
 * Moves an overlay/audio clip to a new start time and (optionally) a specific lane.
 * If the lane is busy at that time, the clip goes to a free lane above.
 */
export function moveClip(p: Project, clipId: ID, start: number, targetTrackId?: ID): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.kind === 'main' || p.kind === 'photo') return p;
  const moved = { ...loc.clip, start: r6(Math.max(0, start)) } as Clip;
  const target = p.tracks.find((t) => t.id === (targetTrackId ?? loc.track.id));
  // remove from source lane
  let tracks = p.tracks.map((t) =>
    t.id === loc.track.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
  );
  const kind = loc.track.kind;
  const ti = target && target.kind === kind ? tracks.findIndex((t) => t.id === target.id) : -1;
  if (ti >= 0 && !trackHasOverlap(tracks[ti]!, moved.start, clipEnd(moved))) {
    tracks = tracks.slice();
    tracks[ti] = insertSorted(tracks[ti]!, moved);
  } else if (ti >= 0) {
    tracks = placeInLaneAbove(tracks, kind, moved, ti);
  } else {
    tracks = placeAuto(tracks, kind, moved);
  }
  return normalizeProject({ ...p, tracks });
}

/** Moves a clip into a brand-new lane at the top (or bottom for audio). */
export function moveClipToNewLane(p: Project, clipId: ID, start: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.kind === 'main' || p.kind === 'photo') return p;
  const moved = { ...loc.clip, start: r6(Math.max(0, start)) } as Clip;
  const tracks = p.tracks.map((t) =>
    t.id === loc.track.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
  );
  const lane: Track = { ...createTrack(loc.track.kind), clips: [moved] };
  const idx = insertIndexForNewLane(tracks, loc.track.kind, tracks.length - 1);
  tracks.splice(idx, 0, lane);
  return normalizeProject({ ...p, tracks });
}

/** Photo projects: change layer order (index in project.tracks). */
export function moveLayer(p: Project, trackId: ID, toIndex: number): Project {
  const from = p.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return p;
  const tracks = p.tracks.slice();
  const [t] = tracks.splice(from, 1);
  const at = clamp(toIndex, 0, tracks.length);
  if (at === from) return p;
  tracks.splice(at, 0, t!);
  return normalizeProject({ ...p, tracks });
}

/* --------------------------------------------------------------- duplicate */

export function cloneClip<C extends Clip>(c: C): C {
  return structuredCloneSafe({ ...c, id: uid('c') });
}

function structuredCloneSafe<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

export function duplicateClip(p: Project, clipId: ID): { project: Project; newId: ID } | null {
  const loc = findClip(p, clipId);
  if (!loc) return null;
  const copy = cloneClip(loc.clip);
  if (p.kind === 'photo') {
    copy.transform = {
      ...copy.transform,
      x: clamp(copy.transform.x + 0.04, 0, 1),
      y: clamp(copy.transform.y + 0.04, 0, 1),
    };
    const lane: Track = { ...createTrack('overlay'), clips: [copy] };
    const tracks = p.tracks.slice();
    tracks.splice(loc.trackIndex + 1, 0, lane);
    return { project: normalizeProject({ ...p, tracks }), newId: copy.id };
  }
  if (loc.track.kind === 'main') {
    copy.transition = null;
    return { project: insertMainClips(p, [copy], loc.clipIndex + 1), newId: copy.id };
  }
  copy.start = clipEnd(loc.clip);
  const project =
    loc.track.kind === 'audio' ? addAudioClip(p, copy) : addOverlayClip(p, copy);
  return { project, newId: copy.id };
}

/* -------------------------------------------------------------- properties */

export function setTransform(p: Project, clipId: ID, patch: Partial<Transform>): Project {
  return mapClip(p, clipId, (c) => {
    const t = { ...c.transform, ...patch };
    return shallowEqual(t, c.transform) ? c : ({ ...c, transform: t } as Clip);
  });
}

export function setEffects(p: Project, clipId: ID, patch: Partial<Effects>): Project {
  return mapClip(p, clipId, (c) => ({ ...c, effects: { ...c.effects, ...patch } }) as Clip);
}

export function setAdjust(p: Project, clipId: ID, key: AdjustKey, value: number): Project {
  return mapClip(p, clipId, (c) => {
    if (c.effects.adjust[key] === value) return c;
    return { ...c, effects: { ...c.effects, adjust: { ...c.effects.adjust, [key]: value } } } as Clip;
  });
}

export function resetAdjust(p: Project, clipId: ID): Project {
  return mapClip(
    p,
    clipId,
    (c) => ({ ...c, effects: { ...c.effects, adjust: { ...NEUTRAL_ADJUST } } }) as Clip,
  );
}

export function setFilter(p: Project, clipId: ID, filter: FilterRef | null): Project {
  return mapClip(p, clipId, (c) => ({ ...c, effects: { ...c.effects, filter } }) as Clip);
}

/** Speed change keeps the same piece of source media (so the clip gets shorter/longer). */
export function setSpeed(p: Project, clipId: ID, speed: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.type !== 'media') return p;
  const c = loc.clip;
  const s = clamp(speed, 0.1, 8);
  if (Math.abs(s - c.speed) < EPS) return p;
  const span = c.duration * c.speed;
  let duration = span / s;
  if (hasFiniteSource(p, c)) {
    const a = p.assets[c.assetId]!;
    duration = Math.min(duration, (a.duration - c.in) / s);
  }
  return updateClip<MediaClip>(p, clipId, {
    speed: s,
    duration: r6(Math.max(MIN_CLIP_DURATION, duration)),
  });
}

export function setTransition(p: Project, clipId: ID, transition: Transition | null): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.kind !== 'main' || loc.clipIndex === 0) return p;
  return normalizeProject(mapClip(p, clipId, (c) => ({ ...c, transition }) as Clip));
}

export function setTransitionAll(p: Project, transition: Transition | null): Project {
  const m = mainTrack(p);
  if (!m) return p;
  const clips = m.clips.map((c, i) => (i === 0 ? c : ({ ...c, transition } as Clip)));
  return normalizeProject(mapTrack(p, m.id, (t) => ({ ...t, clips })));
}

export function setTrackProps(
  p: Project,
  trackId: ID,
  patch: Partial<Pick<Track, 'muted' | 'hidden' | 'locked' | 'volume'>>,
): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, ...patch }));
}

export function setCanvas(p: Project, width: number, height: number): Project {
  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(height));
  if (w === p.width && h === p.height) return p;
  return { ...p, width: w, height: h };
}

export function setBackground(p: Project, patch: Partial<Background>): Project {
  return { ...p, background: { ...p.background, ...patch } };
}

export function renameProject(p: Project, name: string): Project {
  const n = name.trim() || p.name;
  return n === p.name ? p : { ...p, name: n };
}

/* ----------------------------------------------------- multi-clip rewrites */

/**
 * Replaces a main-track clip with several pieces of the same source
 * (used by "Remove silent parts"). Ranges are in source seconds.
 */
export function replaceWithSegments(
  p: Project,
  clipId: ID,
  ranges: { in: number; out: number }[],
): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.type !== 'media' || loc.track.kind !== 'main' || !ranges.length) return p;
  const c = loc.clip;
  const pieces: Clip[] = ranges
    .filter((r) => r.out - r.in >= MIN_CLIP_DURATION * c.speed)
    .map((r, i) => ({
      ...c,
      id: i === 0 ? c.id : uid('c'),
      in: r6(r.in),
      duration: r6((r.out - r.in) / c.speed),
      transition: i === 0 ? c.transition : null,
      fadeIn: i === 0 ? c.fadeIn : 0,
      fadeOut: i === ranges.length - 1 ? c.fadeOut : 0,
    }));
  if (!pieces.length) return p;
  const clips = loc.track.clips.slice();
  clips.splice(loc.clipIndex, 1, ...pieces);
  return normalizeProject(mapTrack(p, loc.track.id, (t) => ({ ...t, clips })));
}

/** Sets durations of several main-track clips at once (used by beat sync). */
export function setMainDurations(p: Project, durations: Record<ID, number>): Project {
  const m = mainTrack(p);
  if (!m) return p;
  let changed = false;
  const clips = m.clips.map((c) => {
    const d = durations[c.id];
    if (d === undefined) return c;
    const nd = r6(clamp(d, MIN_CLIP_DURATION, maxClipDuration(p, c)));
    if (nd === c.duration) return c;
    changed = true;
    return { ...c, duration: nd } as Clip;
  });
  return changed ? normalizeProject(mapTrack(p, m.id, (t) => ({ ...t, clips }))) : p;
}

/* -------------------------------------------------------------------- misc */

function shallowEqual(a: object, b: object): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/** Which main-track clip is "under" time t (prefers the incoming clip during a transition). */
export function mainClipAt(p: Project, t: number): Clip | null {
  const m = mainTrack(p);
  if (!m) return null;
  const at = clipsAt(m, t);
  return at.length ? at[at.length - 1]! : null;
}

/** Every clip in the project, in drawing order. */
export function allClips(p: Project): Clip[] {
  const out: Clip[] = [];
  for (const t of p.tracks) out.push(...t.clips);
  return out;
}
