/**
 * "What do you want to make?" flows. Each one asks only what it must, creates a
 * project that is already set up for the goal, and drops the user in the editor.
 */
import { CANVAS_PRESETS } from '../../model/defaults';
import { findClip, mainTrack, setTransitionAll } from '../../model/ops';
import { addText, commit, importFiles, newProject, openPanel, select, setAutoCanvas } from '../../state/actions';
import { project, toast } from '../../state/store';
import { ACCEPT_AUDIO, ACCEPT_IMAGE, ACCEPT_VIDEO, ACCEPT_VISUAL, pickFiles } from '../components/filePicker';
import { pickAspect } from '../dialogs/dialogState';

async function sizedVideoProject(title: string, name: string): Promise<boolean> {
  const choice = await pickAspect(title, 'You can change this later in Size.');
  if (!choice) return false;
  if (choice === 'auto') {
    await newProject({ kind: 'video', width: 1920, height: 1080, name });
    setAutoCanvas(true);
  } else {
    await newProject({ kind: 'video', width: choice.width, height: choice.height, name });
    setAutoCanvas(false);
  }
  return true;
}

export async function startPhotoEdit(): Promise<void> {
  const files = await pickFiles({ accept: ACCEPT_IMAGE });
  if (!files.length) return;
  await newProject({ kind: 'photo', width: 1080, height: 1080, name: 'My photo' });
  await importFiles(files.slice(0, 1));
  select(null);
  openPanel('adjust');
}

export async function startVideo(): Promise<void> {
  if (!(await sizedVideoProject('Where will people watch your video?', 'My video'))) return;
  const files = await pickFiles({ accept: ACCEPT_VISUAL, multiple: true });
  if (files.length) await importFiles(files);
}

export async function startSlideshow(): Promise<void> {
  if (!(await sizedVideoProject('Where will people watch your slideshow?', 'My slideshow'))) return;
  const files = await pickFiles({ accept: ACCEPT_IMAGE, multiple: true });
  if (!files.length) return;
  await importFiles(files);
  // Gentle fades between photos look great by default.
  commit('Add fades', (p) => setTransitionAll(p, { type: 'fade', duration: 0.6 }));
  select(null);
  toast('Tip: tap Music to add a song — then Magic → Beat sync matches your photos to the rhythm.', 'info', undefined, 7000);
}

export async function startQuickTrim(): Promise<void> {
  const files = await pickFiles({ accept: ACCEPT_VIDEO });
  if (!files.length) return;
  await newProject({ kind: 'video', width: 1920, height: 1080, name: 'Trimmed video' });
  setAutoCanvas(true);
  const ids = await importFiles(files.slice(0, 1));
  if (ids[0]) {
    select(ids[0]);
    toast('Drag the white handles at the start or end of the clip to cut it shorter. Then tap Export.', 'info', undefined, 8000);
  }
}

export async function startMeme(): Promise<void> {
  const files = await pickFiles({ accept: ACCEPT_IMAGE });
  if (!files.length) return;
  await newProject({ kind: 'photo', width: 1080, height: 1080, name: 'My meme' });
  await importFiles(files.slice(0, 1));
  const top = addText('meme', 'TOP TEXT');
  const bottom = addText('meme', 'BOTTOM TEXT');
  const p = project.peek();
  if (p && top && bottom) {
    commit('Place meme text', (q) => {
      const move = (proj: typeof q, id: string, y: number) => {
        const loc = findClip(proj, id);
        if (!loc) return proj;
        const clips = loc.track.clips.slice();
        clips[loc.clipIndex] = { ...loc.clip, transform: { ...loc.clip.transform, y } };
        return { ...proj, tracks: proj.tracks.map((t) => (t.id === loc.track.id ? { ...t, clips } : t)) };
      };
      return move(move(q, top, 0.12), bottom, 0.88);
    });
    select(top);
  }
}

export async function startBlankPost(presetId: string): Promise<void> {
  const preset = CANVAS_PRESETS.find((c) => c.id === presetId) ?? CANVAS_PRESETS[2]!;
  await newProject({ kind: 'video', width: preset.width, height: preset.height, name: 'My post' });
}

export async function addMusicFlow(): Promise<void> {
  const files = await pickFiles({ accept: ACCEPT_AUDIO });
  if (files.length) await importFiles(files, 'audio');
}

export async function addMediaFlow(target: 'auto' | 'overlay' = 'auto'): Promise<void> {
  const p = project.peek();
  const accept = p?.kind === 'photo' ? ACCEPT_IMAGE : ACCEPT_VISUAL;
  const files = await pickFiles({ accept, multiple: true });
  if (files.length) await importFiles(files, target);
}

export function hasMainMedia(): boolean {
  const p = project.peek();
  if (!p) return false;
  if (p.kind === 'photo') return p.tracks.length > 0;
  return (mainTrack(p)?.clips.length ?? 0) > 0;
}

