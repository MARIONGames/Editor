/**
 * "Remove silent parts": finds the pauses in speech using the loudness (RMS)
 * envelope stored at import, and returns the parts to keep.
 */
export interface SilenceOptions {
  /** Pauses shorter than this are kept (seconds). */
  minSilence: number;
  /** Extra time kept before and after each spoken part (seconds). */
  padding: number;
  /** Optional fixed threshold in dBFS; otherwise it adapts to the background noise. */
  thresholdDb?: number;
  /** Spoken bits shorter than this are dropped (clicks, breaths). */
  minKeep: number;
}

export const DEFAULT_SILENCE: SilenceOptions = { minSilence: 0.6, padding: 0.12, minKeep: 0.15 };

const toDb = (v: number) => (v > 1e-7 ? 20 * Math.log10(v) : -140);

/** Threshold (dBFS) adapted to the clip: a bit above its quietest 15%. */
export function adaptiveThreshold(rms: Float32Array, from: number, to: number): number {
  const vals: number[] = [];
  for (let i = from; i < to; i++) vals.push(toDb(rms[i] ?? 0));
  if (!vals.length) return -45;
  vals.sort((a, b) => a - b);
  const floor = vals[Math.floor(vals.length * 0.15)]!;
  const loud = vals[Math.floor(vals.length * 0.9)]!;
  // Halfway-ish between background and speech, within sensible limits.
  const t = floor + Math.max(6, (loud - floor) * 0.35);
  return Math.max(-55, Math.min(-22, t));
}

/**
 * @param rms loudness per bin
 * @param binsPerSecond resolution of `rms` (100 = 10 ms bins)
 * @param srcIn start of the clip in the source (seconds)
 * @param srcOut end of the clip in the source (seconds)
 * @returns ranges (source seconds) to keep, in order
 */
export function findKeepRanges(
  rms: Float32Array,
  binsPerSecond: number,
  srcIn: number,
  srcOut: number,
  opts: SilenceOptions = DEFAULT_SILENCE,
): { in: number; out: number }[] {
  const b0 = Math.max(0, Math.floor(srcIn * binsPerSecond));
  const b1 = Math.min(rms.length, Math.ceil(srcOut * binsPerSecond));
  if (b1 <= b0) return [{ in: srcIn, out: srcOut }];
  const thr = opts.thresholdDb ?? adaptiveThreshold(rms, b0, b1);
  const minSilBins = Math.round(opts.minSilence * binsPerSecond);
  // Find silent runs.
  const silent: [number, number][] = [];
  let runStart = -1;
  for (let i = b0; i <= b1; i++) {
    const quiet = i < b1 && toDb(rms[i]!) < thr;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      if (i - runStart >= minSilBins) silent.push([runStart, i]);
      runStart = -1;
    }
  }
  // Keep = everything else, padded.
  const keep: { in: number; out: number }[] = [];
  let cursor = srcIn;
  for (const [s, e] of silent) {
    const sStart = s / binsPerSecond + opts.padding;
    const sEnd = e / binsPerSecond - opts.padding;
    if (sEnd - sStart <= 0.05) continue;
    if (sStart > cursor) keep.push({ in: cursor, out: Math.min(sStart, srcOut) });
    cursor = Math.max(cursor, sEnd);
  }
  if (cursor < srcOut) keep.push({ in: cursor, out: srcOut });
  return keep.filter((r) => r.out - r.in >= opts.minKeep);
}

export function totalLength(ranges: { in: number; out: number }[]): number {
  return ranges.reduce((s, r) => s + (r.out - r.in), 0);
}
