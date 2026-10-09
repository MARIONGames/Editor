/**
 * Keyframe animation: sampling, editing keys, and one-tap motion presets that produce
 * ordinary keys (so pros can refine whatever beginners start with).
 */
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutBounce, easeOutCubic } from '../../util/math';
import type { AnimChannels, Ease, Keyframe, Obj3D, Transform3, Vec3 } from './types';

export const EASES: { id: Ease; name: string; hint: string }[] = [
  { id: 'ease', name: 'Smooth', hint: 'Starts and stops gently (most natural)' },
  { id: 'linear', name: 'Steady', hint: 'Same speed all the way (machines, spinning things)' },
  { id: 'ease-in', name: 'Speed up', hint: 'Starts slow, ends fast (falling)' },
  { id: 'ease-out', name: 'Slow down', hint: 'Starts fast, ends slow (landing, arriving)' },
  { id: 'back', name: 'Overshoot', hint: 'Goes a little too far, then settles (cartoony)' },
  { id: 'bounce', name: 'Bounce', hint: 'Bounces before it settles' },
  { id: 'elastic', name: 'Spring', hint: 'Wobbles like a spring' },
  { id: 'constant', name: 'Jump', hint: 'Holds, then jumps to the next key (stop-motion feel)' },
];

const easeOutElastic = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};

export function ease(e: Ease, t: number): number {
  switch (e) {
    case 'constant':
      return 0;
    case 'linear':
      return t;
    case 'ease':
      return easeInOutCubic(t);
    case 'ease-in':
      return easeInCubic(t);
    case 'ease-out':
      return easeOutCubic(t);
    case 'back':
      return easeOutBack(t);
    case 'bounce':
      return easeOutBounce(t);
    case 'elastic':
      return easeOutElastic(t);
  }
}

/** Value of a channel at time t (null when it has no keys). */
export function sample(keys: readonly Keyframe[] | undefined, t: number): number[] | null {
  if (!keys || !keys.length) return null;
  if (t <= keys[0]!.t) return keys[0]!.v.slice();
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.v.slice();
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo]!;
  const b = keys[hi]!;
  const k = ease(a.e, (t - a.t) / Math.max(1e-9, b.t - a.t));
  return a.v.map((x, i) => x + ((b.v[i] ?? x) - x) * k);
}

/** Adds or replaces the key at time t (keys stay sorted). */
export function setKey(keys: readonly Keyframe[] | undefined, t: number, v: number[], e?: Ease, eps = 1 / 240): Keyframe[] {
  const out = (keys ?? []).slice();
  const i = out.findIndex((k) => Math.abs(k.t - t) < eps);
  if (i >= 0) out[i] = { t: out[i]!.t, v: v.slice(), e: e ?? out[i]!.e };
  else {
    out.push({ t, v: v.slice(), e: e ?? 'ease' });
    out.sort((a, b) => a.t - b.t);
  }
  return out;
}

export function removeKeys(keys: readonly Keyframe[], times: readonly number[], eps = 1 / 240): Keyframe[] {
  return keys.filter((k) => !times.some((t) => Math.abs(k.t - t) < eps));
}

/** Shifts the keys at `times` by dt (later keys at the same moment win). */
export function moveKeys(keys: readonly Keyframe[], times: readonly number[], dt: number, eps = 1 / 240): Keyframe[] {
  const moved = keys.map((k) => (times.some((t) => Math.abs(k.t - t) < eps) ? { ...k, t: Math.max(0, k.t + dt) } : k));
  moved.sort((a, b) => a.t - b.t);
  const out: Keyframe[] = [];
  for (const k of moved) {
    if (out.length && Math.abs(out[out.length - 1]!.t - k.t) < eps) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

export function setEase(keys: readonly Keyframe[], times: readonly number[], e: Ease, eps = 1 / 240): Keyframe[] {
  return keys.map((k) => (times.some((t) => Math.abs(k.t - t) < eps) ? { ...k, e } : k));
}

/** Every keyed moment of an object (for the dope sheet summary row). */
export function keyTimes(anim: AnimChannels | undefined): number[] {
  if (!anim) return [];
  const set = new Set<number>();
  for (const keys of Object.values(anim)) for (const k of keys) set.add(Math.round(k.t * 1000) / 1000);
  return [...set].sort((a, b) => a - b);
}

export function animEnd(anim: AnimChannels | undefined): number {
  let end = 0;
  if (anim) for (const keys of Object.values(anim)) if (keys.length) end = Math.max(end, keys[keys.length - 1]!.t);
  return end;
}

/** The object's transform at time t. */
export function transformAt(obj: Obj3D, t: number): Transform3 {
  const a = obj.anim;
  if (!a) return obj.t;
  const p = sample(a.p, t);
  const r = sample(a.r, t);
  const s = sample(a.s, t);
  if (!p && !r && !s) return obj.t;
  return { p: (p as Vec3) ?? obj.t.p, r: (r as Vec3) ?? obj.t.r, s: (s as Vec3) ?? obj.t.s };
}

export function scalarAt(obj: Obj3D, channel: string, fallback: number, t: number): number {
  const v = sample(obj.anim?.[channel], t);
  return v ? v[0]! : fallback;
}

/* ------------------------------------------------------------------ presets */

export type MotionPreset = 'spin' | 'bounce' | 'float' | 'pop' | 'wobble' | 'pulse' | 'fly-in' | 'turntable';

export const MOTION_PRESETS: { id: MotionPreset; name: string; hint: string }[] = [
  { id: 'spin', name: 'Spin', hint: 'Turns all the way around' },
  { id: 'bounce', name: 'Bounce', hint: 'Jumps and lands with a squash' },
  { id: 'float', name: 'Float', hint: 'Bobs gently up and down' },
  { id: 'pop', name: 'Pop in', hint: 'Grows from nothing with a little overshoot' },
  { id: 'wobble', name: 'Wobble', hint: 'Rocks from side to side' },
  { id: 'pulse', name: 'Pulse', hint: 'Grows and shrinks like a heartbeat' },
  { id: 'fly-in', name: 'Fly in', hint: 'Swoops in from the side and settles' },
  { id: 'turntable', name: 'Turntable', hint: 'One slow, steady turn — perfect for showing off a model' },
];

const k = (t: number, v: number[], e: Ease = 'ease'): Keyframe => ({ t, v, e });

/** Keys for a motion preset, starting at `start` and lasting `dur` seconds. */
export function presetKeys(preset: MotionPreset, base: Transform3, start: number, dur: number): AnimChannels {
  const [px, py, pz] = base.p;
  const [rx, ry, rz] = base.r;
  const [sx, sy, sz] = base.s;
  const t = (f: number) => start + dur * f;
  switch (preset) {
    case 'spin':
      return { r: [k(t(0), [rx, ry, rz], 'ease'), k(t(1), [rx, ry + Math.PI * 2, rz])] };
    case 'turntable':
      return { r: [k(t(0), [rx, ry, rz], 'linear'), k(t(1), [rx, ry + Math.PI * 2, rz], 'linear')] };
    case 'bounce': {
      const h = Math.max(0.5, sy);
      return {
        p: [
          k(t(0), [px, py, pz], 'ease-out'),
          k(t(0.25), [px, py + h, pz], 'ease-in'),
          k(t(0.5), [px, py, pz], 'ease-out'),
          k(t(0.68), [px, py + h * 0.4, pz], 'ease-in'),
          k(t(0.84), [px, py, pz], 'ease-out'),
          k(t(0.92), [px, py + h * 0.12, pz], 'ease-in'),
          k(t(1), [px, py, pz]),
        ],
        // Squash on landing, stretch while flying — the classic animation principle.
        s: [
          k(t(0), [sx, sy, sz], 'ease-out'),
          k(t(0.1), [sx * 0.9, sy * 1.15, sz * 0.9]),
          k(t(0.25), [sx, sy, sz], 'ease-in'),
          k(t(0.48), [sx * 1.05, sy * 0.95, sz * 1.05]),
          k(t(0.52), [sx * 1.2, sy * 0.75, sz * 1.2], 'ease-out'),
          k(t(0.62), [sx, sy, sz]),
          k(t(1), [sx, sy, sz]),
        ],
      };
    }
    case 'float':
      return {
        p: [k(t(0), [px, py, pz]), k(t(0.5), [px, py + 0.25, pz]), k(t(1), [px, py, pz])],
        r: [k(t(0), [rx, ry, rz]), k(t(0.5), [rx, ry + 0.25, rz]), k(t(1), [rx, ry, rz])],
      };
    case 'pop':
      return {
        s: [k(t(0), [0, 0, 0], 'back'), k(t(Math.min(1, 0.6 / Math.max(0.6, dur))), [sx, sy, sz]), k(t(1), [sx, sy, sz])],
      };
    case 'wobble':
      return {
        r: [
          k(t(0), [rx, ry, rz]),
          k(t(0.2), [rx, ry, rz + 0.3]),
          k(t(0.45), [rx, ry, rz - 0.25]),
          k(t(0.7), [rx, ry, rz + 0.12]),
          k(t(0.88), [rx, ry, rz - 0.05]),
          k(t(1), [rx, ry, rz]),
        ],
      };
    case 'pulse':
      return {
        s: [k(t(0), [sx, sy, sz]), k(t(0.15), [sx * 1.15, sy * 1.15, sz * 1.15]), k(t(0.3), [sx, sy, sz]), k(t(0.45), [sx * 1.1, sy * 1.1, sz * 1.1]), k(t(0.6), [sx, sy, sz]), k(t(1), [sx, sy, sz])],
      };
    case 'fly-in':
      return {
        p: [k(t(0), [px - 8, py + 2, pz], 'ease-out'), k(t(0.7), [px, py, pz]), k(t(1), [px, py, pz])],
        r: [k(t(0), [rx, ry - 1.2, rz + 0.6], 'ease-out'), k(t(0.7), [rx, ry, rz]), k(t(1), [rx, ry, rz])],
      };
  }
}

/** Merges preset channels into existing ones (replacing keys inside the preset's time span). */
export function mergeChannels(anim: AnimChannels | undefined, add: AnimChannels): AnimChannels {
  const out: AnimChannels = { ...(anim ?? {}) };
  for (const [ch, keys] of Object.entries(add)) {
    if (!keys.length) continue;
    const t0 = keys[0]!.t - 1e-6;
    const t1 = keys[keys.length - 1]!.t + 1e-6;
    const kept = (out[ch] ?? []).filter((x) => x.t < t0 || x.t > t1);
    out[ch] = [...kept, ...keys].sort((a, b) => a.t - b.t);
  }
  return out;
}
