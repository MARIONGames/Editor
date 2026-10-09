import { describe, expect, it } from 'vitest';
import { autoAdjust, imageStats } from '../../src/magic/enhance';
import { findKeepRanges, totalLength } from '../../src/magic/silence';
import { beatDurations, detectBeats, onsetEnvelope } from '../../src/magic/beats';

describe('remove silent parts', () => {
  it('keeps speech and drops long pauses', () => {
    // 10 s at 100 bins/s: speech 0-2 s, silence 2-5 s, speech 5-7 s, short pause 7-7.3 s, speech 7.3-10 s
    const rms = new Float32Array(1000).fill(0.001);
    const speak = (a: number, b: number) => rms.fill(0.2, a * 100, b * 100);
    speak(0, 2);
    speak(5, 7);
    speak(7.3, 10);
    const keep = findKeepRanges(rms, 100, 0, 10);
    expect(keep).toHaveLength(2);
    expect(keep[0]!.in).toBe(0);
    expect(keep[0]!.out).toBeCloseTo(2.12, 2);
    expect(keep[1]!.in).toBeCloseTo(4.88, 2);
    expect(keep[1]!.out).toBe(10);
    expect(totalLength(keep)).toBeCloseTo(7.24, 2);
  });

  it('respects the clip range', () => {
    const rms = new Float32Array(1000).fill(0.2);
    rms.fill(0.0005, 300, 600);
    const keep = findKeepRanges(rms, 100, 2, 8);
    expect(keep[0]!.in).toBe(2);
    expect(keep.at(-1)!.out).toBe(8);
    expect(totalLength(keep)).toBeLessThan(6);
  });

  it('keeps everything when there is no pause', () => {
    const rms = new Float32Array(500).fill(0.3);
    expect(findKeepRanges(rms, 100, 0, 5)).toEqual([{ in: 0, out: 5 }]);
  });
});

describe('beat detection', () => {
  it('finds the tempo of a click track', () => {
    const sr = 8000;
    const bpm = 120;
    const seconds = 12;
    const samples = new Float32Array(sr * seconds);
    const period = 60 / bpm;
    for (let b = 0.25; b < seconds; b += period) {
      const i0 = Math.round(b * sr);
      for (let i = 0; i < 400; i++) samples[i0 + i] = Math.sin(i * 0.08) * Math.exp(-i / 120);
    }
    const env = onsetEnvelope(samples, sr);
    const beat = detectBeats(env);
    expect(Math.abs(beat.bpm - bpm)).toBeLessThan(3);
    // phase lands on (a multiple of) the clicks
    const phaseErr = Math.abs(((beat.offset - 0.25) / period) - Math.round((beat.offset - 0.25) / period));
    expect(phaseErr).toBeLessThan(0.1);
  });

  it('makes photo changes land on beats', () => {
    const durations = beatDurations(3, { period: 0.5, bpm: 120, offset: 0.1, confidence: 1 }, [0, 0.4, 0.4], 2);
    // cuts at 0.1 + k*2.0 → clip 1 starts at cut1 - T/2
    let start = 0;
    const T = [0, 0.4, 0.4];
    const cuts: number[] = [];
    durations.forEach((d, i) => {
      const next = T[i + 1] ?? 0;
      const nextStart = start + d - next;
      if (i < 2) cuts.push(nextStart + next / 2);
      start = nextStart;
    });
    expect(cuts[0]).toBeCloseTo(2.1, 5);
    expect(cuts[1]).toBeCloseTo(4.1, 5);
  });
});

describe('auto-enhance', () => {
  const img = (fn: (i: number) => [number, number, number]) => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) {
      const [r, g, b] = fn(i);
      data.set([r, g, b, 255], i * 4);
    }
    return data;
  };

  it('brightens a dark picture', () => {
    const s = imageStats(img((i) => [20 + (i % 40), 18 + (i % 40), 15 + (i % 40)]));
    const a = autoAdjust(s);
    expect(a.exposure).toBeGreaterThan(20);
  });

  it('warms up a blue picture and cools a yellow one', () => {
    const blue = autoAdjust(imageStats(img((i) => [90 + (i % 60), 110 + (i % 60), 160 + (i % 60)])));
    expect(blue.temperature).toBeGreaterThan(0);
    const yellow = autoAdjust(imageStats(img((i) => [170 + (i % 60), 140 + (i % 60), 80 + (i % 60)])));
    expect(yellow.temperature).toBeLessThan(0);
  });

  it('adds contrast to a flat picture', () => {
    const a = autoAdjust(imageStats(img((i) => [110 + (i % 30), 110 + (i % 30), 110 + (i % 30)])));
    expect(a.contrast).toBeGreaterThan(10);
  });
});
