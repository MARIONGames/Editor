/**
 * Beat detection for "sync photos to the music": an onset-strength envelope
 * (emphasising kick drums), tempo by autocorrelation, and a beat grid aligned
 * to the strongest onsets.
 */
export interface BeatInfo {
  /** Seconds between beats. */
  period: number;
  bpm: number;
  /** Time of the first beat (seconds). */
  offset: number;
  /** 0..1 how clear the rhythm is. */
  confidence: number;
}

const HOP = 0.01; // 10 ms envelope resolution

/** Onset strength envelope (one value per 10 ms) from mono samples. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate * HOP));
  const n = Math.floor(samples.length / hop);
  const energy = new Float32Array(n);
  // One-pole low-pass (~180 Hz) to emphasise the beat, plus full-band energy.
  const a = Math.exp((-2 * Math.PI * 180) / sampleRate);
  let lp = 0;
  for (let f = 0; f < n; f++) {
    let eLow = 0;
    let eAll = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const x = samples[i]!;
      lp = a * lp + (1 - a) * x;
      eLow += lp * lp;
      eAll += x * x;
    }
    energy[f] = Math.log1p(1000 * (eLow * 2 + eAll * 0.5) / hop);
  }
  const env = new Float32Array(n);
  for (let f = 1; f < n; f++) env[f] = Math.max(0, energy[f]! - energy[f - 1]!);
  // Remove the local mean so steady sound doesn't count as onsets.
  const w = 20;
  const out = new Float32Array(n);
  let acc = 0;
  for (let f = 0; f < n; f++) {
    acc += env[f]!;
    if (f >= w) acc -= env[f - w]!;
    out[f] = Math.max(0, env[f]! - acc / Math.min(f + 1, w));
  }
  return out;
}

/** Tempo + phase from an onset envelope. */
export function detectBeats(env: Float32Array, minBpm = 70, maxBpm = 180): BeatInfo {
  const minLag = Math.round(60 / maxBpm / HOP);
  const maxLag = Math.round(60 / minBpm / HOP);
  const n = env.length;
  let best = minLag;
  let bestScore = -Infinity;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i]!;
  mean /= Math.max(1, n);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += (env[i]! - mean) ** 2;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (env[i]! - mean) * (env[i + lag]! - mean);
    // Mild preference for tempos around 120 BPM (most pop music).
    const bpm = 60 / (lag * HOP);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    s *= 0.6 + 0.4 * prior;
    scores.push(s);
    if (s > bestScore) {
      bestScore = s;
      best = lag;
    }
  }
  // Parabolic refinement of the period.
  const i = best - minLag;
  let lagF = best;
  if (i > 0 && i < scores.length - 1) {
    const [a, b, c] = [scores[i - 1]!, scores[i]!, scores[i + 1]!];
    const d = a - 2 * b + c;
    if (d !== 0) lagF = best + (0.5 * (a - c)) / d;
  }
  const period = lagF * HOP;
  // Phase: the offset whose beat grid collects the most onset strength.
  let bestPhase = 0;
  let bestPhaseScore = -1;
  for (let ph = 0; ph < best; ph++) {
    let s = 0;
    for (let k = ph; k < n; k += lagF) s += env[Math.round(k)] ?? 0;
    if (s > bestPhaseScore) {
      bestPhaseScore = s;
      bestPhase = ph;
    }
  }
  const confidence = energy > 0 ? Math.max(0, Math.min(1, bestScore / energy)) : 0;
  return { period, bpm: 60 / period, offset: bestPhase * HOP, confidence };
}

/** Durations that make each photo change land on a beat (accounting for transitions). */
export function beatDurations(
  count: number,
  beat: BeatInfo,
  transitions: number[],
  targetSeconds = 2.2,
): number[] {
  const n = Math.max(1, Math.round(targetSeconds / beat.period));
  const step = n * beat.period;
  const durations: number[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const nextT = transitions[i + 1] ?? 0;
    // The visible change into clip i+1 (middle of its transition) lands on beat (i+1).
    const cut = beat.offset + (i + 1) * step;
    const d = cut + nextT / 2 - start;
    durations.push(Math.max(0.3, d));
    start = start + Math.max(0.3, d) - nextT;
  }
  return durations;
}
