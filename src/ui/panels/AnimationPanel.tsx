import { ANIM_IN, ANIM_LOOP, ANIM_OUT, MOTIONS } from '../../model/catalog';
import { findClip } from '../../model/ops';
import type { Animation, MediaClip } from '../../model/types';
import { endGesture, updateClipById } from '../../state/actions';
import { preview } from '../../engine/preview';
import { project, selectedClip } from '../../state/store';
import { Section } from '../components/Controls';
import { Slider } from '../components/Slider';
import { NeedSelection } from './PanelHost';

let previewTimer: ReturnType<typeof setTimeout> | null = null;

/** Plays a short stretch of the timeline so a chosen animation can be seen. */
function playPreview(start: number, duration: number, exit: boolean): void {
  if (previewTimer) clearTimeout(previewTimer);
  const len = Math.min(duration, 2);
  preview.seek(exit ? Math.max(start, start + duration - len) : start);
  preview.play();
  previewTimer = setTimeout(() => {
    preview.pause();
    preview.seek(exit ? start + duration - Math.min(0.5, duration / 2) : start + Math.min(len, duration) * 0.75);
  }, len * 1000);
}

export function AnimationPanel() {
  const clip = selectedClip.value;
  const p = project.value!;
  if (!clip) return <NeedSelection what="Tap a clip, text or sticker first, then choose how it moves." />;
  const a = clip.animation;
  const loc = findClip(p, clip.id);
  const isPhoto = clip.type === 'media' && p.assets[clip.assetId]?.kind === 'image';
  const set = (patch: Partial<Animation>, label: string, coalesce?: string) => {
    updateClipById(clip.id, label, (c) => ({ animation: { ...c.animation, ...patch } }), coalesce);
    // Show the result right away: play the clip's entrance (or exit) once.
    if (!coalesce && p.kind === 'video') playPreview(clip.start, clip.duration, patch.out !== undefined);
  };
  const maxDur = Math.max(0.2, Math.min(3, clip.duration / 2));
  return (
    <div class="panel">
      {isPhoto && loc?.track.kind === 'main' && (
        <Section title="Photo motion">
          <p class="faint">A slow zoom or glide makes still photos feel alive.</p>
          <div class="chips">
            {MOTIONS.map((m) => (
              <button
                key={m.type}
                class={`chip ${(clip as MediaClip).motion === m.type ? 'on' : ''}`}
                title={m.hint}
                onClick={() => {
                  updateClipById(clip.id, `Motion: ${m.name}`, { motion: m.type } as Partial<MediaClip>);
                  preview.seek(clip.start);
                }}
              >
                {m.name}
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section title="Coming in">
        <div class="chips">
          {ANIM_IN.filter((x) => x.type !== 'typewriter' || clip.type === 'text').map((x) => (
            <button key={x.type} class={`chip ${a.in === x.type ? 'on' : ''}`} onClick={() => set({ in: x.type }, `Entrance: ${x.name}`)}>
              {x.name}
            </button>
          ))}
        </div>
        {a.in !== 'none' && (
          <Slider label="Length" value={a.inDuration} min={0.1} max={maxDur} step={0.05} defaultValue={0.5} format={(v) => `${v.toFixed(1)}s`} onChange={(v, f) => { set({ inDuration: v }, 'Entrance length', 'anim-in'); if (f) endGesture(); }} />
        )}
      </Section>
      <Section title="Going out">
        <div class="chips">
          {ANIM_OUT.map((x) => (
            <button key={x.type} class={`chip ${a.out === x.type ? 'on' : ''}`} onClick={() => set({ out: x.type }, `Exit: ${x.name}`)}>
              {x.name}
            </button>
          ))}
        </div>
        {a.out !== 'none' && (
          <Slider label="Length" value={a.outDuration} min={0.1} max={maxDur} step={0.05} defaultValue={0.5} format={(v) => `${v.toFixed(1)}s`} onChange={(v, f) => { set({ outDuration: v }, 'Exit length', 'anim-out'); if (f) endGesture(); }} />
        )}
      </Section>
      {clip.type !== 'media' || loc?.track.kind !== 'main' ? (
        <Section title="While on screen">
          <div class="chips">
            {ANIM_LOOP.map((x) => (
              <button key={x.type} class={`chip ${a.loop === x.type ? 'on' : ''}`} onClick={() => set({ loop: x.type }, `Loop: ${x.name}`)}>
                {x.name}
              </button>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
