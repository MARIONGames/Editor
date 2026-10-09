import { Monitor, RectangleHorizontal, RectangleVertical, Smartphone, Square, Film, Tv, Wand2 } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { CANVAS_PRESETS } from '../../model/defaults';
import { mainTrack, setBackground, setCanvas } from '../../model/ops';
import { canvasForMedia, commit } from '../../state/actions';
import { emit } from '../../state/events';
import { project } from '../../state/store';
import { ColorSwatches, Section, Switch } from '../components/Controls';

const ICONS: Record<string, LucideIcon> = {
  '16:9': Monitor,
  '9:16': Smartphone,
  '1:1': Square,
  '4:5': RectangleVertical,
  '4:3': Tv,
  '21:9': Film,
};

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function CanvasPanel() {
  const p = project.value!;
  const g = gcd(p.width, p.height);
  const ratio = `${p.width / g}:${p.height / g}`;
  const resize = (w: number, h: number, label: string) => {
    commit(label, (q) => setCanvas(q, w, h));
    emit('canvas:changed', { width: w, height: h });
  };
  const firstVisual = p.kind === 'video' ? mainTrack(p)?.clips.find((c) => c.type === 'media') : undefined;
  const firstAsset = firstVisual && firstVisual.type === 'media' ? p.assets[firstVisual.assetId] : undefined;
  return (
    <div class="panel">
      <Section title={`Shape · now ${p.width} × ${p.height}${ratio.length < 8 ? ` (${ratio})` : ''}`}>
        <div class="aspect-grid">
          {firstAsset && (
            <button
              class="aspect-tile"
              onClick={() => {
                const s = canvasForMedia(firstAsset.width, firstAsset.height);
                resize(s.width, s.height, 'Match first clip');
              }}
            >
              <span class="aspect-icon">
                <Wand2 size={22} />
              </span>
              <strong>Match my video</strong>
              <span>No black bars</span>
            </button>
          )}
          {CANVAS_PRESETS.map((c) => {
            const Icon = ICONS[c.id] ?? RectangleHorizontal;
            const on = p.width * c.height === p.height * c.width;
            return (
              <button
                key={c.id}
                class={`aspect-tile ${on ? 'on' : ''}`}
                onClick={() => {
                  if (p.kind === 'photo') {
                    // Keep the photo's resolution: grow the canvas to the new shape around it.
                    const target = c.width / c.height;
                    const cur = p.width / p.height;
                    const w = target > cur ? Math.round(p.height * target) : p.width;
                    const h = target > cur ? p.height : Math.round(p.width / target);
                    resize(w, h, `Shape ${c.id}`);
                  } else resize(c.width, c.height, `Shape ${c.id}`);
                }}
              >
                <span class="aspect-icon">
                  <Icon size={22} />
                </span>
                <strong>{c.label}</strong>
                <span>{c.hint}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Background">
        <p class="faint">Shows wherever your picture doesn’t cover the frame.</p>
        {p.kind === 'video' && (
          <Switch
            label="Blurred background"
            hint="Fills empty space with a soft, blurred copy of your clip (no black bars)"
            checked={p.background.blur}
            onChange={(blur) => commit(blur ? 'Blurred background' : 'Plain background', (q) => setBackground(q, { blur }))}
          />
        )}
        <ColorSwatches
          value={p.background.color}
          allowNone={p.kind === 'photo'}
          onChange={(color) => commit('Background color', (q) => setBackground(q, { color }))}
        />
        {p.kind === 'photo' && p.background.color === 'transparent' && (
          <p class="faint">Transparent: export as PNG to keep the see-through background.</p>
        )}
      </Section>
    </div>
  );
}
