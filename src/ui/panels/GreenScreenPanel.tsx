import { Pipette } from 'lucide-preact';
import { setEffects } from '../../model/ops';
import type { ChromaKey } from '../../model/types';
import { commit, endGesture } from '../../state/actions';
import { selectedClip } from '../../state/store';
import { ColorSwatches, Section, Switch } from '../components/Controls';
import { Slider } from '../components/Slider';
import { useMediaSelection } from './AdjustPanel';
import { NeedSelection } from './PanelHost';

const DEFAULT_KEY: ChromaKey = { color: '#00b140', similarity: 0.4, smoothness: 0.2, spill: 0.5 };

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function GreenScreenPanel() {
  const clip = useMediaSelection();
  void selectedClip.value;
  if (!clip) return <NeedSelection what="Tap the photo or video that has the green (or blue) background." />;
  const key = clip.effects.chromaKey;
  const set = (k: ChromaKey | null, label: string, coalesce?: string) =>
    commit(label, (q) => setEffects(q, clip.id, { chromaKey: k }), coalesce ? { coalesce: `${coalesce}:${clip.id}` } : {});
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return (
    <div class="panel">
      <Switch
        label="Remove background color"
        hint="Best with an evenly lit green or blue background."
        checked={!!key}
        onChange={(on) => set(on ? { ...DEFAULT_KEY } : null, on ? 'Green screen on' : 'Green screen off')}
      />
      {key && (
        <>
          <Section title="Color to remove">
            <ColorSwatches
              value={key.color}
              colors={['#00b140', '#00ff00', '#0047bb', '#0000ff', '#ffffff', '#000000']}
              onChange={(color) => set({ ...key, color }, 'Key color')}
            />
            {EyeDropper && (
              <button
                class="btn small"
                onClick={async () => {
                  try {
                    const r = await new EyeDropper().open();
                    set({ ...key, color: r.sRGBHex }, 'Pick key color');
                  } catch {
                    /* cancelled */
                  }
                }}
              >
                <Pipette size={16} /> Pick from the picture
              </button>
            )}
          </Section>
          <Section title="Fine tune">
            <Slider label="Strength" value={Math.round(key.similarity * 100)} min={0} max={100} defaultValue={40} hint="Raise it until the background disappears" onChange={(v, f) => { set({ ...key, similarity: v / 100 }, 'Key strength', 'ck-sim'); if (f) endGesture(); }} />
            <Slider label="Soft edges" value={Math.round(key.smoothness * 100)} min={0} max={100} defaultValue={20} hint="Smooths hair and edges" onChange={(v, f) => { set({ ...key, smoothness: v / 100 }, 'Key softness', 'ck-soft'); if (f) endGesture(); }} />
            <Slider label="Remove color glow" value={Math.round(key.spill * 100)} min={0} max={100} defaultValue={50} hint="Removes green tint reflected on the person" onChange={(v, f) => { set({ ...key, spill: v / 100 }, 'Key spill', 'ck-spill'); if (f) endGesture(); }} />
          </Section>
        </>
      )}
    </div>
  );
}
