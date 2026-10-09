import { describe, expect, it } from 'vitest';
import { animState } from '../../src/model/animation';
import { createProject, defaultAnimation, NEUTRAL_ADJUST } from '../../src/model/defaults';
import { FILTERS, isNeutral, resolveLook } from '../../src/model/filters';
import { clipQuad, mediaBaseSize, quadContains } from '../../src/model/geometry';
import { migrateProject } from '../../src/model/migrate';
import { formatDuration, formatTime, rulerStep, snapTime } from '../../src/model/time';
import { History } from '../../src/state/history';
import { timeStretch } from '../../src/engine/audio/stretch';
import { mainClips, projectWith, videoAsset } from './helpers';

describe('history', () => {
  it('undoes and redoes with labels, and coalesces slider drags', () => {
    const h = new History();
    const p0 = createProject({ kind: 'video', width: 100, height: 100 });
    const p1 = { ...p0, name: 'a' };
    const p2 = { ...p0, name: 'b' };
    h.record(p0, null, 'Rename');
    h.record(p1, null, 'Brightness', 'adjust:exposure');
    h.record(p2, null, 'Brightness', 'adjust:exposure'); // same gesture → merged
    expect(h.past).toHaveLength(2);
    const u = h.undo({ project: p2, selection: null, label: '' })!;
    expect(u.project).toBe(p1);
    expect(h.redoLabel).toBe('Brightness');
    const r = h.redo({ project: p1, selection: null, label: '' })!;
    expect(r.project).toBe(p2);
  });
});

describe('animations', () => {
  it('fades in and out within the clip', () => {
    const anim = { ...defaultAnimation(), in: 'fade' as const, out: 'fade' as const, inDuration: 1, outDuration: 1 };
    expect(animState(anim, 0, 5).opacity).toBe(0);
    expect(animState(anim, 2.5, 5).opacity).toBe(1);
    expect(animState(anim, 5, 5).opacity).toBeCloseTo(0, 5);
  });

  it('squeezes animations that are longer than the clip', () => {
    const anim = { ...defaultAnimation(), in: 'fade' as const, out: 'fade' as const, inDuration: 2, outDuration: 2 };
    // 1 s clip: in and out get 0.5 s each, so the middle is fully visible
    expect(animState(anim, 0.5, 1).opacity).toBeCloseTo(1, 5);
  });

  it('reveals text gradually with the typewriter', () => {
    const anim = { ...defaultAnimation(), in: 'typewriter' as const, inDuration: 1 };
    expect(animState(anim, 0.5, 3).reveal).toBeCloseTo(0.5, 5);
    expect(animState(anim, 2, 3).reveal).toBe(1);
  });
});

describe('geometry', () => {
  it('fits media inside the canvas and respects quarter turns', () => {
    const p = projectWith(videoAsset(5, { width: 1080, height: 1920 }));
    const c = mainClips(p)[0]!;
    if (c.type !== 'media') throw new Error();
    const a = p.assets[c.assetId]!;
    const fit = mediaBaseSize(c, a, 1920, 1080);
    expect(fit.h).toBeCloseTo(1080);
    expect(fit.w).toBeCloseTo(607.5);
    // A quarter-turned portrait clip fills a landscape canvas (size is in source orientation).
    const turned = mediaBaseSize({ ...c, turns: 1 }, a, 1920, 1080);
    expect(turned.w).toBeCloseTo(1080);
    expect(turned.h).toBeCloseTo(1920);
    const q = clipQuad(p, c, fit, 1);
    expect(quadContains(q, { x: 960, y: 540 })).toBe(true);
    expect(quadContains(q, { x: 100, y: 540 })).toBe(false);
  });
});

describe('time', () => {
  it('formats times and durations for people', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(65.43)).toBe('1:05.4');
    expect(formatTime(3725)).toBe('1:02:05.0');
    expect(formatDuration(3.42)).toBe('3.4s');
    expect(formatDuration(75)).toBe('1m 15s');
  });

  it('snaps to nearby edges', () => {
    expect(snapTime(2.03, [0, 2, 5], 0.05)).toMatchObject({ value: 2, snapped: true });
    expect(snapTime(2.3, [0, 2, 5], 0.05).snapped).toBe(false);
    expect(rulerStep(100).major).toBe(1);
  });
});

describe('filters', () => {
  it('every filter has a unique id and changes something', () => {
    const ids = new Set(FILTERS.map((f) => f.id));
    expect(ids.size).toBe(FILTERS.length);
    for (const f of FILTERS) {
      const effects = { adjust: { ...NEUTRAL_ADJUST }, filter: { id: f.id, intensity: 1 }, chromaKey: null };
      expect(isNeutral(effects)).toBe(false);
    }
  });

  it('scales a look with its strength and adds it to manual adjustments', () => {
    const effects = { adjust: { ...NEUTRAL_ADJUST, contrast: 10 }, filter: { id: 'vivid', intensity: 0.5 }, chromaKey: null };
    const look = resolveLook(effects);
    expect(look.adjust.contrast).toBeCloseTo(10 + 12 * 0.5);
    expect(resolveLook({ ...effects, filter: { id: 'bw', intensity: 1 } }).mono.amount).toBe(1);
  });
});

describe('migrate', () => {
  it('fills missing fields from older projects and rejects garbage', () => {
    const p = projectWith(videoAsset(5));
    const raw = JSON.parse(JSON.stringify(p));
    delete raw.tracks[0].clips[0].turns;
    delete raw.tracks[0].clips[0].effects.adjust.vignette;
    const m = migrateProject(raw);
    const c = m.tracks[0]!.clips[0]!;
    expect(c.type === 'media' && c.turns).toBe(0);
    expect(c.effects.adjust.vignette).toBe(0);
    expect(() => migrateProject({ hello: 1 })).toThrow();
    expect(() => migrateProject({ ...raw, schema: 999 })).toThrow(/newer version/);
  });
});

describe('time-stretch', () => {
  it('changes length but keeps pitch (zero crossings per second stay the same)', () => {
    const sr = 8000;
    const n = sr * 2;
    const tone = new Float32Array(n);
    for (let i = 0; i < n; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
    const [fast] = timeStretch([tone], 2, sr);
    expect(fast!.length).toBe(n / 2);
    const crossings = (a: Float32Array) => {
      let c = 0;
      for (let i = 1000; i < a.length - 1000; i++) if (a[i - 1]! < 0 && a[i]! >= 0) c++;
      return c / ((a.length - 2000) / sr);
    };
    expect(Math.abs(crossings(fast!) - 440)).toBeLessThan(15);
  });
});
