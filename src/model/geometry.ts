import { animState, motionState, resolveMotion } from './animation';
import type { Asset, Clip, Crop, MediaClip, Project } from './types';

export interface Size {
  w: number;
  h: number;
}

/** A clip's placement on the canvas, in canvas pixels. */
export interface Quad {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Radians, clockwise. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  /** Extra blur from animations (canvas px). */
  blur: number;
  /** Fraction of text to reveal (typewriter). */
  reveal: number;
}

export function croppedSourceSize(asset: Pick<Asset, 'width' | 'height'>, crop: Crop): Size {
  return {
    w: Math.max(1, asset.width * (1 - crop.left - crop.right)),
    h: Math.max(1, asset.height * (1 - crop.top - crop.bottom)),
  };
}

/** Size of a media clip before its own scale: fitted (contain) or filling (cover) the canvas. */
export function mediaBaseSize(clip: MediaClip, asset: Asset, canvasW: number, canvasH: number): Size {
  const src = croppedSourceSize(asset, clip.crop);
  const s =
    clip.fit === 'cover'
      ? Math.max(canvasW / src.w, canvasH / src.h)
      : Math.min(canvasW / src.w, canvasH / src.h);
  return { w: src.w * s, h: src.h * s };
}

/** Base size for non-media clips that don't depend on text measuring. */
export function simpleBaseSize(clip: Clip): Size | null {
  if (clip.type === 'sticker') return { w: clip.size, h: clip.size };
  if (clip.type === 'shape') return { w: clip.width, h: clip.height };
  return null;
}

/**
 * Where a clip is drawn at time t: transform + Ken Burns motion + animation.
 * `base` is the clip's size before its own scale.
 */
export function clipQuad(project: Project, clip: Clip, base: Size, t: number): Quad {
  const W = project.width;
  const H = project.height;
  const local = Math.max(0, t - clip.start);
  const a = project.kind === 'photo' ? null : animState(clip.animation, local, clip.duration);
  const tr = clip.transform;
  let w = base.w * tr.scale;
  let h = base.h * tr.scale;
  let cx = tr.x * W;
  let cy = tr.y * H;
  if (clip.type === 'media' && project.kind === 'video') {
    const motion = resolveMotion(clip);
    if (motion !== 'none') {
      const m = motionState(motion, clip.duration > 0 ? local / clip.duration : 0);
      cx += m.px * w;
      cy += m.py * h;
      w *= m.scale;
      h *= m.scale;
    }
  }
  if (a) {
    cx += a.dx * W;
    cy += a.dy * H;
    w *= a.scale;
    h *= a.scale;
  }
  return {
    cx,
    cy,
    w,
    h,
    rotation: ((tr.rotation + (a ? a.rotate : 0)) * Math.PI) / 180,
    flipX: tr.flipX,
    flipY: tr.flipY,
    opacity: clip.opacity * (a ? a.opacity : 1),
    blur: a ? a.blur : 0,
    reveal: a ? a.reveal : 1,
  };
}

export type Point = { x: number; y: number };

/** Corners in drawing order: top-left, top-right, bottom-right, bottom-left. */
export function quadCorners(q: Pick<Quad, 'cx' | 'cy' | 'w' | 'h' | 'rotation'>): Point[] {
  const c = Math.cos(q.rotation);
  const s = Math.sin(q.rotation);
  const hw = q.w / 2;
  const hh = q.h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({ x: q.cx + x! * c - y! * s, y: q.cy + x! * s + y! * c }));
}

/** Point in the quad's own (unrotated, centred) coordinate frame. */
export function toQuadLocal(q: Pick<Quad, 'cx' | 'cy' | 'rotation'>, p: Point): Point {
  const dx = p.x - q.cx;
  const dy = p.y - q.cy;
  const c = Math.cos(-q.rotation);
  const s = Math.sin(-q.rotation);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function quadContains(q: Pick<Quad, 'cx' | 'cy' | 'w' | 'h' | 'rotation'>, p: Point, pad = 0): boolean {
  const l = toQuadLocal(q, p);
  return Math.abs(l.x) <= q.w / 2 + pad && Math.abs(l.y) <= q.h / 2 + pad;
}

/** Fit a box of aspect `aspect` (w/h) inside W×H. */
export function fitBox(aspect: number, W: number, H: number): Size {
  return W / H > aspect ? { w: H * aspect, h: H } : { w: W, h: W / aspect };
}
