import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { Check, ChevronRight, Lightbulb, X } from 'lucide-preact';
import { mainTrack } from '../model/ops';
import { formatDuration } from '../model/time';
import type { Project } from '../model/types';
import { preview } from '../engine/preview';
import { addText, openPanel, select } from '../state/actions';
import { on } from '../state/events';
import { duration, isCompact, panel, project, selectionId, settings, toast, updateSettings } from '../state/store';
import { addMediaFlow, addMusicFlow } from '../ui/home/flows';
import { openDialog } from '../ui/dialogs/dialogState';
import { startTour, tour } from './tour';

/* ---------------------------------------------------------- progress flags */

type Flag = 'played' | 'cut' | 'exported';
const flagsVersion = signal(0);
const key = (id: string) => `kinora.flags.${id}`;

function readFlags(id: string): Set<Flag> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key(id)) ?? '[]') as Flag[]);
  } catch {
    return new Set();
  }
}

function setFlag(f: Flag): void {
  const p = project.peek();
  if (!p) return;
  const s = readFlags(p.id);
  if (s.has(f)) return;
  s.add(f);
  try {
    localStorage.setItem(key(p.id), JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
  flagsVersion.value++;
}

let tracking = false;
function track(): void {
  if (tracking) return;
  tracking = true;
  on('playback:played', () => setFlag('played'));
  on('clip:split', () => setFlag('cut'));
  on('clip:trimmed', () => setFlag('cut'));
  on('clip:deleted', () => setFlag('cut'));
  on('magic:used', (e) => e.name === 'silence' && setFlag('cut'));
  on('export:done', () => setFlag('exported'));
}

/* --------------------------------------------------------------- checklist */

export interface Step {
  id: string;
  label: string;
  done: boolean;
  action: string;
  run: () => void;
}

function baseLayerId(p: Project): string | undefined {
  return p.tracks.find((t) => t.clips[0]?.type === 'media')?.clips[0]?.id;
}

export function checklist(p: Project): Step[] {
  void flagsVersion.value;
  const flags = readFlags(p.id);
  const all = p.tracks.flatMap((t) => t.clips);
  if (p.kind === 'photo') {
    const looked = all.some((c) => c.type === 'media' && (c.effects.filter || Object.values(c.effects.adjust).some((v) => v !== 0)));
    return [
      { id: 'add', label: 'Choose a photo', done: p.tracks.length > 0, action: 'Choose', run: () => void addMediaFlow() },
      {
        id: 'look',
        label: 'Make it look better',
        done: looked,
        action: 'Adjust',
        run: () => {
          const b = baseLayerId(p);
          if (b) select(b);
          openPanel('adjust');
        },
      },
      { id: 'words', label: 'Add text or a sticker', done: all.some((c) => c.type === 'text' || c.type === 'sticker'), action: 'Add text', run: () => openPanel('text') },
      { id: 'export', label: 'Export your photo', done: flags.has('exported'), action: 'Export', run: () => openDialog({ type: 'export' }) },
    ];
  }
  const m = mainTrack(p);
  return [
    { id: 'add', label: 'Add photos or videos', done: (m?.clips.length ?? 0) > 0, action: 'Add', run: () => void addMediaFlow() },
    { id: 'watch', label: 'Watch it (press ▶)', done: flags.has('played'), action: 'Play', run: () => preview.play() },
    {
      id: 'cut',
      label: 'Cut out a part you don’t need',
      done: flags.has('cut'),
      action: 'Show me',
      run: () => {
        const first = m?.clips[0];
        if (first) select(first.id);
        toast('Drag a white edge of the selected clip to shorten it — or move the white line and tap Split.', 'info', undefined, 7000);
      },
    },
    {
      id: 'title',
      label: 'Add a title',
      done: all.some((c) => c.type === 'text'),
      action: 'Add',
      run: () => {
        preview.seek(0);
        addText('title', 'My video');
        openPanel('text');
      },
    },
    { id: 'music', label: 'Add music', done: p.tracks.some((t) => t.kind === 'audio' && t.clips.length > 0), action: 'Add', run: () => void addMusicFlow() },
    { id: 'export', label: 'Export & share', done: flags.has('exported'), action: 'Export', run: () => openDialog({ type: 'export' }) },
  ];
}

/** Starts the tour the first time someone opens the editor. */
export function useAutoTour(): void {
  useEffect(() => {
    track();
    if (settings.peek().tourDone) return;
    const id = setTimeout(() => {
      const p = project.peek();
      if (p && !tour.peek() && !settings.peek().tourDone) startTour(p.kind);
    }, 900);
    return () => clearTimeout(id);
  }, []);
}

/** Desktop: shown in the side panel when no tool is open. */
export function NextSteps() {
  const p = project.value!;
  const steps = checklist(p);
  const done = steps.filter((s) => s.done).length;
  const hidden = settings.value.checklistHidden;
  return (
    <div class="next-steps">
      {!hidden && (
        <div class="checklist">
          <div class="row">
            <h3 class="grow">{p.kind === 'photo' ? 'Your photo, step by step' : 'Your video, step by step'}</h3>
            <button class="icon-btn small" aria-label="Hide checklist" title="Hide checklist" onClick={() => updateSettings({ checklistHidden: true })}>
              <X size={16} />
            </button>
          </div>
          <div class="progress">
            <div class="progress-fill" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <ul>
            {steps.map((s) => (
              <li key={s.id} class={s.done ? 'done' : ''}>
                <span class="check">{s.done && <Check size={14} />}</span>
                <span class="grow">{s.label}</span>
                {!s.done && (
                  <button class="btn small ghost" onClick={s.run}>
                    {s.action} <ChevronRight size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {done === steps.length && <p class="celebrate">🎉 You did it! You’re officially an editor.</p>}
        </div>
      )}
      <div class="tips">
        <h4>
          <Lightbulb size={16} /> Good to know
        </h4>
        <ul>
          <li>Hover or press-and-hold any tool to see what it does.</li>
          <li>Everything can be undone — try things!</li>
          {p.kind === 'video' && <li>Space plays and pauses. S splits at the white line.</li>}
          <li>Drop files anywhere on the editor to add them.</li>
        </ul>
        <p class="faint">
          {p.width} × {p.height}
          {p.kind === 'video' ? ` · ${formatDuration(duration.value)}` : ''} · saved on this device
        </p>
      </div>
    </div>
  );
}

/** Phones: a one-line suggestion above the tools. */
export function NextStepChip() {
  const p = project.value;
  if (!p || !isCompact.value || panel.value || selectionId.value || settings.value.checklistHidden || tour.value) return null;
  const next = checklist(p).find((s) => !s.done);
  if (!next) return null;
  return (
    <div class="next-chip" role="status">
      <Lightbulb size={16} />
      <span class="grow">
        Next: <strong>{next.label}</strong>
      </span>
      <button class="btn small primary" onClick={next.run}>
        {next.action}
      </button>
      <button class="icon-btn small" aria-label="Hide suggestions" onClick={() => updateSettings({ checklistHidden: true })}>
        <X size={14} />
      </button>
    </div>
  );
}
