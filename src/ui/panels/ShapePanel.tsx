import { useEffect, useRef } from 'preact/hooks';
import type { ShapeClip, ShapeKind } from '../../model/types';
import { shapePath } from '../../engine/render/rasterize';
import { endGesture, updateClipById } from '../../state/actions';
import { selectedClip } from '../../state/store';
import { ColorSwatches, Section } from '../components/Controls';
import { Slider } from '../components/Slider';
import { NeedSelection } from './PanelHost';

/** Small preview of a shape, drawn with the same path code as the renderer. */
export function ShapeIcon({ kind, color = 'currentColor' }: { kind: ShapeKind; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = 40 * dpr;
    c.height = 40 * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const w = kind === 'line' || kind === 'arrow' ? 34 : kind === 'rect' || kind === 'rounded' || kind === 'bubble' ? 32 : 28;
    const h = kind === 'line' ? 5 : kind === 'arrow' ? 16 : kind === 'rect' || kind === 'rounded' || kind === 'bubble' ? 24 : 28;
    ctx.translate((40 - w) / 2, (40 - h) / 2);
    ctx.fillStyle = color === 'currentColor' ? getComputedStyle(c).color : color;
    ctx.fill(shapePath(kind, w, h));
  }, [kind, color]);
  return <canvas ref={ref} class="shape-icon" style={{ width: '40px', height: '40px' }} aria-hidden="true" />;
}

const KINDS: ShapeKind[] = ['rect', 'rounded', 'ellipse', 'triangle', 'star', 'heart', 'arrow', 'line', 'bubble'];

export function ShapePanel() {
  const c = selectedClip.value;
  if (!c || c.type !== 'shape') return <NeedSelection what="Tap a shape first." />;
  const clip = c as ShapeClip;
  const set = (patch: Partial<ShapeClip>, label: string, coalesce?: string) => updateClipById(clip.id, label, patch, coalesce);
  return (
    <div class="panel">
      <Section title="Shape">
        <div class="chips">
          {KINDS.map((k) => (
            <button key={k} class={`chip icon-chip ${clip.shape === k ? 'on' : ''}`} onClick={() => set({ shape: k }, 'Change shape')} aria-label={k}>
              <ShapeIcon kind={k} />
            </button>
          ))}
        </div>
      </Section>
      <Section title="Fill">
        <ColorSwatches value={clip.fill} allowNone onChange={(fill) => set({ fill }, 'Shape color')} />
      </Section>
      <Section title="Outline">
        <ColorSwatches value={clip.strokeColor} onChange={(strokeColor) => set({ strokeColor, strokeWidth: clip.strokeWidth || 8 }, 'Outline color')} />
        <Slider label="Thickness" value={clip.strokeWidth} min={0} max={60} defaultValue={0} format={(v) => (v ? `${Math.round(v)}px` : 'None')} onChange={(v, f) => { set({ strokeWidth: v }, 'Outline', 'shape-stroke'); if (f) endGesture(); }} />
      </Section>
      <Section title="Proportions">
        <Slider label="Width" value={clip.width} min={10} max={3000} defaultValue={clip.width} onChange={(v, f) => { set({ width: Math.round(v) }, 'Shape width', 'shape-w'); if (f) endGesture(); }} />
        <Slider label="Height" value={clip.height} min={4} max={3000} defaultValue={clip.height} onChange={(v, f) => { set({ height: Math.round(v) }, 'Shape height', 'shape-h'); if (f) endGesture(); }} />
      </Section>
    </div>
  );
}
