/**
 * Decoded audio for assets (and time-stretched versions for clips whose speed
 * changed). Shared by preview playback and export so both sound identical.
 */
import type { Asset, MediaClip } from '../../model/types';
import { getBlob } from '../media/mediaStore';
import { timeStretch } from './stretch';

const decoded = new Map<string, AudioBuffer | null>();
const decoding = new Map<string, Promise<AudioBuffer | null>>();
const stretched = new Map<string, AudioBuffer>();
const listeners = new Set<(assetId: string) => void>();

export function onAudioDecoded(fn: (assetId: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Returns the decoded buffer, null if the asset has no usable sound, undefined while loading. */
export function peekAudio(assetId: string): AudioBuffer | null | undefined {
  if (decoded.has(assetId)) return decoded.get(assetId)!;
  void loadAudio(assetId);
  return undefined;
}

export function loadAudio(assetId: string): Promise<AudioBuffer | null> {
  if (decoded.has(assetId)) return Promise.resolve(decoded.get(assetId)!);
  let p = decoding.get(assetId);
  if (p) return p;
  p = (async () => {
    const blob = await getBlob(assetId);
    if (!blob) return null;
    let buf = await decodeWithMediabunny(blob).catch(() => null);
    if (!buf) buf = await decodeWithWebAudio(blob).catch(() => null);
    decoded.set(assetId, buf);
    for (const fn of listeners) fn(assetId);
    return buf;
  })().finally(() => decoding.delete(assetId));
  decoding.set(assetId, p);
  return p;
}

async function decodeWithMediabunny(blob: Blob): Promise<AudioBuffer | null> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const duration = await input.computeDuration([track]);
    const parts: { buffer: AudioBuffer; timestamp: number }[] = [];
    const sink = new mb.AudioBufferSink(track);
    let sampleRate = 0;
    let channels = 0;
    for await (const w of sink.buffers()) {
      parts.push({ buffer: w.buffer, timestamp: w.timestamp });
      sampleRate = w.buffer.sampleRate;
      channels = Math.max(channels, w.buffer.numberOfChannels);
    }
    if (!parts.length || !sampleRate) return null;
    const length = Math.max(1, Math.ceil(duration * sampleRate));
    const out = new AudioBuffer({ length, numberOfChannels: Math.min(2, channels), sampleRate });
    for (let c = 0; c < out.numberOfChannels; c++) {
      const dst = out.getChannelData(c);
      for (const { buffer, timestamp } of parts) {
        const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        const offset = Math.round(timestamp * sampleRate);
        if (offset >= length) continue;
        const start = Math.max(0, -offset);
        const n = Math.min(src.length - start, length - Math.max(0, offset));
        if (n > 0) dst.set(src.subarray(start, start + n), Math.max(0, offset));
      }
    }
    return out;
  } finally {
    input.dispose();
  }
}

async function decodeWithWebAudio(blob: Blob): Promise<AudioBuffer | null> {
  const data = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(2, 1, 48000);
  return await ctx.decodeAudioData(data);
}

/** Does this clip make sound? */
export function clipHasAudio(clip: MediaClip, asset: Asset | undefined): boolean {
  return !!asset && (asset.kind === 'audio' || (asset.kind === 'video' && asset.hasAudio)) && clip.volume > 0;
}

export interface ClipAudio {
  buffer: AudioBuffer;
  /** Seconds into `buffer` where the clip's audio starts. */
  offset: number;
  /** Playback rate to apply (1 when the buffer is already time-stretched). */
  rate: number;
}

function stretchKey(clip: MediaClip): string {
  return `${clip.assetId}|${clip.in.toFixed(4)}|${clip.duration.toFixed(4)}|${clip.speed}`;
}

/**
 * The audio to play for a clip. With "keep voices natural" on and speed ≠ 1 this is
 * a pitch-preserving stretched copy of just the clip's range (computed on demand
 * and cached); otherwise the raw buffer with a playback rate.
 */
export function clipAudio(clip: MediaClip, raw: AudioBuffer, allowCompute = true): ClipAudio {
  if (Math.abs(clip.speed - 1) < 1e-3 || !clip.keepPitch) {
    return { buffer: raw, offset: clip.in, rate: clip.speed };
  }
  const key = stretchKey(clip);
  let buf = stretched.get(key);
  if (!buf && allowCompute) {
    buf = computeStretch(clip, raw);
    stretched.set(key, buf);
    if (stretched.size > 40) stretched.delete(stretched.keys().next().value!);
  }
  if (!buf) return { buffer: raw, offset: clip.in, rate: clip.speed };
  return { buffer: buf, offset: 0, rate: 1 };
}

function computeStretch(clip: MediaClip, raw: AudioBuffer): AudioBuffer {
  const sr = raw.sampleRate;
  const s0 = Math.max(0, Math.floor(clip.in * sr));
  const s1 = Math.min(raw.length, Math.ceil((clip.in + clip.duration * clip.speed) * sr));
  const chans: Float32Array[] = [];
  for (let c = 0; c < raw.numberOfChannels; c++) chans.push(raw.getChannelData(c).subarray(s0, Math.max(s0 + 1, s1)));
  const out = timeStretch(chans, clip.speed, sr);
  const buf = new AudioBuffer({ length: Math.max(1, out[0]!.length), numberOfChannels: out.length, sampleRate: sr });
  out.forEach((data, c) => buf.copyToChannel(data as Float32Array<ArrayBuffer>, c));
  return buf;
}

/** Precompute stretched audio in idle time so pressing play is instant. */
export function warmStretch(clip: MediaClip): void {
  if (Math.abs(clip.speed - 1) < 1e-3 || !clip.keepPitch) return;
  const raw = decoded.get(clip.assetId);
  if (!raw || stretched.has(stretchKey(clip))) return;
  const run = () => clipAudio(clip, raw, true);
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(run);
  else setTimeout(run, 50);
}
