/**
 * Draws text, emoji stickers and shapes into canvases at whatever resolution the
 * renderer needs, so overlays are always razor sharp (also in 4K exports).
 */
import { signal } from '@preact/signals';
import { cssFont } from '../../model/fonts';
import { mediaBaseSize, type Size } from '../../model/geometry';
import type { Clip, Project, ShapeClip, StickerClip, TextClip } from '../../model/types';

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const MAX_RASTER = 4096;
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

/** Bumped when a web font finishes loading so cached text is re-drawn. */
export const fontsVersion = signal(0);

export function makeCanvas(w: number, h: number): AnyCanvas {
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

let measureCtx: Ctx2D | null = null;
function mctx(): Ctx2D {
  if (!measureCtx) measureCtx = makeCanvas(4, 4).getContext('2d') as Ctx2D;
  return measureCtx;
}

/* ------------------------------------------------------------- font loading */

const loading = new Set<string>();
const loaded = new Set<string>();

/** True if the font is ready; otherwise starts loading it and returns false. */
export function ensureFont(font: string): boolean {
  if (typeof document === 'undefined' || !document.fonts) return true;
  if (loaded.has(font)) return true;
  try {
    if (document.fonts.check(font)) {
      loaded.add(font);
      return true;
    }
  } catch {
    return true;
  }
  if (!loading.has(font)) {
    loading.add(font);
    document.fonts
      .load(font)
      .then(() => {
        loaded.add(font);
        layoutCache.clear();
        fontsVersion.value++;
      })
      .catch(() => loaded.add(font))
      .finally(() => loading.delete(font));
  }
  return false;
}

/** Waits for every font a project uses (before exporting). */
export async function loadProjectFonts(p: Project): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const fonts = new Set<string>();
  for (const t of p.tracks)
    for (const c of t.clips)
      if (c.type === 'text') fonts.add(cssFont(c.style.font, c.style.weight, 64, c.style.italic));
  await Promise.all([...fonts].map((f) => document.fonts.load(f).catch(() => undefined)));
  layoutCache.clear();
}

/* ------------------------------------------------------------------- text */

export interface TextLayout {
  lines: string[];
  widths: number[];
  /** Text box (what the selection frame shows), in canvas pixels at scale 1. */
  boxW: number;
  boxH: number;
  pad: number;
  lineH: number;
  /** Extra room around the box for outline and shadow. */
  margin: number;
}

const layoutCache = new Map<string, TextLayout>();

function measure(ctx: Ctx2D, text: string, spacingPx: number): number {
  const w = ctx.measureText(text).width;
  if (!spacingPx) return w;
  return w + spacingPx * Math.max(0, Array.from(text).length - 1);
}

export function layoutText(clip: TextClip, maxWidth: number): TextLayout {
  const st = clip.style;
  const key = `${clip.text}|${JSON.stringify(st)}|${Math.round(maxWidth)}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const ctx = mctx();
  const font = cssFont(st.font, st.weight, st.size, st.italic);
  ensureFont(font);
  ctx.font = font;
  const spacing = st.letterSpacing * st.size;
  const raw = (st.uppercase ? clip.text.toUpperCase() : clip.text) || ' ';
  const lines: string[] = [];
  for (const para of raw.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const candidate = line + w;
      if (line && measure(ctx, candidate.trimEnd(), spacing) > maxWidth && w.trim()) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else line = candidate;
    }
    lines.push(line.trimEnd());
  }
  const widths = lines.map((l) => measure(ctx, l, spacing));
  const lineH = st.size * st.lineHeight;
  const pad = st.box ? st.boxPadding * st.size : st.size * 0.1;
  const contentW = Math.max(st.size * 0.3, ...widths);
  const boxW = contentW + pad * 2;
  const boxH = lineH * lines.length + pad * 2;
  const shadowExtent = st.shadow ? st.shadowBlur * st.size * 1.6 + Math.abs(st.shadowOffset * st.size) : 0;
  const margin = Math.ceil(st.strokeWidth * st.size + shadowExtent + 2);
  const layout = { lines, widths, boxW, boxH, pad, lineH, margin };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, layout);
  return layout;
}

export interface Raster {
  canvas: AnyCanvas;
  /** Margin (canvas pixels at scale 1) around the clip box included in the canvas. */
  margin: number;
}

function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawSpaced(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  mode: 'fill' | 'stroke',
): void {
  if (!spacing) {
    if (mode === 'fill') ctx.fillText(text, x, y);
    else ctx.strokeText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of Array.from(text)) {
    if (mode === 'fill') ctx.fillText(ch, cx, y);
    else ctx.strokeText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

export function rasterizeText(clip: TextClip, maxWidth: number, scale: number, reveal = 1): Raster {
  const st = clip.style;
  const L = layoutText(clip, maxWidth);
  const totalW = L.boxW + L.margin * 2;
  const totalH = L.boxH + L.margin * 2;
  const s = Math.min(scale, MAX_RASTER / totalW, MAX_RASTER / totalH);
  const canvas = makeCanvas(totalW * s, totalH * s);
  const ctx = canvas.getContext('2d') as Ctx2D;
  ctx.scale(s, s);
  ctx.translate(L.margin, L.margin);
  if (st.box) {
    roundRectPath(ctx, 0, 0, L.boxW, L.boxH, st.boxRadius * st.size);
    ctx.fillStyle = st.boxColor;
    ctx.fill();
  }
  ctx.font = cssFont(st.font, st.weight, st.size, st.italic);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const spacing = st.letterSpacing * st.size;
  // Typewriter: reveal characters in order across lines.
  const totalChars = L.lines.reduce((n, l) => n + Array.from(l).length, 0);
  let budget = reveal >= 1 ? Infinity : Math.floor(totalChars * reveal + 1e-6);
  const setShadow = (on: boolean) => {
    if (on && st.shadow) {
      ctx.shadowColor = st.shadowColor;
      ctx.shadowBlur = st.shadowBlur * st.size * s;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = st.shadowOffset * st.size * s;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
  };
  L.lines.forEach((line, i) => {
    if (budget <= 0) return;
    const chars = Array.from(line);
    const visible = budget >= chars.length ? line : chars.slice(0, budget).join('');
    budget -= chars.length;
    const w = L.widths[i]!;
    const x = st.align === 'left' ? L.pad : st.align === 'right' ? L.boxW - L.pad - w : (L.boxW - w) / 2;
    const y = L.pad + (i + 0.5) * L.lineH;
    if (st.strokeWidth > 0) {
      setShadow(true);
      ctx.lineWidth = st.strokeWidth * st.size * 2;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = st.strokeColor;
      drawSpaced(ctx, visible, x, y, spacing, 'stroke');
      setShadow(false);
    } else setShadow(true);
    ctx.fillStyle = st.color;
    drawSpaced(ctx, visible, x, y, spacing, 'fill');
    setShadow(false);
  });
  return { canvas, margin: L.margin };
}

/* ---------------------------------------------------------------- stickers */

export function rasterizeSticker(clip: StickerClip, scale: number): Raster {
  const size = clip.size;
  const s = Math.min(scale, MAX_RASTER / size);
  const canvas = makeCanvas(size * s, size * s);
  const ctx = canvas.getContext('2d') as Ctx2D;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const px = size * s * 0.82;
  ctx.font = `${px}px ${EMOJI_FONT}`;
  // Optical centring: emoji glyphs sit slightly high with 'middle'.
  ctx.fillText(clip.emoji, (size * s) / 2, (size * s) / 2 + px * 0.06);
  return { canvas, margin: 0 };
}

/* ------------------------------------------------------------------ shapes */

export function shapePath(shape: ShapeClip['shape'], w: number, h: number): Path2D {
  const p = new Path2D();
  switch (shape) {
    case 'rect':
    case 'line':
      p.rect(0, 0, w, h);
      break;
    case 'rounded': {
      const r = Math.min(w, h) * 0.2;
      p.moveTo(r, 0);
      p.arcTo(w, 0, w, h, r);
      p.arcTo(w, h, 0, h, r);
      p.arcTo(0, h, 0, 0, r);
      p.arcTo(0, 0, w, 0, r);
      p.closePath();
      break;
    }
    case 'ellipse':
      p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      p.moveTo(w / 2, 0);
      p.lineTo(w, h);
      p.lineTo(0, h);
      p.closePath();
      break;
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 0.5 : 0.21;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = w / 2 + Math.cos(a) * r * w;
        const y = h * 0.53 + Math.sin(a) * r * h;
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      break;
    }
    case 'heart': {
      p.moveTo(w / 2, h * 0.95);
      p.bezierCurveTo(w * 0.1, h * 0.68, -w * 0.06, h * 0.32, w * 0.24, h * 0.1);
      p.bezierCurveTo(w * 0.4, -0.01 * h, w * 0.5, h * 0.12, w / 2, h * 0.24);
      p.bezierCurveTo(w * 0.5, h * 0.12, w * 0.6, -0.01 * h, w * 0.76, h * 0.1);
      p.bezierCurveTo(w * 1.06, h * 0.32, w * 0.9, h * 0.68, w / 2, h * 0.95);
      p.closePath();
      break;
    }
    case 'arrow': {
      const shaft = h * 0.34;
      const head = Math.min(w * 0.42, h * 1.1);
      p.moveTo(0, h / 2 - shaft / 2);
      p.lineTo(w - head, h / 2 - shaft / 2);
      p.lineTo(w - head, 0);
      p.lineTo(w, h / 2);
      p.lineTo(w - head, h);
      p.lineTo(w - head, h / 2 + shaft / 2);
      p.lineTo(0, h / 2 + shaft / 2);
      p.closePath();
      break;
    }
    case 'bubble': {
      const bh = h * 0.78;
      const r = Math.min(w, bh) * 0.28;
      p.moveTo(r, 0);
      p.arcTo(w, 0, w, bh, r);
      p.arcTo(w, bh, 0, bh, r);
      p.lineTo(w * 0.36, bh);
      p.lineTo(w * 0.18, h);
      p.lineTo(w * 0.22, bh);
      p.arcTo(0, bh, 0, 0, r);
      p.arcTo(0, 0, w, 0, r);
      p.closePath();
      break;
    }
  }
  return p;
}

export function rasterizeShape(clip: ShapeClip, scale: number): Raster {
  const margin = Math.ceil(clip.strokeWidth / 2 + 2);
  const totalW = clip.width + margin * 2;
  const totalH = clip.height + margin * 2;
  const s = Math.min(scale, MAX_RASTER / totalW, MAX_RASTER / totalH);
  const canvas = makeCanvas(totalW * s, totalH * s);
  const ctx = canvas.getContext('2d') as Ctx2D;
  ctx.scale(s, s);
  ctx.translate(margin, margin);
  const path = shapePath(clip.shape, clip.width, clip.height);
  if (clip.fill && clip.fill !== 'transparent') {
    ctx.fillStyle = clip.fill;
    ctx.fill(path);
  }
  if (clip.strokeWidth > 0) {
    ctx.lineWidth = clip.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = clip.strokeColor;
    ctx.stroke(path);
  }
  return { canvas, margin };
}

/* ------------------------------------------------------------- base sizes */

export function textMaxWidth(project: Project): number {
  return project.width * 0.9;
}

/** A clip's size before its own scale (canvas pixels). */
export function clipBaseSize(project: Project, clip: Clip): Size {
  switch (clip.type) {
    case 'media': {
      const asset = project.assets[clip.assetId];
      if (!asset) return { w: project.width, h: project.height };
      if (asset.kind === 'audio') return { w: 0, h: 0 };
      return mediaBaseSize(clip, asset, project.width, project.height);
    }
    case 'text': {
      const l = layoutText(clip, textMaxWidth(project));
      return { w: l.boxW, h: l.boxH };
    }
    case 'sticker':
      return { w: clip.size, h: clip.size };
    case 'shape':
      return { w: clip.width, h: clip.height };
  }
}
