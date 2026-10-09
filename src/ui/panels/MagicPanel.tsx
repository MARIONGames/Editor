import { AudioLines, Music, Ratio, Scissors, Sparkles, Wand2 } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { mainTrack } from '../../model/ops';
import { autoEnhance, beatSync, removeSilences } from '../../magic/actions';
import { openPanel } from '../../state/actions';
import { project, selectedClip } from '../../state/store';
import { addMusicFlow } from '../home/flows';

interface MagicCard {
  id: string;
  title: string;
  text: string;
  icon: LucideIcon;
  action: string;
  run: () => void;
  disabled?: string;
}

export function MagicPanel() {
  const p = project.value!;
  const sel = selectedClip.value;
  const m = mainTrack(p);
  const hasVisual = p.tracks.some((t) => t.clips.some((c) => c.type === 'media' && p.assets[c.assetId]?.kind !== 'audio'));
  const hasTalk = !!m?.clips.some((c) => c.type === 'media' && p.assets[c.assetId]?.kind === 'video' && p.assets[c.assetId]?.hasAudio);
  const hasMusic = p.tracks.some((t) => t.kind === 'audio' && t.clips.length);
  const photos = m?.clips.filter((c) => c.type === 'media' && p.assets[c.assetId]?.kind === 'image').length ?? 0;
  const selIsVisual = sel?.type === 'media' && p.assets[sel.assetId]?.kind !== 'audio';

  const cards: MagicCard[] = [
    {
      id: 'enhance',
      title: 'Auto-enhance',
      text: 'Fixes light and color automatically — brighter, clearer, natural colors.',
      icon: Sparkles,
      action: selIsVisual ? 'Enhance this' : 'Enhance everything',
      run: () => void autoEnhance(!selIsVisual),
      disabled: hasVisual ? undefined : 'Add a photo or video first',
    },
  ];
  if (p.kind === 'video') {
    cards.push(
      {
        id: 'silence',
        title: 'Remove silent parts',
        text: 'Listens to your video and cuts out the pauses where nobody talks. Perfect for vlogs and tutorials.',
        icon: Scissors,
        action: 'Remove pauses',
        run: () => void removeSilences(),
        disabled: hasTalk ? undefined : 'Needs a video with talking in it',
      },
      {
        id: 'beat',
        title: 'Beat sync',
        text: 'Times your photos to the rhythm of the music, so every change lands on a beat.',
        icon: AudioLines,
        action: hasMusic ? 'Sync to the beat' : 'Add music first',
        run: () => (hasMusic ? void beatSync() : void addMusicFlow()),
        disabled: photos >= 2 ? undefined : 'Needs at least two photos',
      },
      {
        id: 'fit',
        title: 'Fit for TikTok, YouTube, Instagram',
        text: 'Change the shape of your video for where you’ll post it. Empty space is filled with a soft blur.',
        icon: Ratio,
        action: 'Choose a shape',
        run: () => openPanel('canvas'),
      },
    );
    if (!hasMusic) {
      cards.push({
        id: 'music',
        title: 'Add background music',
        text: 'Pick a song from your device. It fades out nicely at the end of your video.',
        icon: Music,
        action: 'Add music',
        run: () => void addMusicFlow(),
      });
    }
  }
  if (sel?.type === 'media' && selIsVisual) {
    cards.push({
      id: 'greenscreen',
      title: 'Remove a background color',
      text: 'Shot in front of a green or blue screen? Make that color see-through.',
      icon: Wand2,
      action: 'Green screen',
      run: () => openPanel('greenscreen'),
    });
  }

  return (
    <div class="panel magic-panel">
      {cards.map((c) => (
        <div class="magic-card" key={c.id}>
          <span class="magic-icon">
            <c.icon size={22} />
          </span>
          <div class="grow">
            <strong>{c.title}</strong>
            <p class="faint">{c.text}</p>
            <button class="btn small magic" disabled={!!c.disabled} onClick={c.run} data-coach={`magic-${c.id}`}>
              {c.action}
            </button>
            {c.disabled && <p class="faint small-note">{c.disabled}</p>}
          </div>
        </div>
      ))}
      <p class="faint">Everything magic happens on your device and can be undone.</p>
    </div>
  );
}
