/**
 * Auto-enhance: looks at the picture's light and colour (histograms) and picks
 * gentle, natural corrections — like a photographer's first pass.
 */
import type { Adjustments } from '../model/types';
import { clamp } from '../util/math';

export interface ImageStats {
  /** Luminance percentiles (0..1, display-referred). */
  p01: number;
  p05: number;
  p50: number;
  p95: number;
  p99: number;
  /** Fraction of nearly white / nearly black pixels. */
  clippedHigh: number;
  clippedLow: number;
  /** Average colour of mid-tone, low-saturation pixels (for white balance). */
  grey: [number, number, number];
  meanSaturation: number;
}

/** Statistics from RGBA bytes (any size; a 128–256 px thumbnail is plenty). */
export function imageStats(data: Uint8ClampedArray | Uint8Array): ImageStats {
  const hist = new Uint32Array(256);
  let n = 0;
  let gr = 0;
  let gg = 0;
  let gb = 0;
  let gn = 0;
  let satSum = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    hist[Math.min(255, Math.round(l * 255))]!++;
    n++;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    satSum += sat;
    if (l > 0.98) hi++;
    if (l < 0.02) lo++;
    if (l > 0.18 && l < 0.85 && sat < 0.45) {
      gr += r;
      gg += g;
      gb += b;
      gn++;
    }
  }
  const pct = (q: number) => {
    if (!n) return 0.5;
    const target = q * n;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i]!;
      if (acc >= target) return i / 255;
    }
    return 1;
  };
  return {
    p01: pct(0.01),
    p05: pct(0.05),
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    clippedHigh: n ? hi / n : 0,
    clippedLow: n ? lo / n : 0,
    grey: gn > 20 ? [gr / gn, gg / gn, gb / gn] : [0.5, 0.5, 0.5],
    meanSaturation: n ? satSum / n : 0,
  };
}

/** Natural-looking corrections for the given statistics. */
export function autoAdjust(s: ImageStats): Partial<Adjustments> {
  const out: Partial<Adjustments> = {};
  // Exposure: bring the median towards a pleasant mid-grey (in linear light).
  const medLin = Math.pow(Math.max(0.02, s.p50), 2.2);
  const targetLin = Math.pow(0.47, 2.2);
  const ev = Math.log2(targetLin / medLin);
  // Don't fight intentionally dark/bright pictures too hard.
  out.exposure = Math.round(clamp(ev * 50 * 0.65, -45, 55));
  if (Math.abs(out.exposure) < 4) delete out.exposure;

  // Recover clipped highlights / open up crushed shadows.
  if (s.clippedHigh > 0.01 || s.p99 > 0.985) out.highlights = Math.round(-clamp(20 + s.clippedHigh * 400, 0, 55));
  if (s.p05 < 0.06 && s.p50 < 0.45) out.shadows = Math.round(clamp(15 + (0.06 - s.p05) * 300, 0, 45));

  // Contrast from the spread of tones.
  const spread = s.p95 - s.p05;
  if (spread < 0.62) out.contrast = Math.round(clamp((0.75 - spread) * 90, 0, 32));
  else if (spread > 0.92) out.contrast = -8;

  // Levels: make sure there is a real black and white.
  if (s.p01 > 0.06) out.blacks = Math.round(-clamp((s.p01 - 0.03) * 220, 0, 30));
  if (s.p99 < 0.9) out.whites = Math.round(clamp((0.95 - s.p99) * 200, 0, 30));

  // White balance: neutralise the average of greyish pixels (gently).
  const [r, g, b] = s.grey;
  const warmth = clamp((b - r) * 220, -35, 35);
  const tint = clamp((g - (r + b) / 2) * 260, -25, 25);
  if (Math.abs(warmth) > 3) out.temperature = Math.round(warmth);
  if (Math.abs(tint) > 3) out.tint = Math.round(tint);

  // Colour: a little life for dull pictures.
  if (s.meanSaturation < 0.32) out.vibrance = Math.round(clamp((0.38 - s.meanSaturation) * 110, 5, 30));
  out.clarity = 8;
  return out;
}
