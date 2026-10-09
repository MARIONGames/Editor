import { useEffect, useRef } from 'preact/hooks';
import { CopyCheck } from 'lucide-preact';
import { FILTERS } from '../../model/filters';
import { mainTrack, setFilter } from '../../model/ops';
import type { Clip, Effects, Project } from '../../model/types';
import { Renderer } from '../../engine/render/renderer';
import { preview } from '../../engine/preview';
import { commit, endGesture } from '../../state/actions';
import { emit } from '../../state/events';
import { playhead, project } from '../../state/store';
import { Slider } from '../components/Slider';
import { useMediaSelection } from './AdjustPanel';
import { NeedSelection } from './PanelHost';

/** One small shared renderer draws all the filter previews. */
let thumbRenderer: Renderer | null = null;
function getThumbRenderer(): Renderer | null {
  if (thumbRenderer) return thumbRenderer;
  try {
    const c = document.createElement('canvas');
    thumbRenderer = new Renderer(c);
  } catch {
    thumbRenderer = null;
  }
  return thumbRenderer;
}

function renderPreviews(p: Project, clip: Clip, canvases: Map<string, HTMLCanvasElement>, cancelled: () => boolean): void {
  const r = getThumbRenderer();
  if (!r) return;
  const tw = 160;
  const th = Math.max(1, Math.round((tw * p.height) / p.width));
  r.setSize(tw, th);
  const t = p.kind === 'photo' ? 0 : Math.min(Math.max(playhead.peek(), clip.start), clip.start + clip.duration - 0.01);
  const ids = ['none', ...FILTERS.map((f) => f.id)];
  let i = 0;
  const step = () => {
    if (cancelled()) return;
    const end = Math.min(ids.length, i + 4);
    for (; i < end; i++) {
      const id = ids[i]!;
      const effects: Effects = { ...clip.effects, filter: id === 'none' ? null : { id, intensity: 1 } };
      try {
        r.render(p, t, preview.provider, { overrideEffects: { clipId: clip.id, effects } });
      } catch {
        return;
      }
      const c = canvases.get(id);
      if (c) {
        c.width = tw;
        c.height = th;
        c.getContext('2d')!.drawImage(r.canvas as HTMLCanvasElement, 0, 0);
      }
    }
    if (i < ids.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function FiltersPanel() {
  const clip = useMediaSelection();
  const p = project.value;
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  // Re-draw previews when the clip's other settings change (not when only the filter changes).
  const sig = clip ? JSON.stringify({ a: clip.effects.adjust, c: clip.crop, id: clip.id, k: clip.effects.chromaKey }) : '';
  useEffect(() => {
    if (!clip || !p) return;
    let stop = false;
    renderPreviews(p, clip, canvases.current, () => stop);
    return () => {
      stop = true;
    };
  }, [sig]);
  if (!clip || !p) return <NeedSelection what="Tap a photo or video first, then pick a look for it here." />;
  const current = clip.effects.filter;
  const choose = (id: string | null) => {
    commit(id ? 'Apply filter' : 'Remove filter', (q) => setFilter(q, clip.id, id ? { id, intensity: current?.id === id ? current.intensity : 0.8 } : null));
    if (id) emit('filter:set', { id });
  };
  const mainCount = mainTrack(p)?.clips.length ?? 0;
  return (
    <div class="panel">
      <div class="filter-grid">
        {[{ id: 'none', name: 'Original' }, ...FILTERS].map((f) => {
          const on = (f.id === 'none' && !current) || current?.id === f.id;
          return (
            <button key={f.id} class={`filter-tile ${on ? 'on' : ''}`} onClick={() => choose(f.id === 'none' ? null : f.id)} aria-pressed={on}>
              <canvas
                ref={(el) => {
                  if (el) canvases.current.set(f.id, el);
                }}
              />
              <span>{f.name}</span>
            </button>
          );
        })}
      </div>
      {current && (
        <div class="section">
          <Slider
            label="Strength"
            value={Math.round(current.intensity * 100)}
            min={0}
            max={100}
            defaultValue={80}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v, final) => {
              commit('Filter strength', (q) => setFilter(q, clip.id, { id: current.id, intensity: v / 100 }), { coalesce: `filter:${clip.id}` });
              if (final) endGesture();
            }}
          />
          {p.kind === 'video' && mainCount > 1 && (
            <button
              class="btn small ghost"
              onClick={() =>
                commit('Filter on all clips', (q) => {
                  const m = mainTrack(q)!;
                  const clips = m.clips.map((c) => (c.type === 'media' ? ({ ...c, effects: { ...c.effects, filter: { ...current } } } as Clip) : c));
                  return { ...q, tracks: q.tracks.map((t) => (t.id === m.id ? { ...t, clips } : t)) };
                })
              }
            >
              <CopyCheck size={16} /> Use this filter on all clips
            </button>
          )}
        </div>
      )}
    </div>
  );
}
