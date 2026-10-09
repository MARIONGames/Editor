import {
  clamp01,
  easeInCubic,
  easeOutBack,
  easeOutBounce,
  easeOutCubic,
  hash01,
  lerp,
} from '../util/math';
import type { AnimInType, Animation, Clip, Motion } from './types';

/** How an animation changes a clip at one moment. Offsets are fractions of the canvas. */
export interface AnimState {
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  opacity: number;
  /** Extra blur in canvas pixels. */
  blur: number;
  /** 0..1 fraction of text revealed (typewriter). */
  reveal: number;
}

export const IDENTITY_ANIM: Readonly<AnimState> = Object.freeze({
  dx: 0,
  dy: 0,
  scale: 1,
  rotate: 0,
  opacity: 1,
  blur: 0,
  reveal: 1,
});

/** Applies an entrance-style animation with progress p (0 = hidden, 1 = settled). */
function applyEntrance(s: AnimState, type: AnimInType, p: number): void {
  const e = easeOutCubic(p);
  switch (type) {
    case 'none':
      return;
    case 'fade':
      s.opacity *= e;
      return;
    case 'pop':
      s.scale *= lerp(0.35, 1, easeOutBack(p));
      s.opacity *= clamp01(p * 3);
      return;
    case 'slide-up':
      s.dy += (1 - e) * 0.12;
      s.opacity *= clamp01(p * 2);
      return;
    case 'slide-down':
      s.dy -= (1 - e) * 0.12;
      s.opacity *= clamp01(p * 2);
      return;
    case 'slide-left':
      s.dx += (1 - e) * 0.18;
      s.opacity *= clamp01(p * 2);
      return;
    case 'slide-right':
      s.dx -= (1 - e) * 0.18;
      s.opacity *= clamp01(p * 2);
      return;
    case 'zoom-in':
      s.scale *= lerp(0.5, 1, e);
      s.opacity *= clamp01(p * 2);
      return;
    case 'zoom-out':
      s.scale *= lerp(1.6, 1, e);
      s.opacity *= clamp01(p * 2);
      return;
    case 'spin':
      s.rotate += (1 - e) * -200;
      s.scale *= lerp(0.3, 1, e);
      s.opacity *= clamp01(p * 2);
      return;
    case 'drop':
      s.dy -= (1 - easeOutBounce(p)) * 0.35;
      s.opacity *= clamp01(p * 4);
      return;
    case 'blur':
      s.blur += (1 - e) * 24;
      s.opacity *= clamp01(p * 1.5);
      return;
    case 'typewriter':
      s.reveal = Math.min(s.reveal, p);
      return;
  }
}

/** Animation state of a clip at local time `local` (seconds since the clip started). */
export function animState(anim: Animation, local: number, duration: number): AnimState {
  const s: AnimState = { ...IDENTITY_ANIM };
  // Make sure in + out never exceed the clip.
  let inD = anim.in === 'none' ? 0 : Math.max(0.05, anim.inDuration);
  let outD = anim.out === 'none' ? 0 : Math.max(0.05, anim.outDuration);
  const total = inD + outD;
  if (total > duration && total > 0) {
    const k = duration / total;
    inD *= k;
    outD *= k;
  }
  if (inD > 0 && local < inD) applyEntrance(s, anim.in, clamp01(local / inD));
  if (outD > 0 && local > duration - outD) {
    // Exits are entrances played backwards (with an ease-in feel).
    const q = clamp01((duration - local) / outD);
    applyEntrance(s, anim.out, 1 - easeInCubic(1 - q));
  }
  switch (anim.loop) {
    case 'pulse':
      s.scale *= 1 + 0.06 * Math.sin((local / 1.1) * Math.PI * 2);
      break;
    case 'float':
      s.dy += 0.012 * Math.sin((local / 2.4) * Math.PI * 2);
      break;
    case 'wiggle':
      s.rotate += 6 * Math.sin((local / 0.6) * Math.PI * 2);
      break;
    case 'heartbeat': {
      const ph = local % 1;
      const beat = Math.exp(-Math.pow((ph - 0.1) / 0.05, 2)) + 0.6 * Math.exp(-Math.pow((ph - 0.3) / 0.05, 2));
      s.scale *= 1 + 0.1 * beat;
      break;
    }
    case 'blink': {
      const flick = Math.sin(local * 9.1) + Math.sin(local * 23.7) * 0.5;
      s.opacity *= flick < -1.1 ? 0.35 : 1;
      break;
    }
    case 'spin':
      s.rotate += (local / 3) * 360;
      break;
    case 'none':
      break;
  }
  return s;
}

/** The concrete movement chosen for a clip ('auto' picks a stable one per clip). */
export function resolveMotion(clip: Clip): Exclude<Motion, 'auto'> {
  if (clip.type !== 'media') return 'none';
  if (clip.motion !== 'auto') return clip.motion;
  const options: Exclude<Motion, 'auto' | 'none'>[] = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'];
  return options[Math.floor(hash01(clip.id) * options.length) % options.length]!;
}

export const MOTION_ZOOM = 1.12;

/** Ken Burns state: scale multiplier and pan offset as a fraction of the clip size. */
export function motionState(motion: Exclude<Motion, 'auto'>, progress: number): { scale: number; px: number; py: number } {
  const t = clamp01(progress);
  // Ease very gently so motion never "stops" abruptly.
  const e = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
  const travel = (MOTION_ZOOM - 1) / 2;
  switch (motion) {
    case 'zoom-in':
      return { scale: lerp(1, MOTION_ZOOM, e), px: 0, py: 0 };
    case 'zoom-out':
      return { scale: lerp(MOTION_ZOOM, 1, e), px: 0, py: 0 };
    case 'pan-left':
      return { scale: MOTION_ZOOM, px: lerp(travel, -travel, e), py: 0 };
    case 'pan-right':
      return { scale: MOTION_ZOOM, px: lerp(-travel, travel, e), py: 0 };
    case 'pan-up':
      return { scale: MOTION_ZOOM, px: 0, py: lerp(travel, -travel, e) };
    case 'pan-down':
      return { scale: MOTION_ZOOM, px: 0, py: lerp(-travel, travel, e) };
    case 'none':
      return { scale: 1, px: 0, py: 0 };
  }
}
