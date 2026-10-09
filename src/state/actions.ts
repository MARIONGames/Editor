/**
 * User-level commands. Every change to the project goes through `commit`, which
 * records an undo step with a plain-language label, keeps the selection valid,
 * emits coach events and triggers autosave.
 */
import { batch } from '@preact/signals';
import {
  createMediaClip,
  createProject,
  createShapeClip,
  createStickerClip,
  createTextClip,
  DEFAULT_OVERLAY_DURATION,
  type CreateProjectOptions,
} from '../model/defaults';
import { migrateProject } from '../model/migrate';
import {
  addAsset,
  addAudioClip,
  addLayer,
  addOverlayClip,
  duplicateClip,
  findClip,
  insertMainClips,
  mainClipAt,
  mainTrack,
  projectDuration,
  removeClips,
  splitClip,
} from '../model/ops';
import { textPresetById } from '../model/textPresets';
import type { Asset, Clip, ID, MediaClip, Project, ShapeKind } from '../model/types';
import { importFile, ImportError, type ImportResult } from '../engine/media/importer';
import { registerBlob, registerDerived, releaseExcept } from '../engine/media/mediaStore';
import { releaseImages } from '../engine/media/images';
import { preview } from '../engine/preview';
import * as db from '../storage/db';
import { emit } from './events';
import { flushSave, scheduleSave } from './persist';
import {
  busy,
  editingTextId,
  history,
  historyVersion,
  panel,
  playhead,
  project,
  resetEditorState,
  route,
  selectionId,
  toast,
  type PanelId,
} from './store';

/* ------------------------------------------------------------------ commit */

export interface CommitOptions {
  /** Merge rapid changes with the same key into one undo step (sliders, drags). */
  coalesce?: string;
  /** New selection after the change (undefined = keep). */
  select?: ID | null;
}

export function commit(label: string, fn: (p: Project) => Project, opts: CommitOptions = {}): boolean {
  const prev = project.peek();
  if (!prev) return false;
  const next = fn(prev);
  if (next === prev) {
    if (opts.select !== undefined) selectionId.value = opts.select;
    return false;
  }
  history.record(prev, selectionId.peek(), label, opts.coalesce);
  batch(() => {
    project.value = { ...next, updatedAt: Date.now() };
    if (opts.select !== undefined) selectionId.value = opts.select;
    if (selectionId.peek() && !findClip(next, selectionId.peek())) selectionId.value = null;
    historyVersion.value++;
  });
  scheduleSave();
  return true;
}

/** Call at the end of a drag/slider gesture so the next one is a new undo step. */
export function endGesture(): void {
  history.breakCoalescing();
}

export function undo(): void {
  const p = project.peek();
  if (!p) return;
  const entry = history.undo({ project: p, selection: selectionId.peek(), label: '' });
  if (!entry) return;
  batch(() => {
    project.value = entry.project;
    selectionId.value = findClip(entry.project, entry.selection) ? entry.selection : null;
    historyVersion.value++;
  });
  clampPlayhead();
  scheduleSave();
  toast(`Undid: ${entry.label}`);
  emit('undo', {});
}

export function redo(): void {
  const p = project.peek();
  if (!p) return;
  const entry = history.redo({ project: p, selection: selectionId.peek(), label: '' });
  if (!entry) return;
  batch(() => {
    project.value = entry.project;
    selectionId.value = findClip(entry.project, entry.selection) ? entry.selection : null;
    historyVersion.value++;
  });
  clampPlayhead();
  scheduleSave();
  toast(`Redid: ${entry.label}`);
}

function clampPlayhead(): void {
  const p = project.peek();
  if (!p) return;
  const d = projectDuration(p);
  if (playhead.peek() > d) preview.seek(d);
}

/* ---------------------------------------------------------------- projects */

export async function newProject(opts: CreateProjectOptions): Promise<Project> {
  const p = createProject(opts);
  await openProjectObject(p);
  void db.requestPersistence();
  return p;
}

/** Frees decoded media that belongs to other projects. */
function releaseOtherMedia(p: Project | null): void {
  const keep = new Set(p ? Object.keys(p.assets) : []);
  releaseExcept(keep);
  releaseImages(keep);
}

async function openProjectObject(p: Project): Promise<void> {
  preview.stopAll();
  releaseOtherMedia(p);
  resetEditorState(p);
  route.value = { name: 'editor', projectId: p.id };
  try {
    await db.saveProject(p);
  } catch (err) {
    console.warn('Could not save project', err);
  }
  emit('project:opened', { kind: p.kind });
}

export async function openProject(id: string): Promise<boolean> {
  try {
    const raw = await db.loadProject(id);
    if (!raw) {
      toast('That project could not be found.', 'error');
      return false;
    }
    const p = migrateProject(raw);
    preview.stopAll();
    releaseOtherMedia(p);
    resetEditorState(p);
    route.value = { name: 'editor', projectId: p.id };
    emit('project:opened', { kind: p.kind });
    return true;
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not open the project.', 'error');
    return false;
  }
}

export async function closeProject(): Promise<void> {
  preview.stopAll();
  await flushSave();
  resetEditorState(null);
  releaseOtherMedia(null);
  route.value = { name: 'home' };
}

export async function duplicateProject(id: string): Promise<void> {
  const raw = await db.loadProject(id);
  if (!raw) return;
  const p = migrateProject(raw);
  const copy: Project = {
    ...p,
    id: `p${Math.random().toString(36).slice(2, 11)}`,
    name: `${p.name} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.saveProject(copy);
}

export function renameCurrent(name: string): void {
  const n = name.trim();
  if (!n) return;
  commit('Rename project', (p) => (p.name === n ? p : { ...p, name: n }));
}

/* ------------------------------------------------------------------ select */

export function select(id: ID | null): void {
  if (selectionId.peek() === id) return;
  selectionId.value = id;
  editingTextId.value = null;
  const p = project.peek();
  if (id && p) {
    const c = findClip(p, id)?.clip;
    if (c) emit('clip:selected', { id, type: c.type });
  }
  // Panels that only make sense for a selection close when nothing is selected.
  if (!id && panel.peek() && CLIP_PANELS.has(panel.peek()!)) panel.value = null;
}

const CLIP_PANELS = new Set<PanelId>([
  'adjust',
  'filters',
  'transition',
  'animation',
  'speed',
  'volume',
  'crop',
  'transform',
  'greenscreen',
  'shape',
]);

export function openPanel(id: PanelId | null): void {
  panel.value = panel.peek() === id ? null : id;
  if (id) emit('panel:opened', { panel: id });
}

/* ------------------------------------------------------------------- media */

export type ImportTarget = 'auto' | 'main' | 'overlay' | 'audio';

/** Imports files (with progress) and puts them in the project. */
export async function importFiles(files: File[], target: ImportTarget = 'auto', opts: { keepCanvas?: boolean } = {}): Promise<ID[]> {
  const p0 = project.peek();
  if (!p0 || !files.length) return [];
  const results: ImportResult[] = [];
  const errors: string[] = [];
  let cancelled = false;
  busy.value = {
    message: files.length > 1 ? `Adding ${files.length} files…` : 'Adding your file…',
    progress: 0,
    cancel: () => (cancelled = true),
  };
  try {
    for (let i = 0; i < files.length && !cancelled; i++) {
      const f = files[i]!;
      busy.value = {
        message: files.length > 1 ? `Adding ${i + 1} of ${files.length}: ${f.name}` : `Adding ${f.name}`,
        progress: i / files.length,
        cancel: busy.peek()?.cancel,
      };
      try {
        const r = await importFile(f, (pr) => {
          busy.value = { ...busy.peek()!, progress: (i + pr) / files.length };
        });
        registerBlob(r.asset.id, r.blob);
        registerDerived(r.asset.id, r.derived);
        await db.putMedia(r.asset.id, r.blob).catch((err) => {
          console.warn('putMedia failed', err);
          toast('Your device is low on storage — this project may not be saved.', 'error');
        });
        await db.putDerived(r.asset.id, r.derived).catch(() => undefined);
        results.push(r);
      } catch (err) {
        errors.push(err instanceof ImportError ? err.message : `"${f.name}" could not be added.`);
        console.error(err);
      }
    }
  } finally {
    busy.value = null;
  }
  for (const e of errors) toast(e, 'error', undefined, 6000);
  if (!results.length) return [];
  return placeImported(results.map((r) => r.asset), target, !!opts.keepCanvas);
}

/** When set, the first photo/video added to an empty video project decides its shape. */
let autoCanvasPending = false;
export function setAutoCanvas(on: boolean): void {
  autoCanvasPending = on;
}

/** Output size that matches a piece of media (short side 1080 px, even numbers for video codecs). */
export function canvasForMedia(w: number, h: number): { width: number; height: number } {
  const short = Math.min(w, h);
  const s = short > 1080 ? 1080 / short : short < 720 ? 720 / short : 1;
  const even = (v: number) => Math.max(2, Math.round((v * s) / 2) * 2);
  return { width: even(w), height: even(h) };
}

function placeImported(assets: Asset[], target: ImportTarget, keepCanvas = false): ID[] {
  const ids: ID[] = [];
  const label = assets.length > 1 ? `Add ${assets.length} items` : `Add ${assets[0]!.kind === 'audio' ? 'sound' : assets[0]!.kind}`;
  commit(label, (p) => {
    let q = p;
    for (const a of assets) q = addAsset(q, a);
    const visual = assets.filter((a) => a.kind !== 'audio');
    const audio = assets.filter((a) => a.kind === 'audio');
    if (q.kind === 'video' && autoCanvasPending && visual.length && !mainTrack(q)?.clips.length) {
      const first = visual.find((a) => a.kind === 'video') ?? visual[0]!;
      const size = canvasForMedia(first.width, first.height);
      q = { ...q, width: size.width, height: size.height };
      autoCanvasPending = false;
    }
    if (q.kind === 'photo') {
      for (const a of visual) {
        const isFirst = q.tracks.length === 0;
        const clip = createMediaClip(a, {
          fit: 'contain',
          transform: { x: 0.5, y: 0.5, scale: isFirst ? 1 : 0.6, rotation: 0, flipX: false, flipY: false },
        });
        if (isFirst && !keepCanvas) {
          // The first photo defines the canvas: full resolution, no borders.
          q = { ...q, width: a.width, height: a.height, name: q.name === 'My photo' ? stripExt(a.name) : q.name };
        }
        q = addLayer(q, clip);
        ids.push(clip.id);
      }
    } else if (target === 'overlay') {
      for (const a of visual) {
        const clip = createMediaClip(a, {
          start: playhead.peek(),
          transform: { x: 0.5, y: 0.5, scale: 0.5, rotation: 0, flipX: false, flipY: false },
          duration: a.kind === 'image' ? DEFAULT_OVERLAY_DURATION : a.duration,
        });
        q = addOverlayClip(q, clip);
        ids.push(clip.id);
      }
    } else {
      const clips = visual.map((a) =>
        createMediaClip(a, {
          fit: 'contain',
          motion: a.kind === 'image' ? 'auto' : 'none',
        }),
      );
      // Insert after the clip under the playhead (or at the end).
      const m = mainTrack(q);
      let index: number | undefined;
      if (m && m.clips.length && playhead.peek() > 0) {
        const under = mainClipAt(q, playhead.peek());
        if (under) index = m.clips.findIndex((c) => c.id === under.id) + 1;
      }
      q = insertMainClips(q, clips, index);
      ids.push(...clips.map((c) => c.id));
    }
    for (const a of audio) {
      const hasMusic = q.tracks.some((t) => t.kind === 'audio' && t.clips.length);
      const clip = createMediaClip(a, { start: hasMusic ? playhead.peek() : 0 });
      // Music shouldn't run past the video: trim it to the video length if longer.
      const videoLen = projectDuration({ ...q, tracks: q.tracks.filter((t) => t.kind !== 'audio') });
      if (videoLen > 1 && clip.start + clip.duration > videoLen) {
        clip.duration = Math.max(1, videoLen - clip.start);
        clip.fadeOut = Math.min(2, clip.duration / 3);
      }
      q = addAudioClip(q, clip);
      ids.push(clip.id);
    }
    return q;
  });
  if (ids.length === 1) selectionId.value = ids[0]!;
  emit('media:added', { count: assets.length, kinds: assets.map((a) => a.kind) });
  if (assets.some((a) => a.kind === 'audio')) emit('music:added', { id: ids[ids.length - 1]! });
  return ids;
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '') || name;
}

/** Swap the media of a clip, keeping its edits. */
export async function replaceMedia(clipId: ID, file: File): Promise<void> {
  busy.value = { message: `Replacing with ${file.name}…`, progress: null };
  try {
    const r = await importFile(file);
    registerBlob(r.asset.id, r.blob);
    registerDerived(r.asset.id, r.derived);
    await db.putMedia(r.asset.id, r.blob).catch(() => undefined);
    await db.putDerived(r.asset.id, r.derived).catch(() => undefined);
    commit('Replace media', (p) => {
      const loc = findClip(p, clipId);
      if (!loc || loc.clip.type !== 'media') return p;
      const q = addAsset(p, r.asset);
      const c = loc.clip;
      const duration =
        r.asset.kind === 'image' ? c.duration : Math.min(c.duration, r.asset.duration / c.speed);
      const clips = loc.track.clips.slice();
      clips[loc.clipIndex] = { ...c, assetId: r.asset.id, in: 0, duration } as MediaClip;
      return {
        ...q,
        tracks: q.tracks.map((t) => (t.id === loc.track.id ? { ...t, clips } : t)),
      };
    });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not replace the media.', 'error');
  } finally {
    busy.value = null;
  }
}

/* ----------------------------------------------------------------- editing */

/** The clip an action applies to: the selection, or the main clip under the playhead. */
export function targetClip(): Clip | null {
  const p = project.peek();
  if (!p) return null;
  const sel = findClip(p, selectionId.peek())?.clip;
  if (sel) return sel;
  return mainClipAt(p, playhead.peek());
}

export function splitAtPlayhead(): void {
  const p = project.peek();
  const clip = targetClip();
  if (!p || !clip) {
    toast('Move the white line over a clip, then tap Split.');
    return;
  }
  const t = playhead.peek();
  const res = splitClip(p, clip.id, t);
  if (!res) {
    toast('The white line must be inside the clip (not at its very edge) to split it.');
    return;
  }
  commit('Split clip', () => res.project, { select: res.rightId });
  emit('clip:split', { id: clip.id });
}

export function deleteSelected(): void {
  const id = selectionId.peek();
  if (!id) return;
  const p = project.peek();
  const loc = p ? findClip(p, id) : null;
  if (!loc) return;
  const name = clipNoun(loc.clip);
  commit(`Delete ${name}`, (q) => removeClips(q, [id]), { select: null });
  emit('clip:deleted', { count: 1 });
}

export function duplicateSelected(): void {
  const id = selectionId.peek();
  const p = project.peek();
  if (!id || !p) return;
  const res = duplicateClip(p, id);
  if (!res) return;
  commit('Duplicate', () => res.project, { select: res.newId });
  emit('clip:duplicated', { id: res.newId });
}

export function clipNoun(c: Clip): string {
  const p = project.peek();
  if (c.type === 'text') return 'text';
  if (c.type === 'sticker') return 'sticker';
  if (c.type === 'shape') return 'shape';
  const a = p?.assets[c.assetId];
  return a?.kind === 'audio' ? 'sound' : a?.kind === 'image' ? 'photo' : 'clip';
}

/** Generic property change on a clip (with optional coalescing for sliders). */
export function updateSelected<C extends Clip>(label: string, patch: Partial<C> | ((c: C) => Partial<C>), coalesce?: string): void {
  const id = selectionId.peek();
  if (!id) return;
  updateClipById(id, label, patch as Partial<Clip> | ((c: Clip) => Partial<Clip>), coalesce);
}

export function updateClipById(
  id: ID,
  label: string,
  patch: Partial<Clip> | ((c: Clip) => Partial<Clip>),
  coalesce?: string,
): void {
  commit(
    label,
    (p) => {
      const loc = findClip(p, id);
      if (!loc) return p;
      const pt = typeof patch === 'function' ? patch(loc.clip) : patch;
      let changed = false;
      for (const k in pt) {
        if ((loc.clip as unknown as Record<string, unknown>)[k] !== (pt as Record<string, unknown>)[k]) changed = true;
      }
      if (!changed) return p;
      const clips = loc.track.clips.slice();
      clips[loc.clipIndex] = { ...loc.clip, ...pt } as Clip;
      return { ...p, tracks: p.tracks.map((t) => (t.id === loc.track.id ? { ...t, clips } : t)) };
    },
    { coalesce: coalesce ? `${coalesce}:${id}` : undefined },
  );
}

/* ---------------------------------------------------------------- overlays */

function overlayStart(p: Project): number {
  if (p.kind === 'photo') return 0;
  const d = projectDuration(p);
  const t = playhead.peek();
  return d > 0 && t >= d - 0.05 ? Math.max(0, d - DEFAULT_OVERLAY_DURATION) : t;
}

function overlayDuration(p: Project, start: number): number {
  const d = projectDuration({ ...p, tracks: p.tracks.filter((t) => t.kind === 'main') });
  if (d <= 0) return DEFAULT_OVERLAY_DURATION;
  return Math.max(1, Math.min(DEFAULT_OVERLAY_DURATION, d - start) || DEFAULT_OVERLAY_DURATION);
}

/** Scale preset sizes (designed for a 1080 px tall canvas) to this project. */
function sizeFactor(p: Project): number {
  return Math.min(p.width, p.height) / 1080;
}

export function addText(presetId = 'title', text?: string): ID | null {
  const p = project.peek();
  if (!p) return null;
  const preset = textPresetById(presetId) ?? textPresetById('title')!;
  const start = overlayStart(p);
  const k = sizeFactor(p);
  const style = { ...preset.style, size: Math.round((preset.style.size ?? 96) * k) };
  const clip = createTextClip(text ?? preset.sample, style, {
    start,
    duration: overlayDuration(p, start),
    animation: {
      in: preset.animation?.in ?? 'fade',
      inDuration: preset.animation?.inDuration ?? 0.5,
      out: preset.animation?.out ?? 'fade',
      outDuration: preset.animation?.outDuration ?? 0.4,
      loop: preset.animation?.loop ?? 'none',
    },
  });
  commit('Add text', (q) => addOverlayClip(q, clip), { select: clip.id });
  editingTextId.value = clip.id;
  emit('text:added', { id: clip.id });
  return clip.id;
}

export function addSticker(emoji: string): void {
  const p = project.peek();
  if (!p) return;
  const start = overlayStart(p);
  const k = sizeFactor(p);
  const offset = (p.tracks.length % 5) * 0.04;
  const clip = createStickerClip(emoji, {
    start,
    duration: overlayDuration(p, start),
    size: Math.round(260 * k),
    transform: { x: 0.5 + offset, y: 0.42 + offset, scale: 1, rotation: 0, flipX: false, flipY: false },
    animation: { in: 'pop', inDuration: 0.45, out: 'fade', outDuration: 0.3, loop: 'none' },
  });
  commit('Add sticker', (q) => addOverlayClip(q, clip), { select: clip.id });
  emit('sticker:added', { id: clip.id });
}

export function addShape(shape: ShapeKind): void {
  const p = project.peek();
  if (!p) return;
  const start = overlayStart(p);
  const k = sizeFactor(p);
  const base = createShapeClip(shape);
  const clip = createShapeClip(shape, {
    start,
    duration: overlayDuration(p, start),
    width: Math.round(base.width * k),
    height: Math.round(base.height * k),
    fill: shape === 'arrow' ? '#ff4d6d' : shape === 'heart' ? '#ff4d6d' : shape === 'star' ? '#ffd23f' : '#ffffff',
    animation: { in: 'pop', inDuration: 0.4, out: 'fade', outDuration: 0.3, loop: 'none' },
  });
  commit('Add shape', (q) => addOverlayClip(q, clip), { select: clip.id });
}

/* -------------------------------------------------------------- misc views */

export function seekToClip(id: ID): void {
  const p = project.peek();
  const c = p ? findClip(p, id)?.clip : null;
  if (c) preview.seek(c.start);
}

export async function deleteProjectById(id: string): Promise<void> {
  await db.deleteProject(id);
}
