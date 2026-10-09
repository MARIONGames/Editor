/**
 * Schedules every audible clip of a project on a Web Audio context.
 * Used for live preview (AudioContext) and export (OfflineAudioContext).
 */
import type { MediaClip, Project, Track } from '../../model/types';
import { clipAudio, clipHasAudio } from './library';

export interface ScheduleOptions {
  /** Timeline time to start from. */
  from: number;
  /** Context time at which `from` should be heard. */
  when: number;
  /** Timeline time to stop at (default: end of each clip). */
  until?: number;
  getBuffer: (assetId: string) => AudioBuffer | null | undefined;
  /** Allow computing pitch-preserving stretches synchronously. */
  allowStretch: boolean;
}

/** Master chain: gain → gentle limiter (prevents clipping when music + voice stack up). */
export function createMasterChain(ctx: BaseAudioContext, destination: AudioNode = ctx.destination): { input: GainNode; output: AudioNode } {
  const input = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  input.connect(limiter);
  limiter.connect(destination);
  return { input, output: limiter };
}

/** Fade lengths for a clip, including automatic crossfades under main-track transitions. */
function fadeLengths(track: Track, index: number, clip: MediaClip): { fadeIn: number; fadeOut: number } {
  let fadeIn = clip.fadeIn;
  let fadeOut = clip.fadeOut;
  if (track.kind === 'main') {
    if (clip.transition) fadeIn = Math.max(fadeIn, clip.transition.duration);
    const next = track.clips[index + 1];
    if (next?.transition) fadeOut = Math.max(fadeOut, next.transition.duration);
  }
  const total = fadeIn + fadeOut;
  if (total > clip.duration && total > 0) {
    const k = clip.duration / total;
    fadeIn *= k;
    fadeOut *= k;
  }
  return { fadeIn, fadeOut };
}

export function scheduleAudio(
  ctx: BaseAudioContext,
  dest: AudioNode,
  p: Project,
  o: ScheduleOptions,
): AudioBufferSourceNode[] {
  const nodes: AudioBufferSourceNode[] = [];
  const until = o.until ?? Infinity;
  for (const track of p.tracks) {
    if (track.muted || track.volume <= 0) continue;
    track.clips.forEach((c, index) => {
      if (c.type !== 'media') return;
      const clip = c;
      const asset = p.assets[clip.assetId];
      if (!clipHasAudio(clip, asset)) return;
      const end = clip.start + clip.duration;
      const tl0 = Math.max(o.from, clip.start);
      const tl1 = Math.min(end, until);
      if (tl1 - tl0 < 0.005) return;
      const raw = o.getBuffer(clip.assetId);
      if (!raw) return;
      const ca = clipAudio(clip, raw, o.allowStretch);
      const bufOffset = ca.offset + (tl0 - clip.start) * ca.rate;
      if (bufOffset >= ca.buffer.duration) return;

      const src = ctx.createBufferSource();
      src.buffer = ca.buffer;
      src.playbackRate.value = ca.rate;
      const g = ctx.createGain();
      src.connect(g);
      g.connect(dest);

      const base = clip.volume * track.volume;
      const { fadeIn, fadeOut } = fadeLengths(track, index, clip);
      const gainAt = (tl: number) => {
        let k = 1;
        if (fadeIn > 0) k = Math.min(k, (tl - clip.start) / fadeIn);
        if (fadeOut > 0) k = Math.min(k, (end - tl) / fadeOut);
        return base * Math.max(0, Math.min(1, k));
      };
      const toCtx = (tl: number) => o.when + (tl - o.from);
      const pts = new Set<number>([tl0, tl1]);
      if (fadeIn > 0) pts.add(Math.min(tl1, Math.max(tl0, clip.start + fadeIn)));
      if (fadeOut > 0) pts.add(Math.min(tl1, Math.max(tl0, end - fadeOut)));
      const times = [...pts].sort((a, b) => a - b);
      g.gain.setValueAtTime(gainAt(times[0]!), toCtx(times[0]!));
      for (let i = 1; i < times.length; i++) g.gain.linearRampToValueAtTime(gainAt(times[i]!), toCtx(times[i]!));

      src.start(toCtx(tl0), bufOffset, Math.max(0.001, (tl1 - tl0) * ca.rate));
      nodes.push(src);
    });
  }
  return nodes;
}

/** Renders the whole mix offline (export). */
export async function renderMix(
  p: Project,
  duration: number,
  getBuffer: (assetId: string) => AudioBuffer | null | undefined,
  sampleRate = 48000,
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(duration * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const master = createMasterChain(ctx);
  scheduleAudio(ctx, master.input, p, { from: 0, when: 0, until: duration, getBuffer, allowStretch: true });
  return await ctx.startRendering();
}
