/**
 * The Kinora compositor.
 *
 * One `Renderer` draws a project at a moment in time into its canvas. The live
 * preview and the exporter both use it, so the exported file is pixel-for-pixel
 * what the user saw (just at a higher resolution).
 */
import { resolveLook, isNeutral } from '../../model/filters';
import { clipQuad, quadContains, type Quad } from '../../model/geometry';
import { clipsAt } from '../../model/ops';
import type { Asset, BlendMode, Clip, MediaClip, Project, TransitionType } from '../../model/types';
import { parseColor } from '../../util/color';
import {
  createTexture,
  createTarget,
  deleteTarget,
  detectCaps,
  Program,
  TargetPool,
  type GLCaps,
  type RenderTarget,
} from '../gl/glUtil';
import * as S from '../gl/shaders';
import {
  clipBaseSize,
  fontsVersion,
  rasterizeShape,
  rasterizeSticker,
  rasterizeText,
  textMaxWidth,
  type AnyCanvas,
  type Raster,
} from './rasterize';

/** A decoded picture for a media clip. */
export interface MediaFrame {
  source: TexImageSource;
  width: number;
  height: number;
  /** Identity of the decoded frame; unchanged → no GPU re-upload. */
  frameId: string | number;
  /** Still images get mip-maps once and are shared between clips. */
  isStatic: boolean;
}

export interface MediaProvider {
  frame(clip: MediaClip, asset: Asset, sourceTime: number): MediaFrame | null;
}

export interface RenderOptions {
  /** Draw without effects (before/after comparison). */
  original?: boolean;
  /** Checkerboard behind transparent areas. */
  checker?: boolean;
  /** Clips to skip. */
  hide?: Set<string>;
  /** Override effects of one clip (filter previews). */
  overrideEffects?: { clipId: string; effects: Clip['effects'] };
}

interface TexEntry {
  tex: WebGLTexture;
  w: number;
  h: number;
  frameId: string | number;
  sig?: string;
  margin: number;
  mips: boolean;
  lastUsed: number;
}

const TRANSITION_IDS: Record<TransitionType, number> = {
  fade: 0,
  'dip-black': 1,
  'dip-white': 2,
  'wipe-left': 3,
  'wipe-right': 4,
  'wipe-up': 5,
  'wipe-down': 6,
  'slide-left': 7,
  'slide-right': 8,
  'slide-up': 9,
  'slide-down': 10,
  'push-left': 11,
  'push-right': 12,
  'zoom-in': 13,
  'zoom-out': 14,
  circle: 15,
  blur: 16,
  spin: 17,
};

const BLEND_IDS: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  'color-dodge': 6,
  'color-burn': 7,
  'hard-light': 8,
  'soft-light': 9,
  difference: 10,
  exclusion: 11,
  add: 12,
};

interface DrawQuad {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl!: WebGL2RenderingContext;
  caps!: GLCaps;
  private progs!: {
    composite: Program;
    prepare: Program;
    down: Program;
    blur: Program;
    develop: Program;
    transition: Program;
    blend: Program;
    output: Program;
  };
  private vao!: WebGLVertexArrayObject;
  private vbo!: WebGLBuffer;
  private pool!: TargetPool;
  private out: [RenderTarget, RenderTarget] | null = null;
  private textures = new Map<string, TexEntry>();
  private dummy!: WebGLTexture;
  private frameNo = 0;
  lost = false;
  /** Called after the GPU context comes back (e.g. phone unlocked). */
  onRestored: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: { preserve?: boolean } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: !!opts.preserve,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', ((e: Event) => {
      e.preventDefault();
      this.lost = true;
    }) as EventListener);
    canvas.addEventListener('webglcontextrestored', (() => {
      this.init();
      this.lost = false;
      this.onRestored?.();
    }) as EventListener);
    this.init();
  }

  private init(): void {
    const gl = this.gl;
    this.caps = detectCaps(gl);
    this.progs = {
      composite: new Program(gl, S.VS_QUAD, S.FS_COMPOSITE, 'composite'),
      prepare: new Program(gl, S.VS_FULL, S.FS_PREPARE, 'prepare'),
      down: new Program(gl, S.VS_FULL, S.FS_DOWN, 'down'),
      blur: new Program(gl, S.VS_FULL, S.FS_BLUR, 'blur'),
      develop: new Program(gl, S.VS_FULL, S.FS_DEVELOP, 'develop'),
      transition: new Program(gl, S.VS_FULL, S.FS_TRANSITION, 'transition'),
      blend: new Program(gl, S.VS_FULL, S.FS_BLEND, 'blend'),
      output: new Program(gl, S.VS_FULL, S.FS_OUTPUT, 'output'),
    };
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.pool = new TargetPool(gl, this.caps.halfFloat);
    this.out = null;
    this.textures.clear();
    this.dummy = createTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  get maxTextureSize(): number {
    return this.caps.maxTextureSize;
  }

  setSize(w: number, h: number): void {
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
  }

  /* ------------------------------------------------------------- main entry */

  render(p: Project, t: number, media: MediaProvider, opts: RenderOptions = {}): void {
    if (this.lost) return;
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.frameNo++;
    if (!this.out || this.out[0].w !== W || this.out[0].h !== H) {
      if (this.out) for (const o of this.out) deleteTarget(gl, o);
      this.out = [createTarget(gl, W, H, this.caps.halfFloat), createTarget(gl, W, H, this.caps.halfFloat)];
    }
    const k = W / p.width;
    let cur = this.out[0];
    let other = this.out[1];

    const bg = parseColor(p.background.color);
    this.bindTarget(cur);
    gl.clearColor(bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const track of p.tracks) {
      if (track.kind === 'audio' || track.hidden) continue;
      const active = clipsAt(track, t).filter((c) => !opts.hide?.has(c.id));
      if (!active.length) continue;
      if (track.kind === 'main' && active.length >= 2) {
        const a = active[active.length - 2]!;
        const b = active[active.length - 1]!;
        const tr = b.transition;
        const progress = tr ? (t - b.start) / tr.duration : 1;
        const la = this.pool.acquire(W, H);
        const lb = this.pool.acquire(W, H);
        this.clearTarget(la);
        this.clearTarget(lb);
        this.drawClip(p, a, la, t, media, opts, k, true);
        this.drawClip(p, b, lb, t, media, opts, k, true);
        this.bindTarget(cur);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const prog = this.progs.transition.use();
        this.bindTex(0, la.tex);
        this.bindTex(1, lb.tex);
        prog
          .i('uA', 0)
          .i('uB', 1)
          .f('uP', progress)
          .i('uType', TRANSITION_IDS[tr?.type ?? 'fade'])
          .f('uRes', W, H);
        this.drawQuad();
        this.pool.release(la);
        this.pool.release(lb);
        continue;
      }
      for (const clip of active) {
        if (clip.blend === 'normal') {
          this.drawClip(p, clip, cur, t, media, opts, k, track.kind === 'main');
        } else {
          const layer = this.pool.acquire(W, H);
          this.clearTarget(layer);
          this.drawClip(p, clip, layer, t, media, opts, k, track.kind === 'main');
          this.bindTarget(other);
          gl.disable(gl.BLEND);
          const prog = this.progs.blend.use();
          this.bindTex(0, cur.tex);
          this.bindTex(1, layer.tex);
          prog.i('uDst', 0).i('uSrc', 1).i('uMode', BLEND_IDS[clip.blend]);
          this.drawQuad();
          this.pool.release(layer);
          [cur, other] = [other, cur];
        }
      }
    }

    // Final blit to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    const outP = this.progs.output.use();
    this.bindTex(0, cur.tex);
    outP
      .i('uTex', 0)
      .f('uChecker', opts.checker ? 1 : 0)
      .f('uDither', this.caps.halfFloat ? 1 : 0);
    this.drawQuad();

    this.pool.tick();
    if (this.frameNo % 60 === 0) this.evictTextures();
  }

  /* ------------------------------------------------------------- clip draw */

  private drawClip(
    p: Project,
    clip: Clip,
    target: RenderTarget,
    t: number,
    media: MediaProvider,
    opts: RenderOptions,
    k: number,
    onMain: boolean,
  ): void {
    const base = clipBaseSize(p, clip);
    if (base.w <= 0 || base.h <= 0) return;
    const q = clipQuad(p, clip, base, t);
    if (q.opacity <= 0.002 || q.w < 0.25 || q.h < 0.25) return;

    let tex: TexEntry | null = null;
    let uv: [number, number, number, number] = [0, 0, 1, 1];
    let marginScale = 0;

    if (clip.type === 'media') {
      const asset = p.assets[clip.assetId];
      if (!asset || asset.kind === 'audio') return;
      const srcTime = clip.in + (t - clip.start) * clip.speed;
      const frame = media.frame(clip, asset, srcTime);
      const key = asset.kind === 'image' ? `img:${asset.id}` : `vid:${clip.id}`;
      const dispW = q.w * k;
      tex = frame ? this.uploadFrame(key, frame, dispW) : this.textures.get(key) ?? null;
      if (!tex) return;
      tex.lastUsed = this.frameNo;
      uv = [clip.crop.left, clip.crop.top, 1 - clip.crop.right, 1 - clip.crop.bottom];
      if (onMain && p.background.blur && p.kind === 'video' && !this.covers(q, p)) {
        this.drawBlurFill(p, clip, tex, uv, target, k, q.opacity);
      }
    } else {
      const scaleBucket = bucket(k * clip.transform.scale);
      let sig: string;
      let make: () => Raster;
      if (clip.type === 'text') {
        const maxW = textMaxWidth(p);
        const reveal = q.reveal >= 1 ? 1 : Math.floor(q.reveal * 200) / 200;
        sig = `${clip.text}|${JSON.stringify(clip.style)}|${scaleBucket}|${reveal}|${maxW}|${fontsVersion.peek()}`;
        make = () => rasterizeText(clip, maxW, scaleBucket, reveal);
      } else if (clip.type === 'sticker') {
        sig = `${clip.emoji}|${clip.size}|${scaleBucket}`;
        make = () => rasterizeSticker(clip, scaleBucket);
      } else {
        sig = `${clip.shape}|${clip.width}|${clip.height}|${clip.fill}|${clip.strokeColor}|${clip.strokeWidth}|${scaleBucket}`;
        make = () => rasterizeShape(clip, scaleBucket);
      }
      tex = this.rasterTexture(`r:${clip.id}`, sig, make);
      marginScale = tex.margin;
    }

    // Quad in output pixels (expanded by raster margins for outlines/shadows).
    const sx = q.w / base.w;
    const sy = q.h / base.h;
    const dq: DrawQuad = {
      cx: q.cx * k,
      cy: q.cy * k,
      w: (q.w + 2 * marginScale * sx) * k,
      h: (q.h + 2 * marginScale * sy) * k,
      rotation: q.rotation,
      flipX: q.flipX,
      flipY: q.flipY,
    };

    const effects =
      opts.overrideEffects && opts.overrideEffects.clipId === clip.id ? opts.overrideEffects.effects : clip.effects;
    const needsFx = !opts.original && (!isNeutral(effects) || q.blur > 0.3);
    if (needsFx) {
      const srcW = tex.w * (uv[2] - uv[0]);
      const srcH = tex.h * (uv[3] - uv[1]);
      const f = Math.min(1, Math.max(dq.w / srcW, dq.h / srcH), 4096 / Math.max(srcW, srcH));
      const ew = Math.max(2, Math.round(srcW * f));
      const eh = Math.max(2, Math.round(srcH * f));
      const e0 = this.prepare(tex.tex, uv, false, ew, eh);
      const seed = (hashId(clip.id) % 97) + (p.kind === 'video' ? Math.floor(t * 24) % 61 : 0);
      const fx = this.develop(e0, effects, (q.blur * ew) / Math.max(1, q.w + 2 * marginScale * sx), seed);
      this.composite(target, fx.tex, dq, [0, 0, 1, 1], true, q.opacity);
      if (fx !== e0) this.pool.release(fx);
      this.pool.release(e0);
    } else {
      this.composite(target, tex.tex, dq, uv, false, q.opacity);
    }
  }

  /** Does the quad cover the whole canvas (no blurred fill needed)? */
  private covers(q: Quad, p: Project): boolean {
    const pad = -0.5;
    return (
      quadContains(q, { x: 0, y: 0 }, pad) &&
      quadContains(q, { x: p.width, y: 0 }, pad) &&
      quadContains(q, { x: 0, y: p.height }, pad) &&
      quadContains(q, { x: p.width, y: p.height }, pad)
    );
  }

  /** Blurred, cover-fitted copy of the media behind it (no black bars). */
  private drawBlurFill(
    p: Project,
    clip: MediaClip,
    tex: TexEntry,
    uv: [number, number, number, number],
    target: RenderTarget,
    k: number,
    opacity: number,
  ): void {
    const W = p.width * k;
    const H = p.height * k;
    const srcW = tex.w * (uv[2] - uv[0]);
    const srcH = tex.h * (uv[3] - uv[1]);
    const cover = Math.max(W / srcW, H / srcH) * 1.06;
    const sw = Math.max(8, Math.round(Math.min(160, srcW)));
    const sh = Math.max(8, Math.round((sw * srcH) / srcW));
    const small = this.prepare(tex.tex, uv, false, sw, sh);
    const blurred = this.blur(small, Math.max(sw, sh) * 0.045);
    this.composite(
      target,
      blurred.tex,
      { cx: W / 2, cy: H / 2, w: srcW * cover, h: srcH * cover, rotation: 0, flipX: clip.transform.flipX, flipY: false },
      [0, 0, 1, 1],
      true,
      opacity,
      0.82,
    );
    this.pool.release(blurred);
    this.pool.release(small);
  }

  /* ------------------------------------------------------------ GPU passes */

  /** Crop + normalise orientation into a render target of size w×h. */
  private prepare(
    tex: WebGLTexture,
    uv: [number, number, number, number],
    srcFlipY: boolean,
    w: number,
    h: number,
  ): RenderTarget {
    const gl = this.gl;
    const t = this.pool.acquire(w, h);
    this.bindTarget(t);
    gl.disable(gl.BLEND);
    const prog = this.progs.prepare.use();
    this.bindTex(0, tex);
    prog.i('uTex', 0).f('uCrop', uv[0], uv[1], uv[2], uv[3]).f('uSrcFlipY', srcFlipY ? 1 : 0);
    this.drawQuad();
    return t;
  }

  private downsample(src: RenderTarget): RenderTarget {
    const gl = this.gl;
    const t = this.pool.acquire(Math.max(1, Math.ceil(src.w / 2)), Math.max(1, Math.ceil(src.h / 2)));
    this.bindTarget(t);
    gl.disable(gl.BLEND);
    const prog = this.progs.down.use();
    this.bindTex(0, src.tex);
    prog.i('uTex', 0).f('uTexel', 1 / src.w, 1 / src.h);
    this.drawQuad();
    return t;
  }

  /** Gaussian blur (downsampled for big radii). Returns a new target; `src` is untouched. */
  blur(src: RenderTarget, sigma: number): RenderTarget {
    const gl = this.gl;
    let cur = src;
    let owned = false;
    let s = sigma;
    while (s > 4 && cur.w > 8 && cur.h > 8) {
      const d = this.downsample(cur);
      if (owned) this.pool.release(cur);
      cur = d;
      owned = true;
      s /= 2;
    }
    s = Math.max(0.5, s);
    const radius = Math.min(24, Math.ceil(s * 3));
    const tmp = this.pool.acquire(cur.w, cur.h);
    const prog = this.progs.blur.use();
    gl.disable(gl.BLEND);
    this.bindTarget(tmp);
    this.bindTex(0, cur.tex);
    prog.i('uTex', 0).f('uStep', 1 / cur.w, 0).f('uSigma', s).i('uRadius', radius);
    this.drawQuad();
    const out = this.pool.acquire(cur.w, cur.h);
    this.bindTarget(out);
    this.bindTex(0, tmp.tex);
    prog.f('uStep', 0, 1 / cur.h);
    this.drawQuad();
    this.pool.release(tmp);
    if (owned) this.pool.release(cur);
    return out;
  }

  private develop(e0: RenderTarget, effects: Clip['effects'], animBlurPx: number, seed: number): RenderTarget {
    const gl = this.gl;
    const look = resolveLook(effects);
    const A = look.adjust;
    const fxBlur = (A.blur / 100) * 0.035 * Math.max(e0.w, e0.h);
    const sigma = Math.sqrt(fxBlur * fxBlur + animBlurPx * animBlurPx);
    let base = e0;
    if (sigma > 0.5) base = this.blur(e0, sigma);
    let small: RenderTarget | null = null;
    let large: RenderTarget | null = null;
    if (A.sharpen > 0 && sigma <= 0.5) small = this.blur(base, 1.2);
    if (A.clarity !== 0 && sigma <= 0.5) large = this.blur(base, Math.max(2, 0.025 * Math.max(base.w, base.h)));

    const neutral = isNeutral({ ...effects, adjust: { ...A, blur: 0 } }) && !effects.chromaKey;
    if (neutral && base !== e0) return base; // just a blur
    const out = this.pool.acquire(base.w, base.h);
    this.bindTarget(out);
    gl.disable(gl.BLEND);
    const prog = this.progs.develop.use();
    this.bindTex(0, base.tex);
    this.bindTex(1, small ? small.tex : this.dummy);
    this.bindTex(2, large ? large.tex : this.dummy);
    const temp = A.temperature / 100;
    const tint = A.tint / 100;
    let r = 1 + 0.3 * temp + 0.06 * tint;
    let g = 1 - 0.22 * tint;
    let b = 1 - 0.3 * temp + 0.06 * tint;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r /= lum;
    g /= lum;
    b /= lum;
    const key = effects.chromaKey;
    const keyRGB = key ? parseColor(key.color) : [0, 0, 0, 0];
    const sh = parseColor(look.split.shadows);
    const hi = parseColor(look.split.highlights);
    prog
      .i('uTex', 0)
      .i('uBlurS', 1)
      .i('uBlurL', 2)
      .f('uUseSharpen', small ? 1 : 0)
      .f('uUseClarity', large ? 1 : 0)
      .f('uExposure', (A.exposure / 100) * 2)
      .f('uBrightness', A.brightness / 100)
      .f('uContrast', A.contrast / 100)
      .f('uHighlights', A.highlights / 100)
      .f('uShadows', A.shadows / 100)
      .f('uWhites', A.whites / 100)
      .f('uBlacks', A.blacks / 100)
      .f('uWB', r, g, b)
      .f('uSaturation', A.saturation / 100)
      .f('uVibrance', A.vibrance / 100)
      .f('uHue', (A.hue / 100) * Math.PI)
      .f('uFade', A.fade / 100)
      .f('uVignette', A.vignette / 100)
      .f('uGrain', A.grain / 100)
      .f('uSharpen', A.sharpen / 100)
      .f('uClarity', A.clarity / 100)
      .f('uMono', look.mono.weights[0], look.mono.weights[1], look.mono.weights[2], look.mono.amount)
      .f('uSplitShadows', sh[0], sh[1], sh[2])
      .f('uSplitHighlights', hi[0], hi[1], hi[2])
      .f('uSplit', look.split.amount, look.split.balance)
      .f('uKey', keyRGB[0]!, keyRGB[1]!, keyRGB[2]!, key ? 1 : 0)
      .f('uKeyParams', key?.similarity ?? 0, key?.smoothness ?? 0, key?.spill ?? 0)
      .f('uSize', base.w, base.h)
      .f('uSeed', seed);
    this.drawQuad();
    if (small) this.pool.release(small);
    if (large) this.pool.release(large);
    if (base !== e0) this.pool.release(base);
    return out;
  }

  private composite(
    target: RenderTarget,
    tex: WebGLTexture,
    q: DrawQuad,
    uv: [number, number, number, number],
    srcFlipY: boolean,
    opacity: number,
    dim = 1,
  ): void {
    const gl = this.gl;
    this.bindTarget(target);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const prog = this.progs.composite.use();
    this.bindTex(0, tex);
    const c = Math.cos(q.rotation);
    const s = Math.sin(q.rotation);
    const W = target.w;
    const H = target.h;
    // projection (px, y down → clip) × translate × rotate, column-major
    const m = new Float32Array([
      (2 / W) * c,
      (-2 / H) * s,
      0,
      (2 / W) * -s,
      (-2 / H) * c,
      0,
      (2 / W) * q.cx - 1,
      1 - (2 / H) * q.cy,
      1,
    ]);
    prog
      .i('uTex', 0)
      .mat3('uMatrix', m)
      .f('uSize', q.w, q.h)
      .f('uUvRect', uv[0], uv[1], uv[2], uv[3])
      .f('uFlip', q.flipX ? 1 : 0, q.flipY ? 1 : 0)
      .f('uSrcFlipY', srcFlipY ? 1 : 0)
      .f('uOpacity', opacity)
      .f('uDim', dim);
    this.drawQuad();
  }

  /* -------------------------------------------------------------- textures */

  private uploadFrame(key: string, frame: MediaFrame, displayW: number): TexEntry {
    const gl = this.gl;
    let e = this.textures.get(key);
    const wantMips = frame.isStatic || displayW < frame.width * 0.6;
    if (e && e.frameId === frame.frameId && e.w === frame.width && e.h === frame.height) {
      e.lastUsed = this.frameNo;
      return e;
    }
    if (!e) {
      e = { tex: createTexture(gl, wantMips), w: 0, h: 0, frameId: -1, margin: 0, mips: wantMips, lastUsed: 0 };
      this.textures.set(key, e);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    // Video is opaque: skip the premultiply conversion (keeps uploads on the fast path).
    if (!frame.isStatic) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame.source);
    } catch (err) {
      console.warn('Texture upload failed', err);
      return e;
    } finally {
      if (!frame.isStatic) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    }
    if (wantMips) gl.generateMipmap(gl.TEXTURE_2D);
    if (wantMips !== e.mips) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, wantMips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      e.mips = wantMips;
    }
    e.w = frame.width;
    e.h = frame.height;
    e.frameId = frame.frameId;
    e.lastUsed = this.frameNo;
    return e;
  }

  private rasterTexture(key: string, sig: string, make: () => Raster): TexEntry {
    const gl = this.gl;
    let e = this.textures.get(key);
    if (e && e.sig === sig) {
      e.lastUsed = this.frameNo;
      return e;
    }
    const r = make();
    if (!e) {
      e = { tex: createTexture(gl, true), w: 0, h: 0, frameId: 0, margin: 0, mips: true, lastUsed: 0 };
      this.textures.set(key, e);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, r.canvas as TexImageSource);
    gl.generateMipmap(gl.TEXTURE_2D);
    e.w = (r.canvas as AnyCanvas).width;
    e.h = (r.canvas as AnyCanvas).height;
    e.sig = sig;
    e.margin = r.margin;
    e.lastUsed = this.frameNo;
    return e;
  }

  private evictTextures(): void {
    for (const [key, e] of this.textures) {
      if (this.frameNo - e.lastUsed > 600) {
        this.gl.deleteTexture(e.tex);
        this.textures.delete(key);
      }
    }
  }

  /** Forget a cached texture (e.g. an asset was replaced). */
  invalidate(prefix: string): void {
    for (const [key, e] of this.textures) {
      if (key.startsWith(prefix)) {
        this.gl.deleteTexture(e.tex);
        this.textures.delete(key);
      }
    }
  }

  /* --------------------------------------------------------------- helpers */

  private bindTarget(t: RenderTarget): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, t.fbo);
    this.gl.viewport(0, 0, t.w, t.h);
  }

  private clearTarget(t: RenderTarget): void {
    const gl = this.gl;
    this.bindTarget(t);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private bindTex(unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  private drawQuad(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Reads the current canvas into RGBA bytes (tests and analysis). */
  readPixels(): Uint8Array {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  dispose(): void {
    const gl = this.gl;
    for (const e of this.textures.values()) gl.deleteTexture(e.tex);
    this.textures.clear();
    this.pool.dispose();
    if (this.out) for (const o of this.out) deleteTarget(gl, o);
    this.out = null;
    for (const p of Object.values(this.progs)) p.dispose();
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.dummy);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Raster scale rounded up to quarter-octave steps (fewer re-draws while zooming). */
function bucket(scale: number): number {
  const s = Math.max(0.05, scale);
  return Math.pow(2, Math.ceil(Math.log2(s) * 4) / 4);
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
