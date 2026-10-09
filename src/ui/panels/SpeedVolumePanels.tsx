import { VolumeX, Volume2 } from 'lucide-preact';
import { SPEED_PRESETS } from '../../model/catalog';
import { setSpeed } from '../../model/ops';
import { formatDuration } from '../../model/time';
import type { MediaClip } from '../../model/types';
import { commit, endGesture, updateClipById } from '../../state/actions';
import { project, selectedClip } from '../../state/store';
import { Section, Switch } from '../components/Controls';
import { Slider } from '../components/Slider';
import { NeedSelection } from './PanelHost';

function useMedia(): MediaClip | null {
  const c = selectedClip.value;
  return c?.type === 'media' ? c : null;
}

export function SpeedPanel() {
  const clip = useMedia();
  const p = project.value!;
  if (!clip) return <NeedSelection what="Tap a video or sound clip first." />;
  const asset = p.assets[clip.assetId];
  if (asset?.kind === 'image') return <NeedSelection what="Photos don't have a speed — drag their edges in the timeline to show them longer or shorter." />;
  const apply = (s: number, final: boolean) => {
    commit(`Speed ${s}×`, (q) => setSpeed(q, clip.id, s), { coalesce: `speed:${clip.id}` });
    if (final) endGesture();
  };
  // Logarithmic slider: −100..100 ↔ 0.25×..4×
  const toSlider = (s: number) => Math.round((Math.log2(s) / 2) * 100);
  const fromSlider = (v: number) => Math.round(Math.pow(2, (v / 100) * 2) * 100) / 100;
  return (
    <div class="panel">
      <div class="chips">
        {SPEED_PRESETS.map((s) => (
          <button key={s} class={`chip ${Math.abs(clip.speed - s) < 0.001 ? 'on' : ''}`} onClick={() => apply(s, true)}>
            {s === 1 ? 'Normal' : `${s}×`}
          </button>
        ))}
      </div>
      <Slider
        label="Speed"
        value={toSlider(clip.speed)}
        min={-100}
        max={100}
        defaultValue={0}
        format={() => `${clip.speed.toFixed(2)}×`}
        hint={clip.speed < 1 ? 'Slow motion' : clip.speed > 1 ? 'Faster — great for time-lapses' : 'Normal speed'}
        onChange={(v, final) => apply(fromSlider(v), final)}
      />
      <p class="faint">Now {formatDuration(clip.duration)} long.</p>
      {(asset?.hasAudio || asset?.kind === 'audio') && (
        <Section>
          <Switch
            label="Keep voices natural"
            hint="Changes speed without making voices sound like chipmunks or robots."
            checked={clip.keepPitch}
            onChange={(v) => updateClipById(clip.id, 'Keep voices natural', { keepPitch: v } as Partial<MediaClip>)}
          />
        </Section>
      )}
    </div>
  );
}

export function VolumePanel() {
  const clip = useMedia();
  const p = project.value!;
  if (!clip) return <NeedSelection what="Tap a video or sound clip first." />;
  const asset = p.assets[clip.assetId];
  if (!asset || (asset.kind !== 'audio' && !asset.hasAudio)) return <NeedSelection what="This clip has no sound." />;
  const maxFade = Math.max(0.1, Math.min(10, clip.duration / 2));
  const muted = clip.volume === 0;
  return (
    <div class="panel">
      <div class="row">
        <button
          class={`btn small ${muted ? 'primary' : ''}`}
          onClick={() => updateClipById(clip.id, muted ? 'Unmute' : 'Mute', { volume: muted ? 1 : 0 } as Partial<MediaClip>)}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />} {muted ? 'Muted — tap to unmute' : 'Mute this clip'}
        </button>
      </div>
      <Slider
        label="Volume"
        value={Math.round(clip.volume * 100)}
        min={0}
        max={200}
        defaultValue={100}
        format={(v) => `${Math.round(v)}%`}
        hint="100% is the original loudness. Above 100% makes it louder."
        onChange={(v, final) => {
          updateClipById(clip.id, 'Volume', { volume: v / 100 } as Partial<MediaClip>, 'volume');
          if (final) endGesture();
        }}
      />
      <Section title="Fades">
        <Slider
          label="Fade in"
          value={Math.min(clip.fadeIn, maxFade)}
          min={0}
          max={maxFade}
          step={0.1}
          defaultValue={0}
          format={(v) => (v ? `${v.toFixed(1)}s` : 'Off')}
          hint="Starts quietly and gets louder"
          onChange={(v, final) => {
            updateClipById(clip.id, 'Fade in', { fadeIn: v } as Partial<MediaClip>, 'fadein');
            if (final) endGesture();
          }}
        />
        <Slider
          label="Fade out"
          value={Math.min(clip.fadeOut, maxFade)}
          min={0}
          max={maxFade}
          step={0.1}
          defaultValue={0}
          format={(v) => (v ? `${v.toFixed(1)}s` : 'Off')}
          hint="Gets quieter until it is silent at the end"
          onChange={(v, final) => {
            updateClipById(clip.id, 'Fade out', { fadeOut: v } as Partial<MediaClip>, 'fadeout');
            if (final) endGesture();
          }}
        />
      </Section>
    </div>
  );
}
