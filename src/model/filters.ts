import { clamp } from '../util/math';
import { ADJUST_KEYS, NEUTRAL_ADJUST } from './defaults';
import type { Adjustments, Effects } from './types';

/**
 * Filter "looks" are presets over the same develop pipeline as the manual sliders,
 * plus two extras the sliders don't expose: a black & white channel mixer and
 * split-toning. Because they are parametric, a filter's intensity is a smooth blend.
 */
export interface FilterLook {
  id: string;
  name: string;
  adjust: Partial<Adjustments>;
  /** Black & white channel weights (sum ≈ 1). */
  mono?: [number, number, number];
  split?: { shadows: string; highlights: string; amount: number; balance?: number };
}

export const FILTERS: FilterLook[] = [
  { id: 'vivid', name: 'Vivid', adjust: { vibrance: 38, contrast: 12, saturation: 6, clarity: 8 } },
  { id: 'warm', name: 'Warm', adjust: { temperature: 28, vibrance: 10, highlights: -6 } },
  { id: 'cool', name: 'Cool', adjust: { temperature: -26, tint: 4, contrast: 6 } },
  {
    id: 'golden',
    name: 'Golden hour',
    adjust: { temperature: 32, tint: 6, shadows: 12, highlights: -10, vibrance: 14 },
    split: { shadows: '#5a3d8a', highlights: '#ffb35c', amount: 0.25 },
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    adjust: { contrast: 16, highlights: -22, shadows: 10, saturation: -8, vignette: 22 },
    split: { shadows: '#0f6e7a', highlights: '#ff9a4a', amount: 0.32 },
  },
  {
    id: 'teal-orange',
    name: 'Teal & orange',
    adjust: { contrast: 10, vibrance: 12 },
    split: { shadows: '#008b8b', highlights: '#ff8c3a', amount: 0.5 },
  },
  {
    id: 'film',
    name: 'Film',
    adjust: { fade: 18, contrast: -6, grain: 24, saturation: -12, highlights: -8 },
    split: { shadows: '#1f5f66', highlights: '#ffe6b8', amount: 0.25 },
  },
  {
    id: 'retro',
    name: 'Retro',
    adjust: { fade: 26, saturation: -18, temperature: 16, vignette: 26, grain: 26, contrast: -4 },
  },
  {
    id: 'moody',
    name: 'Moody',
    adjust: { exposure: -10, contrast: 20, saturation: -26, shadows: -10, vignette: 30, temperature: -8 },
  },
  {
    id: 'dreamy',
    name: 'Dreamy',
    adjust: { brightness: 10, contrast: -16, fade: 10, clarity: -35, highlights: 8, vibrance: 6 },
  },
  { id: 'crisp', name: 'Crisp', adjust: { clarity: 35, sharpen: 30, contrast: 10, vibrance: 12 } },
  {
    id: 'pastel',
    name: 'Pastel',
    adjust: { saturation: -26, fade: 20, brightness: 12, contrast: -16, tint: 5 },
  },
  { id: 'food', name: 'Tasty', adjust: { temperature: 12, vibrance: 28, clarity: 12, shadows: 8 } },
  {
    id: 'portrait',
    name: 'Portrait',
    adjust: { temperature: 8, clarity: -12, highlights: -10, shadows: 12, vibrance: 6 },
  },
  { id: 'neon', name: 'Neon', adjust: { saturation: 38, contrast: 22, tint: 14, vibrance: 22 } },
  { id: 'fade', name: 'Faded', adjust: { fade: 32, contrast: -10, saturation: -6 } },
  { id: 'matte', name: 'Matte', adjust: { blacks: 26, contrast: -10, saturation: -10, fade: 8 } },
  {
    id: 'polaroid',
    name: 'Instant',
    adjust: { temperature: 10, fade: 20, vignette: 16, contrast: -6, saturation: -8 },
    split: { shadows: '#3a5c7a', highlights: '#fff1c9', amount: 0.25 },
  },
  { id: 'bw', name: 'Black & white', adjust: { contrast: 10 }, mono: [0.299, 0.587, 0.114] },
  {
    id: 'noir',
    name: 'Noir',
    adjust: { contrast: 38, blacks: -20, vignette: 32, clarity: 12 },
    mono: [0.35, 0.55, 0.1],
  },
  {
    id: 'silver',
    name: 'Silver',
    adjust: { fade: 16, contrast: -4, brightness: 6 },
    mono: [0.2, 0.5, 0.3],
  },
  {
    id: 'sepia',
    name: 'Sepia',
    adjust: { contrast: 4, fade: 6 },
    mono: [0.299, 0.587, 0.114],
    split: { shadows: '#4a2f1a', highlights: '#f2d7a6', amount: 0.75 },
  },
  {
    id: 'vintage',
    name: 'Vintage',
    adjust: { fade: 22, grain: 30, vignette: 28, saturation: -34, temperature: 18 },
    split: { shadows: '#3d2a1e', highlights: '#f5deb3', amount: 0.35 },
  },
];

export function filterById(id: string | null | undefined): FilterLook | undefined {
  return id ? FILTERS.find((f) => f.id === id) : undefined;
}

/** Fully resolved develop parameters for the renderer. */
export interface ResolvedLook {
  adjust: Adjustments;
  mono: { weights: [number, number, number]; amount: number };
  split: { shadows: string; highlights: string; amount: number; balance: number };
}

const RANGE: Partial<Record<keyof Adjustments, [number, number]>> = {
  clarity: [-100, 100],
  sharpen: [0, 100],
  blur: [0, 100],
  grain: [0, 100],
  fade: [0, 100],
};

export function resolveLook(effects: Effects): ResolvedLook {
  const look = filterById(effects.filter?.id);
  const k = look ? clamp(effects.filter!.intensity, 0, 1) : 0;
  const adjust = { ...effects.adjust };
  if (look && k > 0) {
    for (const key of ADJUST_KEYS) {
      const add = look.adjust[key];
      if (add) {
        const [lo, hi] = RANGE[key] ?? [-100, 100];
        adjust[key] = clamp(adjust[key] + add * k, lo, hi);
      }
    }
  }
  return {
    adjust,
    mono: { weights: look?.mono ?? [0.299, 0.587, 0.114], amount: look?.mono ? k : 0 },
    split: look?.split
      ? { ...look.split, balance: look.split.balance ?? 0, amount: look.split.amount * k }
      : { shadows: '#000000', highlights: '#ffffff', amount: 0, balance: 0 },
  };
}

/** True when the effects leave the image untouched (lets the renderer skip passes). */
export function isNeutral(effects: Effects): boolean {
  if (effects.chromaKey) return false;
  if (effects.filter && effects.filter.intensity > 0 && filterById(effects.filter.id)) return false;
  for (const key of ADJUST_KEYS) if (effects.adjust[key] !== NEUTRAL_ADJUST[key]) return false;
  return true;
}
