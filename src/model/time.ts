/** Time formatting and snapping helpers. */

/** "0:05.3", "1:02.0", "1:02:03" */
export function formatTime(t: number, withTenths = true): string {
  const safe = Math.max(0, t);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const sec = withTenths ? (Math.floor(s * 10) / 10).toFixed(1) : String(Math.floor(s));
  const secPadded = withTenths ? sec.padStart(4, '0') : sec.padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${secPadded}` : `${m}:${secPadded}`;
}

/** Friendly length: "3.4s", "1m 05s", "1h 02m". */
export function formatDuration(t: number): string {
  const safe = Math.max(0, t);
  if (safe < 60) return `${safe < 10 ? (Math.round(safe * 10) / 10).toFixed(1) : Math.round(safe)}s`;
  const m = Math.floor(safe / 60);
  if (m < 60) return `${m}m ${String(Math.round(safe % 60)).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

export interface SnapResult {
  value: number;
  snapped: boolean;
  target: number | null;
}

/** Snap `t` to the nearest candidate within `threshold` seconds. */
export function snapTime(t: number, candidates: Iterable<number>, threshold: number): SnapResult {
  let best: number | null = null;
  let bestD = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best === null ? { value: t, snapped: false, target: null } : { value: best, snapped: true, target: best };
}

/** Nice ruler tick spacing (seconds) for a zoom level in px per second. */
export function rulerStep(pxPerSecond: number): { major: number; minor: number } {
  const steps = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const minPx = 70;
  for (const s of steps) {
    if (s * pxPerSecond >= minPx) return { major: s, minor: s / (s >= 1 && s % 5 === 0 ? 5 : 2) };
  }
  return { major: 1200, minor: 300 };
}
