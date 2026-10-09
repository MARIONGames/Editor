import type { Project } from '../../model/types';
import { canvasToBlob } from '../media/importer';
import { loadProjectFonts } from '../render/rasterize';
import { Renderer } from '../render/renderer';
import { ExportMediaProvider } from './frameSources';

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface ImageExportOptions {
  format: ImageFormat;
  /** 0..1 for JPEG / WebP */
  quality: number;
  /** Output size multiplier (1 = the project's size). */
  scale: number;
  /** Video projects: which moment to save. */
  time?: number;
}

/** Renders the picture at full resolution and encodes it. */
export async function exportImage(p: Project, opts: ImageExportOptions): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas, { preserve: true });
  try {
    const max = renderer.maxTextureSize;
    let w = Math.max(1, Math.round(p.width * opts.scale));
    let h = Math.max(1, Math.round(p.height * opts.scale));
    const k = Math.min(1, max / Math.max(w, h));
    w = Math.round(w * k);
    h = Math.round(h * k);
    renderer.setSize(w, h);
    await loadProjectFonts(p);
    const fps = p.fps || 30;
    const t = p.kind === 'photo' ? 0 : Math.max(0, opts.time ?? 0);
    const frame = Math.round(t * fps);
    const provider = new ExportMediaProvider(p, fps, frame + 1, max);
    await provider.prepare();
    await provider.advance(frame);
    renderer.render(p, t, provider);
    provider.dispose();
    const mime = `image/${opts.format}`;
    if (opts.format === 'jpeg') {
      // JPEG has no transparency: put it on white.
      const flat = document.createElement('canvas');
      flat.width = w;
      flat.height = h;
      const ctx = flat.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(canvas, 0, 0);
      return await canvasToBlob(flat, mime, opts.quality);
    }
    return await canvasToBlob(canvas, mime, opts.format === 'png' ? undefined : opts.quality);
  } finally {
    renderer.dispose();
  }
}
