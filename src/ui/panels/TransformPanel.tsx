import { FlipHorizontal2, FlipVertical2, Undo2 } from 'lucide-preact';
import { setTransform } from '../../model/ops';
import type { BlendMode, Clip, MediaClip } from '../../model/types';
import { commit, endGesture, updateClipById } from '../../state/actions';
import { project, selectedClip, settings } from '../../state/store';
import { Section, Segmented } from '../components/Controls';
import { Slider } from '../components/Slider';
import { NeedSelection } from './PanelHost';

const SPOTS: [number, number, string][] = [
  [0.18, 0.15, 'Top left'],
  [0.5, 0.15, 'Top'],
  [0.82, 0.15, 'Top right'],
  [0.18, 0.5, 'Left'],
  [0.5, 0.5, 'Center'],
  [0.82, 0.5, 'Right'],
  [0.18, 0.85, 'Bottom left'],
  [0.5, 0.85, 'Bottom'],
  [0.82, 0.85, 'Bottom right'],
];

const BLENDS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply (darken)' },
  { value: 'screen', label: 'Screen (lighten)' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'hard-light', label: 'Hard light' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color dodge' },
  { value: 'color-burn', label: 'Color burn' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'add', label: 'Add (glow)' },
];

export function TransformPanel() {
  const clip = selectedClip.value;
  const p = project.value!;
  if (!clip) return <NeedSelection what="Tap something on the picture or in the timeline first." />;
  const tr = clip.transform;
  const set = (patch: Partial<Clip['transform']>, label: string, coalesce?: string) =>
    commit(label, (q) => setTransform(q, clip.id, patch), coalesce ? { coalesce: `${coalesce}:${clip.id}` } : {});
  const fin = (f: boolean) => f && endGesture();
  return (
    <div class="panel">
      <Section title="Place it">
        <div class="spot-grid" role="group" aria-label="Quick positions">
          {SPOTS.map(([x, y, name]) => (
            <button
              key={name}
              class={`spot ${Math.abs(tr.x - x) < 0.01 && Math.abs(tr.y - y) < 0.01 ? 'on' : ''}`}
              aria-label={name}
              title={name}
              onClick={() => set({ x, y }, `Move to ${name.toLowerCase()}`)}
            >
              <span />
            </button>
          ))}
        </div>
        <p class="faint">Or drag it on the picture. Pinch with two fingers to resize and turn it.</p>
      </Section>
      <Section title="Size & angle">
        <Slider label="Size" value={Math.round(tr.scale * 100)} min={5} max={400} defaultValue={100} format={(v) => `${Math.round(v)}%`} onChange={(v, f) => { set({ scale: v / 100 }, 'Resize', 'scale'); fin(f); }} />
        <Slider label="Turn" value={Math.round(tr.rotation)} min={-180} max={180} defaultValue={0} format={(v) => `${Math.round(v)}°`} onChange={(v, f) => { set({ rotation: v }, 'Rotate', 'rot'); fin(f); }} />
        <div class="row wrap-gap">
          <button class={`btn small ${tr.flipX ? 'primary' : ''}`} onClick={() => set({ flipX: !tr.flipX }, 'Mirror')}>
            <FlipHorizontal2 size={16} /> Mirror
          </button>
          <button class={`btn small ${tr.flipY ? 'primary' : ''}`} onClick={() => set({ flipY: !tr.flipY }, 'Flip')}>
            <FlipVertical2 size={16} /> Upside down
          </button>
          <button class="btn small ghost" onClick={() => set({ x: 0.5, y: 0.5, scale: 1, rotation: 0, flipX: false, flipY: false }, 'Reset position')}>
            <Undo2 size={16} /> Reset
          </button>
        </div>
      </Section>
      {clip.type === 'media' && (
        <Section title="Fill the frame">
          <Segmented
            value={(clip as MediaClip).fit}
            onChange={(fit) => updateClipById(clip.id, fit === 'cover' ? 'Fill frame' : 'Fit whole picture', { fit } as Partial<MediaClip>)}
            options={[
              { value: 'contain', label: 'Show everything' },
              { value: 'cover', label: 'Fill (no borders)' },
            ]}
          />
        </Section>
      )}
      <Section title="See-through">
        <Slider label="Opacity" value={Math.round(clip.opacity * 100)} min={0} max={100} defaultValue={100} format={(v) => `${Math.round(v)}%`} hint="Lower it to let what’s behind show through" onChange={(v, f) => { updateClipById(clip.id, 'Opacity', { opacity: v / 100 }, 'opacity'); fin(f); }} />
        {(settings.value.pro || clip.blend !== 'normal' || p.kind === 'photo') && (
          <label class="field">
            <span class="field-label">Blend mode</span>
            <select class="select" value={clip.blend} onChange={(e) => updateClipById(clip.id, 'Blend mode', { blend: (e.target as HTMLSelectElement).value as BlendMode })}>
              {BLENDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </Section>
    </div>
  );
}
