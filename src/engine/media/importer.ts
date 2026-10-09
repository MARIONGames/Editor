/**
 * Turns user files into Kinora assets: figures out what they are, how big and long
 * they are, and prepares thumbnails (filmstrips) and audio waveforms.
 */
import type { Asset, AssetKind } from '../../model/types';
import type { DerivedData } from '../../storage/db';
import { uid } from '../../util/id';
import { makeCanvas, type AnyCanvas } from '../render/rasterize';

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportResult {
  asset: Asset;
  blob: Blob;
  derived: DerivedData;
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|avi|3gp)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|svg)$/i;

export function detectKind(file: Pick<File, 'type' | 'name'>): AssetKind | null {
  const t = file.type;
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (VIDEO_EXT.test(file.name)) return 'video';
  if (AUDIO_EXT.test(file.name)) return 'audio';
  if (IMAGE_EXT.test(file.name)) return 'image';
  return null;
}

export async function importFile(file: File, onProgress?: (p: number) => void): Promise<ImportResult> {
  const kind = detectKind(file);
  if (!kind) throw new ImportError(`"${file.name}" is not a photo, video or sound file.`);
  if (kind === 'image') return importImage(file);
  if (kind === 'video') return importVideo(file, onProgress);
  return importAudio(file, onProgress);
}

/* ------------------------------------------------------------------ images */

async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Fallback through an <img> (e.g. SVG, or browsers with partial ImageBitmap support).
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      const max = 4096;
      const s = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round((img.naturalWidth || 1024) * s));
      const h = Math.max(1, Math.round((img.naturalHeight || 1024) * s));
      const c = makeCanvas(w, h);
      (c.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0, w, h);
      return await createImageBitmap(c);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function importImage(file: File): Promise<ImportResult> {
  let bmp: ImageBitmap;
  let blob: Blob = file;
  try {
    bmp = await decodeImage(file);
  } catch {
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
      throw new ImportError(
        `This browser can't open HEIC photos ("${file.name}"). Tip: on iPhone pick the photo from the Photos app — it converts automatically — or use Safari.`,
      );
    }
    throw new ImportError(`"${file.name}" could not be opened. It may be damaged or in an unusual format.`);
  }
  // SVGs are rasterised so every browser can draw them the same way.
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) {
    blob = await canvasToBlob(bitmapToCanvas(bmp), 'image/png');
  }
  const thumb = await canvasToBlob(scaledCanvas(bmp, bmp.width, bmp.height, 320), 'image/jpeg', 0.82);
  const asset: Asset = {
    id: uid('a'),
    kind: 'image',
    name: file.name,
    mime: blob.type || file.type || 'image/*',
    size: blob.size,
    width: bmp.width,
    height: bmp.height,
    duration: 0,
    hasAudio: false,
    addedAt: Date.now(),
  };
  bmp.close();
  return { asset, blob, derived: { thumbs: [thumb], thumbInterval: 0 } };
}

/* ------------------------------------------------------------------ videos */

interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  fps?: number;
}

async function importVideo(file: File, onProgress?: (p: number) => void): Promise<ImportResult> {
  const mb = await import('mediabunny');
  let info: VideoInfo | null = null;
  let thumbs: Blob[] = [];
  let interval = 1;
  let audio: { peaks: Float32Array; rms: Float32Array } | undefined;
  let input: InstanceType<typeof mb.Input> | null = null;
  try {
    input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
    const vt = await input.getPrimaryVideoTrack();
    if (vt) {
      const at = await input.getPrimaryAudioTrack();
      const duration = await input.computeDuration();
      let fps: number | undefined;
      try {
        fps = Math.round((await vt.computePacketStats(100)).averagePacketRate * 100) / 100;
      } catch {
        fps = undefined;
      }
      info = { duration, width: vt.displayWidth, height: vt.displayHeight, hasAudio: !!at, fps };
      interval = filmstripInterval(duration);
      if (await vt.canDecode()) {
        const th = 120;
        const tw = Math.max(1, Math.round((th * info.width) / Math.max(1, info.height)));
        const sink = new mb.CanvasSink(vt, { width: tw, height: th, fit: 'fill', poolSize: 0 });
        const times = filmstripTimes(duration, interval);
        let i = 0;
        for await (const wrapped of sink.canvasesAtTimestamps(times)) {
          if (wrapped) thumbs.push(await canvasToBlob(wrapped.canvas, 'image/jpeg', 0.75));
          onProgress?.(0.1 + 0.5 * (++i / times.length));
        }
      }
      if (at && (await at.canDecode())) {
        audio = await analyzeTrackAudio(mb, at, duration, (p) => onProgress?.(0.6 + 0.4 * p));
      }
    }
  } catch (err) {
    console.warn('mediabunny probe failed, falling back to <video>', err);
  } finally {
    input?.dispose();
  }

  if (!info || !thumbs.length) {
    const el = await probeWithElement(file);
    info = info ?? el.info;
    interval = filmstripInterval(info.duration);
    if (!thumbs.length) thumbs = await elementFilmstrip(el.video, info, interval);
    el.dispose();
  }
  if (info.hasAudio && !audio) {
    // Waveform is optional: if it can't be computed the sound still plays.
    audio = await analyzeWithDecodeAudioData(file, info.duration).catch(() => undefined);
  }
  if (!info.duration || !isFinite(info.duration)) {
    throw new ImportError(`"${file.name}" has no playable video in it.`);
  }
  const asset: Asset = {
    id: uid('a'),
    kind: 'video',
    name: file.name,
    mime: file.type || 'video/*',
    size: file.size,
    width: info.width,
    height: info.height,
    duration: info.duration,
    hasAudio: info.hasAudio,
    fps: info.fps,
    addedAt: Date.now(),
  };
  return {
    asset,
    blob: file,
    derived: { thumbs, thumbInterval: interval, peaks: audio?.peaks, rms: audio?.rms },
  };
}

function filmstripInterval(duration: number): number {
  return Math.min(30, Math.max(0.5, duration / 40));
}

function filmstripTimes(duration: number, interval: number): number[] {
  const n = Math.max(1, Math.ceil(duration / interval));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.min(duration - 0.01, (i + 0.5) * interval));
  return out;
}

async function probeWithElement(file: Blob): Promise<{ info: VideoInfo; video: HTMLVideoElement; dispose: () => void }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  const dispose = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    await waitFor(video, 'loadedmetadata', 15000);
  } catch {
    dispose();
    throw new ImportError(
      "This video format isn't supported by your browser. Try Chrome or Safari, or convert it to MP4.",
    );
  }
  let duration = video.duration;
  if (!isFinite(duration)) {
    // Some WebM files don't store their length: seek to the end to find it.
    video.currentTime = 1e9;
    await waitFor(video, 'seeked', 8000).catch(() => undefined);
    duration = video.duration;
    video.currentTime = 0;
  }
  const v = video as HTMLVideoElement & { mozHasAudio?: boolean; webkitAudioDecodedByteCount?: number; audioTracks?: { length: number } };
  const hasAudio = v.mozHasAudio ?? (v.audioTracks ? v.audioTracks.length > 0 : true);
  return {
    info: { duration, width: video.videoWidth, height: video.videoHeight, hasAudio },
    video,
    dispose,
  };
}

async function elementFilmstrip(video: HTMLVideoElement, info: VideoInfo, interval: number): Promise<Blob[]> {
  const th = 120;
  const tw = Math.max(1, Math.round((th * info.width) / Math.max(1, info.height)));
  const out: Blob[] = [];
  const times = filmstripTimes(info.duration, interval);
  const c = makeCanvas(tw, th);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  for (const t of times) {
    video.currentTime = t;
    try {
      await waitFor(video, 'seeked', 5000);
    } catch {
      break;
    }
    ctx.drawImage(video, 0, 0, tw, th);
    out.push(await canvasToBlob(c, 'image/jpeg', 0.75));
  }
  return out;
}

/* ------------------------------------------------------------------- audio */

async function importAudio(file: File, onProgress?: (p: number) => void): Promise<ImportResult> {
  const mb = await import('mediabunny');
  let duration = 0;
  let audio: { peaks: Float32Array; rms: Float32Array } | undefined;
  let input: InstanceType<typeof mb.Input> | null = null;
  try {
    input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
    const at = await input.getPrimaryAudioTrack();
    if (at) {
      duration = await input.computeDuration();
      if (await at.canDecode()) audio = await analyzeTrackAudio(mb, at, duration, (p) => onProgress?.(p));
    }
  } catch (err) {
    console.warn('mediabunny audio probe failed', err);
  } finally {
    input?.dispose();
  }
  if (!audio || !duration) {
    const res = await decodeWithAudioContext(file).catch(() => null);
    if (!res) throw new ImportError(`"${file.name}" could not be played. Try an MP3, M4A or WAV file.`);
    duration = res.duration;
    audio = analyzeBuffer(res, res.duration);
  }
  const asset: Asset = {
    id: uid('a'),
    kind: 'audio',
    name: file.name,
    mime: file.type || 'audio/*',
    size: file.size,
    width: 0,
    height: 0,
    duration,
    hasAudio: true,
    addedAt: Date.now(),
  };
  return { asset, blob: file, derived: { thumbs: [], thumbInterval: 0, peaks: audio.peaks, rms: audio.rms } };
}

/** 10 ms bins */
const BINS_PER_SECOND = 100;

type Mediabunny = typeof import('mediabunny');

async function analyzeTrackAudio(
  mb: Mediabunny,
  track: Awaited<ReturnType<InstanceType<Mediabunny['Input']>['getPrimaryAudioTrack']>>,
  duration: number,
  onProgress?: (p: number) => void,
): Promise<{ peaks: Float32Array; rms: Float32Array }> {
  const n = Math.max(1, Math.ceil(duration * BINS_PER_SECOND));
  const peaks = new Float32Array(n);
  const sumsq = new Float64Array(n);
  const counts = new Uint32Array(n);
  const sink = new mb.AudioBufferSink(track!);
  let lastReport = 0;
  for await (const { buffer, timestamp } of sink.buffers()) {
    accumulate(buffer, timestamp, peaks, sumsq, counts);
    if (onProgress && timestamp - lastReport > 5) {
      lastReport = timestamp;
      onProgress(Math.min(1, timestamp / Math.max(1, duration)));
    }
  }
  return finish(peaks, sumsq, counts);
}

function accumulate(
  buffer: AudioBuffer,
  offset: number,
  peaks: Float32Array,
  sumsq: Float64Array,
  counts: Uint32Array,
): void {
  const sr = buffer.sampleRate;
  const chs = buffer.numberOfChannels;
  const len = buffer.length;
  const data: Float32Array[] = [];
  for (let c = 0; c < chs; c++) data.push(buffer.getChannelData(c));
  const n = peaks.length;
  for (let i = 0; i < len; i++) {
    const bin = Math.floor((offset + i / sr) * BINS_PER_SECOND);
    if (bin < 0) continue;
    if (bin >= n) break;
    let m = 0;
    let peak = 0;
    for (let c = 0; c < chs; c++) {
      const v = data[c]![i]!;
      m += v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    m /= chs;
    if (peak > peaks[bin]!) peaks[bin] = peak;
    sumsq[bin]! += m * m;
    counts[bin]!++;
  }
}

function finish(peaks: Float32Array, sumsq: Float64Array, counts: Uint32Array) {
  const rms = new Float32Array(peaks.length);
  for (let i = 0; i < rms.length; i++) rms[i] = counts[i] ? Math.sqrt(sumsq[i]! / counts[i]!) : 0;
  return { peaks, rms };
}

function analyzeBuffer(buffer: AudioBuffer, duration: number) {
  const n = Math.max(1, Math.ceil(duration * BINS_PER_SECOND));
  const peaks = new Float32Array(n);
  const sumsq = new Float64Array(n);
  const counts = new Uint32Array(n);
  accumulate(buffer, 0, peaks, sumsq, counts);
  return finish(peaks, sumsq, counts);
}

async function decodeWithAudioContext(blob: Blob): Promise<AudioBuffer> {
  if (blob.size > 400 * 1024 * 1024) throw new Error('too large');
  const data = await blob.arrayBuffer();
  const Ctx = (globalThis.OfflineAudioContext ?? (globalThis as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext);
  const ctx = new Ctx(1, 1, 44100);
  return await ctx.decodeAudioData(data);
}

async function analyzeWithDecodeAudioData(blob: Blob, duration: number) {
  const buf = await decodeWithAudioContext(blob);
  return analyzeBuffer(buf, duration || buf.duration);
}

/* ----------------------------------------------------------------- helpers */

function waitFor(el: HTMLMediaElement, event: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${event}`));
    }, timeout);
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('media error'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', fail, { once: true });
  });
}

export function scaledCanvas(src: CanvasImageSource, w: number, h: number, max: number): AnyCanvas {
  const s = Math.min(1, max / Math.max(w, h));
  const c = makeCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function bitmapToCanvas(bmp: ImageBitmap): AnyCanvas {
  const c = makeCanvas(bmp.width, bmp.height);
  (c.getContext('2d') as CanvasRenderingContext2D).drawImage(bmp, 0, 0);
  return c;
}

export async function canvasToBlob(c: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality),
  );
}
