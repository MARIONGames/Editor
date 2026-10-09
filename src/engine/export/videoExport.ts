/**
 * Video export: renders every frame with the same compositor as the preview and
 * encodes with WebCodecs (H.264/VP9/AV1 + AAC/Opus), muxed by mediabunny.
 * Falls back to real-time MediaRecorder capture on browsers without WebCodecs.
 */
import { projectDuration } from '../../model/ops';
import type { Project } from '../../model/types';
import { clipHasAudio, loadAudio, peekAudio } from '../audio/library';
import { createMasterChain, renderMix, scheduleAudio } from '../audio/mixer';
import { VideoPool } from '../media/videoPool';
import { loadImage, peekImage } from '../media/images';
import { loadProjectFonts } from '../render/rasterize';
import { Renderer, type MediaProvider } from '../render/renderer';
import { ExportMediaProvider } from './frameSources';

export interface VideoExportOptions {
  width: number;
  height: number;
  fps: number;
  /** Video bits per second. */
  bitrate: number;
  format: 'mp4' | 'webm';
  includeAudio: boolean;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  ext: string;
  /** Human-readable description, e.g. "MP4 · H.264 · AAC". */
  details: string;
}

export type ProgressFn = (fraction: number, message: string) => void;

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelled';
  }
}

const CODEC_NAMES: Record<string, string> = {
  avc: 'H.264',
  hevc: 'H.265',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  aac: 'AAC',
  opus: 'Opus',
};

export function hasAudibleClips(p: Project): boolean {
  return p.tracks.some((t) => !t.muted && t.clips.some((c) => c.type === 'media' && clipHasAudio(c, p.assets[c.assetId])));
}

export function canUseWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/** Where encoded bytes go: a file in the browser's private storage (low memory) or RAM. */
async function makeTarget(mb: typeof import('mediabunny'), ext: string): Promise<{
  target: InstanceType<typeof mb.StreamTarget> | InstanceType<typeof mb.BufferTarget>;
  inMemory: boolean;
  finish: () => Promise<Blob>;
}> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (root) {
      const name = `kinora-export.${ext}`;
      const fh = await root.getFileHandle(name, { create: true });
      const writable = await (fh as FileSystemFileHandle & { createWritable?: () => Promise<FileSystemWritableFileStream> }).createWritable?.();
      if (writable) {
        return {
          target: new mb.StreamTarget(writable as unknown as WritableStream<import('mediabunny').StreamTargetChunk>, { chunked: true }),
          inMemory: false,
          finish: async () => fh.getFile() as Promise<Blob>,
        };
      }
    }
  } catch {
    /* fall back to memory */
  }
  const target = new mb.BufferTarget();
  return { target, inMemory: true, finish: async () => new Blob([target.buffer!]) };
}

export async function exportVideo(p: Project, o: VideoExportOptions, onProgress: ProgressFn, signal: AbortSignal): Promise<ExportResult> {
  if (!canUseWebCodecs()) return recordRealtime(p, o, onProgress, signal);
  const mb = await import('mediabunny');
  const duration = projectDuration(p);
  if (duration <= 0) throw new Error('Your project is empty — add something first.');
  const fps = o.fps;
  const frames = Math.max(1, Math.ceil(duration * fps - 1e-6));

  // Pick the best codecs this browser can encode, preferring the requested container.
  const quality = new mb.Quality({ bitrate: o.bitrate });
  const containers: ('mp4' | 'webm')[] = o.format === 'mp4' ? ['mp4', 'webm'] : ['webm', 'mp4'];
  let chosen: { format: 'mp4' | 'webm'; video: import('mediabunny').VideoCodec; audio: import('mediabunny').AudioCodec | null } | null = null;
  const wantAudio = o.includeAudio && hasAudibleClips(p);
  for (const f of containers) {
    const vids: import('mediabunny').VideoCodec[] = f === 'mp4' ? ['avc', 'vp9', 'av1', 'hevc'] : ['vp9', 'vp8', 'av1'];
    const video = await mb.getFirstEncodableVideoCodec(vids, { width: o.width, height: o.height, quality, frameRate: fps });
    if (!video) continue;
    let audio: import('mediabunny').AudioCodec | null = null;
    if (wantAudio) {
      audio = await mb.getFirstEncodableAudioCodec(f === 'mp4' ? ['aac', 'opus'] : ['opus'], {
        numberOfChannels: 2,
        sampleRate: 48000,
        quality: new mb.Quality({ bitrate: 192000 }),
      });
      if (!audio && f === 'mp4') continue; // try WebM for sound
    }
    chosen = { format: f, video, audio };
    break;
  }
  if (!chosen) return recordRealtime(p, o, onProgress, signal);

  const ext = chosen.format;
  const { target, inMemory, finish } = await makeTarget(mb, ext);
  // In memory we can put the index first (plays instantly on the web); on disk it goes last.
  const format = chosen.format === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: inMemory ? 'in-memory' : false }) : new mb.WebMOutputFormat();
  const output = new mb.Output({ format, target });

  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas, { preserve: true });
  renderer.setSize(o.width, o.height);
  const provider = new ExportMediaProvider(p, fps, frames, renderer.maxTextureSize);
  const abort = () => {
    throw new ExportCancelled();
  };
  try {
    onProgress(0, 'Getting ready…');
    await loadProjectFonts(p);
    await provider.prepare();
    const videoSource = new mb.CanvasSource(canvas, {
      codec: chosen.video,
      quality,
      keyFrameInterval: 2,
      latencyMode: 'quality',
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null;
    if (chosen.audio) {
      audioSource = new mb.AudioBufferSource({ codec: chosen.audio, quality: new mb.Quality({ bitrate: 192000 }) });
      output.addAudioTrack(audioSource);
    }
    await output.start();

    // The whole mix is rendered first, then fed in 1-second pieces alongside the
    // video frames: the muxer interleaves tracks and would stall if one ran ahead.
    let audioChunks: AudioBuffer[] = [];
    if (audioSource) {
      onProgress(0.01, 'Mixing the sound…');
      const ids = new Set<string>();
      for (const t of p.tracks) for (const c of t.clips) if (c.type === 'media' && clipHasAudio(c, p.assets[c.assetId])) ids.add(c.assetId);
      await Promise.all([...ids].map((id) => loadAudio(id)));
      if (signal.aborted) abort();
      const mix = await renderMix(p, frames / fps, (id) => peekAudio(id) ?? null, 48000);
      audioChunks = sliceAudio(mix, 1);
    }
    let audioSent = 0;

    const started = performance.now();
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) abort();
      while (audioSource && audioSent < audioChunks.length && audioSent <= i / fps + 1) {
        await audioSource.add(audioChunks[audioSent]!);
        audioSent++;
      }
      await provider.advance(i);
      renderer.render(p, i / fps, provider);
      await videoSource.add(i / fps, 1 / fps);
      if (i % 3 === 0 || i === frames - 1) {
        const done = (i + 1) / frames;
        const elapsed = (performance.now() - started) / 1000;
        const left = done > 0.03 ? (elapsed / done) * (1 - done) : NaN;
        onProgress(0.02 + done * 0.96, isFinite(left) ? `Making your video… about ${formatLeft(left)} left` : 'Making your video…');
      }
    }
    while (audioSource && audioSent < audioChunks.length) await audioSource.add(audioChunks[audioSent++]!);
    audioSource?.close();
    videoSource.close();
    onProgress(0.99, 'Finishing up…');
    await output.finalize();
    const raw = await finish();
    const mime = chosen.format === 'mp4' ? 'video/mp4' : 'video/webm';
    const blob = raw.type === mime ? raw : new Blob([raw], { type: mime });
    onProgress(1, 'Done!');
    return {
      blob,
      mime,
      ext,
      details: [chosen.format.toUpperCase(), CODEC_NAMES[chosen.video] ?? chosen.video, chosen.audio ? CODEC_NAMES[chosen.audio] ?? chosen.audio : null]
        .filter(Boolean)
        .join(' · '),
    };
  } catch (err) {
    if (output.state === 'started' || output.state === 'pending') await output.cancel().catch(() => undefined);
    throw err;
  } finally {
    provider.dispose();
    renderer.dispose();
  }
}

/** Splits an AudioBuffer into pieces of `seconds` length. */
function sliceAudio(buf: AudioBuffer, seconds: number): AudioBuffer[] {
  const out: AudioBuffer[] = [];
  const step = Math.max(1, Math.round(buf.sampleRate * seconds));
  for (let s = 0; s < buf.length; s += step) {
    const len = Math.min(step, buf.length - s);
    const piece = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) piece.copyToChannel(buf.getChannelData(c).subarray(s, s + len), c);
    out.push(piece);
  }
  return out;
}

function formatLeft(s: number): string {
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  return `${Math.round(s / 60)} min`;
}

/* ------------------------------------------------------------- fallback */

/** Real-time capture for browsers without WebCodecs (plays the project once while recording). */
async function recordRealtime(p: Project, o: VideoExportOptions, onProgress: ProgressFn, signal: AbortSignal): Promise<ExportResult> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot create video files. Please use a recent Chrome, Edge, Safari or Firefox.');
  }
  const duration = projectDuration(p);
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas, { preserve: true });
  renderer.setSize(o.width, o.height);
  const pool = new VideoPool();
  await loadProjectFonts(p);
  for (const a of Object.values(p.assets)) if (a.kind === 'image') await loadImage(a.id, renderer.maxTextureSize);
  const provider: MediaProvider & { sync: (t: number, playing: boolean) => void } = {
    frame(clip, asset) {
      if (asset.kind === 'image') {
        const b = peekImage(asset.id, renderer.maxTextureSize);
        return b ? { source: b, width: b.width, height: b.height, frameId: 'img', isStatic: true } : null;
      }
      const pv = pool.get(clip.id, asset.id);
      if (!pv || pv.el.readyState < 2) return null;
      return { source: pv.el, width: pv.el.videoWidth, height: pv.el.videoHeight, frameId: `${pv.frame}:${pv.el.currentTime}`, isStatic: false };
    },
    sync(t, playing) {
      for (const track of p.tracks) {
        if (track.kind === 'audio' || track.hidden) continue;
        for (const clip of track.clips) {
          if (clip.type !== 'media' || p.assets[clip.assetId]?.kind !== 'video') continue;
          const active = t >= clip.start && t < clip.start + clip.duration;
          const soon = clip.start > t && clip.start - t < 1.5;
          if (!active && !soon) continue;
          const pv = pool.get(clip.id, clip.assetId);
          if (!pv) continue;
          const src = active ? clip.in + (t - clip.start) * clip.speed : clip.in;
          if (active && playing) {
            pool.play(pv, clip.speed);
            if (Math.abs(pv.el.currentTime - src) > 0.2) pool.seek(pv, src);
          } else {
            pool.pause(pv);
            if (Math.abs(pv.el.currentTime - src) > 0.02) pool.seek(pv, src);
          }
        }
      }
    },
  };
  const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(o.fps);
  let audioCtx: AudioContext | null = null;
  if (o.includeAudio && hasAudibleClips(p)) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    const master = createMasterChain(audioCtx, dest).input;
    const ids = new Set<string>();
    for (const t of p.tracks) for (const c of t.clips) if (c.type === 'media') ids.add(c.assetId);
    await Promise.all([...ids].map((id) => loadAudio(id)));
    for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
    scheduleAudio(audioCtx, master, p, { from: 0, when: audioCtx.currentTime + 0.3, getBuffer: (id) => peekAudio(id), allowStretch: true });
  }
  const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: o.bitrate, audioBitsPerSecond: 192000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  // Prime the first frame, then record in real time.
  provider.sync(0, false);
  await new Promise((r) => setTimeout(r, 300));
  renderer.render(p, 0, provider);
  rec.start(500);
  const t0 = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (signal.aborted) {
        rec.stop();
        reject(new ExportCancelled());
        return;
      }
      const t = (performance.now() - t0) / 1000;
      if (t >= duration) {
        resolve();
        return;
      }
      provider.sync(t, true);
      renderer.render(p, t, provider);
      onProgress(t / duration, 'Recording your video in real time…');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await new Promise<void>((r) => {
    rec.onstop = () => r();
    rec.stop();
  });
  pool.releaseAll();
  renderer.dispose();
  void audioCtx?.close();
  const mime = (rec.mimeType || mimeType || 'video/webm').split(';')[0]!;
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(chunks, { type: mime }), mime, ext, details: `${ext.toUpperCase()} · real-time recording` };
}
