import { useEffect, useRef } from 'preact/hooks';
import type { MediaClip } from '../../model/types';
import { derived } from './thumbs';

/**
 * Draws the visible part of a clip's waveform (only what is on screen, so long
 * clips at high zoom stay fast).
 */
export function Waveform(props: {
  clip: MediaClip;
  zoom: number;
  /** Visible timeline range (seconds). */
  view: [number, number];
  height: number;
  color: string;
  version: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { clip, zoom, view, height } = props;
  const visStart = Math.max(clip.start, view[0]);
  const visEnd = Math.min(clip.start + clip.duration, view[1]);
  const left = (visStart - clip.start) * zoom;
  const width = Math.max(0, Math.ceil((visEnd - visStart) * zoom));

  useEffect(() => {
    const c = ref.current;
    if (!c || width <= 0) return;
    const d = derived(clip.assetId);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(width * dpr));
    c.height = Math.max(1, Math.round(height * dpr));
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const peaks = d?.peaks;
    if (!peaks || !peaks.length) return;
    ctx.fillStyle = props.color;
    const mid = c.height / 2;
    const gain = Math.min(2, clip.volume);
    for (let x = 0; x < c.width; x++) {
      const t0 = visStart + x / dpr / zoom;
      const t1 = visStart + (x + 1) / dpr / zoom;
      // timeline time → source time (bins are 10 ms)
      const s0 = Math.floor((clip.in + (t0 - clip.start) * clip.speed) * 100);
      const s1 = Math.max(s0 + 1, Math.floor((clip.in + (t1 - clip.start) * clip.speed) * 100));
      let m = 0;
      for (let i = s0; i < s1 && i < peaks.length; i++) if (i >= 0 && peaks[i]! > m) m = peaks[i]!;
      const h = Math.max(1, Math.min(1, m * gain) * (c.height - 2));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [clip, zoom, visStart, visEnd, width, height, props.version, props.color]);

  if (width <= 0) return null;
  return <canvas ref={ref} class="waveform" style={{ left: `${left}px`, width: `${width}px`, height: `${height}px` }} />;
}
