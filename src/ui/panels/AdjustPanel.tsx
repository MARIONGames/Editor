import { useState } from 'preact/hooks';
import { RotateCcw, Sparkles, CopyCheck } from 'lucide-preact';
import { ADJUST_KEYS } from '../../model/defaults';
import { mainTrack, resetAdjust, setAdjust } from '../../model/ops';
import type { AdjustKey, Clip, MediaClip } from '../../model/types';
import { ADJUST_GROUPS, ADJUST_TEXT } from '../../i18n/tools';
import { commit, endGesture } from '../../state/actions';
import { emit } from '../../state/events';
import { project, selectedClip, settings } from '../../state/store';
import { autoEnhance } from '../../magic/actions';
import { Slider } from '../components/Slider';
import { NeedSelection } from './PanelHost';

const POSITIVE_ONLY = new Set<AdjustKey>(['sharpen', 'blur', 'grain', 'fade']);
const BASIC = new Set<AdjustKey>(['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'saturation', 'vibrance', 'sharpen', 'vignette']);

export function useMediaSelection(): MediaClip | null {
  const c = selectedClip.value;
  const p = project.value;
  if (!p) return null;
  if (!c) {
    // Photo projects: with nothing selected, tools apply to the photo itself.
    if (p.kind !== 'photo') return null;
    const base = p.tracks[0]?.clips[0];
    return base?.type === 'media' ? base : null;
  }
  if (c.type !== 'media') return null;
  if (p.assets[c.assetId]?.kind === 'audio') return null;
  return c;
}

export function AdjustPanel() {
  const clip = useMediaSelection();
  const [all, setAll] = useState(settings.value.pro);
  if (!clip) return <NeedSelection what="Tap a photo or video first, then adjust its light and color here." />;
  const adj = clip.effects.adjust;
  const changed = ADJUST_KEYS.some((k) => adj[k] !== 0);
  const p = project.value!;
  const mainCount = mainTrack(p)?.clips.length ?? 0;
  const set = (key: AdjustKey, v: number, final: boolean) => {
    commit(`Adjust ${ADJUST_TEXT[key]!.label.toLowerCase()}`, (q) => setAdjust(q, clip.id, key, v), {
      coalesce: `adjust:${key}:${clip.id}`,
    });
    if (final) {
      endGesture();
      emit('adjust:changed', { key });
    }
  };
  return (
    <div class="panel adjust-panel">
      <div class="row wrap-gap">
        <button class="btn magic grow" onClick={() => void autoEnhance(false)} data-coach="auto-enhance">
          <Sparkles size={18} /> Auto-enhance
        </button>
        <button class="btn small ghost" disabled={!changed} onClick={() => commit('Reset adjustments', (q) => resetAdjust(q, clip.id))}>
          <RotateCcw size={16} /> Reset
        </button>
      </div>
      {ADJUST_GROUPS.map((g) => {
        const keys = ADJUST_KEYS.filter((k) => ADJUST_TEXT[k]!.group === g.id && (all || BASIC.has(k) || adj[k] !== 0));
        if (!keys.length) return null;
        return (
          <div class="section" key={g.id}>
            <div class="section-title">{g.label}</div>
            {keys.map((k) => (
              <Slider
                key={k}
                label={ADJUST_TEXT[k]!.label}
                hint={settings.value.hints ? ADJUST_TEXT[k]!.hint : undefined}
                value={adj[k]}
                min={POSITIVE_ONLY.has(k) ? 0 : -100}
                max={100}
                defaultValue={0}
                format={(v) => (v > 0 && !POSITIVE_ONLY.has(k) ? `+${Math.round(v)}` : String(Math.round(v)))}
                onChange={(v, final) => set(k, v, final)}
              />
            ))}
          </div>
        );
      })}
      <div class="section">
        <button class="btn small ghost" onClick={() => setAll(!all)}>
          {all ? 'Show fewer sliders' : 'Show all sliders'}
        </button>
        {p.kind === 'video' && mainCount > 1 && (
          <button
            class="btn small ghost"
            onClick={() =>
              commit('Apply look to all clips', (q) => {
                const m = mainTrack(q)!;
                const clips = m.clips.map((c) =>
                  c.id === clip.id || c.type !== 'media' ? c : ({ ...c, effects: { ...c.effects, adjust: { ...adj } } } as Clip),
                );
                return { ...q, tracks: q.tracks.map((t) => (t.id === m.id ? { ...t, clips } : t)) };
              })
            }
          >
            <CopyCheck size={16} /> Use these settings on all clips
          </button>
        )}
      </div>
    </div>
  );
}
