/**
 * Exact frames for export. Every video clip gets its own decoder that walks
 * forward through exactly the frames the output needs (WebCodecs via mediabunny),
 * falling back to seeking a <video> element when the browser can't decode it.
 */
import type { Asset, MediaClip, Project } from '../../model/types';
import { clipsAt } from '../../model/ops';
import { loadImage } from '../media/images';
import { getBlob } from '../media/mediaStore';
import type { MediaFrame, MediaProvider } from '../render/renderer';

type Mediabunny = typeof import('mediabunny');

interface ClipDecoder {
  next(sourceTime: number): Promise<MediaFrame | null>;
  dispose(): void;
}

/** Frames via WebCodecs: monotonically increasing timestamps decode each packet once. */
async function webCodecsDecoder(mb: Mediabunny, blob: Blob, timestamps: number[]): Promise<ClipDecoder | null> {
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    const sink = new mb.CanvasSink(track, { poolSize: 3 });
    const iter = sink.canvasesAtTimestamps(timestamps)[Symbol.asyncIterator]();
    let last: MediaFrame | null = null;
    let n = 0;
    return {
      async next() {
        const r = await iter.next();
        if (!r.done && r.value) {
          const c = r.value.canvas;
          last = { source: c as TexImageSource, width: c.width, height: c.height, frameId: ++n, isStatic: false };
        }
        return last;
      },
      dispose() {
        void iter.return?.(undefined);
        input.dispose();
      },
    };
  } catch (err) {
    console.warn('WebCodecs decode unavailable, using <video> seeking', err);
    input.dispose();
    return null;
  }
}

/** Slow but universal: seek a <video> element to every frame. */
async function elementDecoder(blob: Blob): Promise<ClipDecoder> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.addEventListener('loadeddata', () => res(), { once: true });
    v.addEventListener('error', () => rej(new Error('This video cannot be read for export.')), { once: true });
  });
  let n = 0;
  return {
    async next(t: number) {
      if (Math.abs(v.currentTime - t) > 0.001) {
        await new Promise<void>((res) => {
          const done = () => res();
          v.addEventListener('seeked', done, { once: true });
          v.currentTime = Math.min(t, Math.max(0, v.duration - 0.001));
          setTimeout(done, 3000);
        });
      }
      return { source: v, width: v.videoWidth, height: v.videoHeight, frameId: ++n, isStatic: false };
    },
    dispose() {
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
    },
  };
}

export class ExportMediaProvider implements MediaProvider {
  private images = new Map<string, ImageBitmap>();
  private decoders = new Map<string, ClipDecoder>();
  private frames = new Map<string, MediaFrame | null>();
  private mb: Mediabunny | null = null;

  constructor(
    private p: Project,
    private fps: number,
    private frameCount: number,
    private maxTexture: number,
  ) {}

  /** Decode every still image at full resolution up front. */
  async prepare(): Promise<void> {
    this.mb = await import('mediabunny').catch(() => null);
    const ids = new Set<string>();
    for (const t of this.p.tracks)
      for (const c of t.clips) if (c.type === 'media' && this.p.assets[c.assetId]?.kind === 'image') ids.add(c.assetId);
    for (const id of ids) {
      const bmp = await loadImage(id, this.maxTexture);
      if (bmp) this.images.set(id, bmp);
    }
  }

  /** Advance every video clip visible at output frame `i` to its exact frame. */
  async advance(i: number): Promise<void> {
    const t = i / this.fps;
    const needed = new Set<string>();
    for (const track of this.p.tracks) {
      if (track.kind === 'audio' || track.hidden) continue;
      for (const clip of clipsAt(track, t)) {
        if (clip.type !== 'media') continue;
        const asset = this.p.assets[clip.assetId];
        if (asset?.kind !== 'video') continue;
        needed.add(clip.id);
        let dec = this.decoders.get(clip.id);
        if (!dec) {
          dec = await this.createDecoder(clip, asset);
          this.decoders.set(clip.id, dec);
        }
        const src = clip.in + (t - clip.start) * clip.speed;
        this.frames.set(clip.id, await dec.next(src));
      }
    }
    // Free decoders of clips that are finished.
    for (const [id, dec] of this.decoders) {
      if (!needed.has(id)) {
        dec.dispose();
        this.decoders.delete(id);
        this.frames.delete(id);
      }
    }
  }

  private async createDecoder(clip: MediaClip, asset: Asset): Promise<ClipDecoder> {
    const blob = await getBlob(asset.id);
    if (!blob) throw new Error(`The file "${asset.name}" is missing from this device.`);
    // Every output frame this clip is visible in → its source timestamp.
    const ts: number[] = [];
    for (let i = 0; i < this.frameCount; i++) {
      const t = i / this.fps;
      if (t >= clip.start - 1e-9 && t < clip.start + clip.duration - 1e-9) ts.push(Math.max(0, clip.in + (t - clip.start) * clip.speed));
    }
    if (this.mb) {
      const d = await webCodecsDecoder(this.mb, blob, ts);
      if (d) return d;
    }
    return elementDecoder(blob);
  }

  frame(clip: MediaClip, asset: Asset): MediaFrame | null {
    if (asset.kind === 'image') {
      const bmp = this.images.get(asset.id);
      return bmp ? { source: bmp, width: bmp.width, height: bmp.height, frameId: `full:${bmp.width}`, isStatic: true } : null;
    }
    return this.frames.get(clip.id) ?? null;
  }

  dispose(): void {
    for (const d of this.decoders.values()) d.dispose();
    this.decoders.clear();
    this.frames.clear();
  }
}
