/** Magic features wired to the project: analyse media, then apply ordinary undoable edits. */
import { ADJUST_KEYS, NEUTRAL_ADJUST } from '../model/defaults';
import { findClip, mainTrack, projectDuration, replaceWithSegments, setMainDurations } from '../model/ops';
import type { Adjustments, Clip, MediaClip, Project } from '../model/types';
import { getDerivedData } from '../engine/media/mediaStore';
import { loadAudio } from '../engine/audio/library';
import { makeCanvas } from '../engine/render/rasterize';
import { commit } from '../state/actions';
import { emit } from '../state/events';
import { busy, project, selectionId, toast } from '../state/store';
import { autoAdjust, imageStats } from './enhance';
import { beatDurations, detectBeats, onsetEnvelope } from './beats';
import { DEFAULT_SILENCE, findKeepRanges, totalLength } from './silence';
import { formatDuration } from '../model/time';

async function statsForClip(p: Project, clip: MediaClip) {
  const d = await getDerivedData(clip.assetId);
  if (!d || !d.thumbs.length) return null;
  const asset = p.assets[clip.assetId];
  let idx = 0;
  if (asset?.kind === 'video' && d.thumbInterval > 0) {
    const mid = clip.in + (clip.duration * clip.speed) / 2;
    idx = Math.min(d.thumbs.length - 1, Math.floor(mid / d.thumbInterval));
  }
  const bmp = await createImageBitmap(d.thumbs[idx]!);
  const w = Math.min(160, bmp.width);
  const h = Math.max(1, Math.round((w * bmp.height) / bmp.width));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  // Respect the crop: only analyse what is visible.
  const cr = clip.crop;
  ctx.drawImage(
    bmp,
    cr.left * bmp.width,
    cr.top * bmp.height,
    bmp.width * (1 - cr.left - cr.right),
    bmp.height * (1 - cr.top - cr.bottom),
    0,
    0,
    w,
    h,
  );
  bmp.close();
  return imageStats(ctx.getImageData(0, 0, w, h).data);
}

function visualMediaClips(p: Project): MediaClip[] {
  const out: MediaClip[] = [];
  for (const t of p.tracks)
    for (const c of t.clips)
      if (c.type === 'media' && p.assets[c.assetId]?.kind !== 'audio') out.push(c);
  return out;
}

/** Auto-enhance one clip, or every photo/video when `all` is true. */
export async function autoEnhance(all = false): Promise<void> {
  const p = project.peek();
  if (!p) return;
  const sel = findClip(p, selectionId.peek())?.clip;
  let targets: MediaClip[];
  if (!all && sel?.type === 'media' && p.assets[sel.assetId]?.kind !== 'audio') targets = [sel];
  else targets = visualMediaClips(p);
  if (!targets.length) {
    toast('Add a photo or video first.');
    return;
  }
  busy.value = { message: 'Making it look better…', progress: null };
  try {
    const patches = new Map<string, Partial<Adjustments>>();
    for (const c of targets) {
      const s = await statsForClip(p, c);
      if (s) patches.set(c.id, autoAdjust(s));
    }
    commit(targets.length > 1 ? 'Auto-enhance all' : 'Auto-enhance', (q) => {
      let out = q;
      for (const [id, patch] of patches) {
        const loc = findClip(out, id);
        if (!loc) continue;
        const adjust = { ...loc.clip.effects.adjust };
        // Replace the light/colour basics; keep creative choices (blur, grain…).
        for (const key of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'vibrance', 'clarity'] as const) {
          adjust[key] = patch[key] ?? NEUTRAL_ADJUST[key];
        }
        const clips = loc.track.clips.slice();
        clips[loc.clipIndex] = { ...loc.clip, effects: { ...loc.clip.effects, adjust } } as Clip;
        out = { ...out, tracks: out.tracks.map((t) => (t.id === loc.track.id ? { ...t, clips } : t)) };
      }
      return out;
    });
    emit('magic:used', { name: 'auto-enhance' });
    toast(targets.length > 1 ? `Enhanced ${patches.size} clips ✨` : 'Enhanced ✨ — tap Undo if you prefer the original.', 'success');
  } catch (err) {
    console.error(err);
    toast('Auto-enhance could not analyse this picture.', 'error');
  } finally {
    busy.value = null;
  }
}

export function hasAdjustments(c: Clip): boolean {
  return ADJUST_KEYS.some((k) => c.effects.adjust[k] !== 0);
}

/** Cuts out pauses in speech from the selected clip (or every main clip with sound). */
export async function removeSilences(): Promise<void> {
  const p = project.peek();
  if (!p) return;
  const sel = findClip(p, selectionId.peek());
  const m = mainTrack(p);
  let targets: MediaClip[] = [];
  if (sel && sel.track.kind === 'main' && sel.clip.type === 'media') targets = [sel.clip];
  else if (m) targets = m.clips.filter((c): c is MediaClip => c.type === 'media' && !!p.assets[c.assetId]?.hasAudio && p.assets[c.assetId]?.kind === 'video');
  if (!targets.length) {
    toast('This works on videos with talking in them. Add a video first.');
    return;
  }
  busy.value = { message: 'Listening for silent parts…', progress: null };
  try {
    let removed = 0;
    let places = 0;
    const plan: { id: string; ranges: { in: number; out: number }[] }[] = [];
    for (const c of targets) {
      const d = await getDerivedData(c.assetId);
      if (!d?.rms) continue;
      const srcOut = c.in + c.duration * c.speed;
      const keep = findKeepRanges(d.rms, 100, c.in, srcOut, DEFAULT_SILENCE);
      const kept = totalLength(keep);
      if (keep.length && srcOut - c.in - kept > 0.3) {
        removed += (srcOut - c.in - kept) / c.speed;
        places += Math.max(1, keep.length - 1 + (keep[0]!.in > c.in + 0.05 ? 1 : 0));
        plan.push({ id: c.id, ranges: keep });
      }
    }
    if (!plan.length) {
      toast('No long silent parts found — nice and tight already!', 'success');
      return;
    }
    commit('Remove silent parts', (q) => plan.reduce((acc, item) => replaceWithSegments(acc, item.id, item.ranges), q));
    emit('magic:used', { name: 'silence' });
    toast(`Removed ${formatDuration(removed)} of silence in ${places} place${places === 1 ? '' : 's'} ✂️`, 'success');
  } finally {
    busy.value = null;
  }
}

/** Times the photos to the beat of the music. */
export async function beatSync(): Promise<void> {
  const p = project.peek();
  if (!p) return;
  const music = p.tracks
    .filter((t) => t.kind === 'audio')
    .flatMap((t) => t.clips)
    .find((c): c is MediaClip => c.type === 'media');
  const m = mainTrack(p);
  const photos = m?.clips.filter((c) => c.type === 'media' && p.assets[c.assetId]?.kind === 'image') ?? [];
  if (!music) {
    toast('Add music first (Music button), then try Beat sync.');
    return;
  }
  if (photos.length < 2) {
    toast('Beat sync needs at least two photos in your video.');
    return;
  }
  busy.value = { message: 'Finding the beat…', progress: null };
  try {
    const buf = await loadAudio(music.assetId);
    if (!buf) {
      toast('Could not read that music file.', 'error');
      return;
    }
    // Analyse the part of the song that is used (at most 60 s, mono, 11 kHz).
    const sr = buf.sampleRate;
    const from = Math.floor(music.in * sr);
    const to = Math.min(buf.length, from + Math.floor(60 * sr));
    const step = Math.max(1, Math.round(sr / 11025));
    const mono = new Float32Array(Math.floor((to - from) / step));
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < mono.length; i++) mono[i]! += d[from + i * step]! / buf.numberOfChannels;
    }
    const beat = detectBeats(onsetEnvelope(mono, sr / step));
    const allPhotos = m!.clips.every((c) => c.type === 'media' && p.assets[c.assetId]?.kind === 'image');
    const durations: Record<string, number> = {};
    if (allPhotos) {
      // Shift the beat grid by where the song starts on the timeline.
      const shifted = { ...beat, offset: beat.offset + music.start };
      const ds = beatDurations(m!.clips.length, shifted, m!.clips.map((c) => c.transition?.duration ?? 0));
      m!.clips.forEach((c, i) => (durations[c.id] = ds[i]!));
    } else {
      const n = Math.max(1, Math.round(2.2 / beat.period));
      for (const c of photos) durations[c.id] = n * beat.period;
    }
    commit('Beat sync', (q) => {
      let out = setMainDurations(q, durations);
      // Make the song end with the video, with a gentle fade.
      const vidLen = projectDuration({ ...out, tracks: out.tracks.filter((t) => t.kind !== 'audio') });
      const loc = findClip(out, music.id);
      if (loc && loc.clip.type === 'media') {
        const a = out.assets[loc.clip.assetId]!;
        const maxDur = (a.duration - loc.clip.in) / loc.clip.speed;
        const dur = Math.max(0.5, Math.min(maxDur, vidLen - loc.clip.start));
        const clips = loc.track.clips.slice();
        clips[loc.clipIndex] = { ...loc.clip, duration: dur, fadeOut: Math.min(2, dur / 3) };
        out = { ...out, tracks: out.tracks.map((t) => (t.id === loc.track.id ? { ...t, clips } : t)) };
      }
      return out;
    });
    emit('magic:used', { name: 'beat-sync' });
    toast(`Synced to the beat (${Math.round(beat.bpm)} BPM) 🎵`, 'success');
  } catch (err) {
    console.error(err);
    toast('Beat sync failed for this song.', 'error');
  } finally {
    busy.value = null;
  }
}
