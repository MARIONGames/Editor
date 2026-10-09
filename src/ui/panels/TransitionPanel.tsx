import { CopyCheck, Ban } from 'lucide-preact';
import { TRANSITIONS } from '../../model/catalog';
import { findClip, setTransition, setTransitionAll } from '../../model/ops';
import type { TransitionType } from '../../model/types';
import { commit, endGesture } from '../../state/actions';
import { emit } from '../../state/events';
import { project, selectedClip } from '../../state/store';
import { Slider } from '../components/Slider';
import { NeedSelection } from './PanelHost';

/** A tiny animated illustration of each transition (pure CSS). */
function TransitionIcon({ type }: { type: TransitionType }) {
  return (
    <span class={`tr-icon tr-${type}`} aria-hidden="true">
      <span class="a" />
      <span class="b" />
    </span>
  );
}

export function TransitionPanel() {
  const clip = selectedClip.value;
  const p = project.value!;
  const loc = clip ? findClip(p, clip.id) : null;
  if (!clip || !loc || loc.track.kind !== 'main' || loc.clipIndex === 0) {
    return <NeedSelection what="Tap the small square between two clips in the timeline to choose how one changes into the next." />;
  }
  const tr = clip.transition;
  const set = (type: TransitionType | null) => {
    const def = TRANSITIONS.find((t) => t.type === type);
    commit(type ? `Transition: ${def?.name}` : 'Remove transition', (q) =>
      setTransition(q, clip.id, type ? { type, duration: tr?.duration ?? def?.duration ?? 0.5 } : null),
    );
    if (type) emit('transition:set', { id: clip.id });
  };
  return (
    <div class="panel">
      <div class="transition-grid">
        <button class={`transition-tile ${!tr ? 'on' : ''}`} onClick={() => set(null)} aria-pressed={!tr}>
          <span class="tr-icon none" aria-hidden="true">
            <Ban size={22} />
          </span>
          <span>None (cut)</span>
        </button>
        {TRANSITIONS.map((t) => (
          <button key={t.type} class={`transition-tile ${tr?.type === t.type ? 'on' : ''}`} onClick={() => set(t.type)} title={t.hint} aria-pressed={tr?.type === t.type}>
            <TransitionIcon type={t.type} />
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      {tr && (
        <div class="section">
          <Slider
            label="Length"
            value={tr.duration}
            min={0.1}
            max={2}
            step={0.05}
            defaultValue={0.6}
            format={(v) => `${v.toFixed(1)}s`}
            onChange={(v, final) => {
              commit('Transition length', (q) => setTransition(q, clip.id, { ...tr, duration: v }), { coalesce: `trdur:${clip.id}` });
              if (final) endGesture();
            }}
          />
          <button class="btn small ghost" onClick={() => commit('Transition on all clips', (q) => setTransitionAll(q, { ...tr }))}>
            <CopyCheck size={16} /> Use between all clips
          </button>
        </div>
      )}
    </div>
  );
}
