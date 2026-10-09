/**
 * "What do you want to make?" flows. Each one asks only what it must, creates a
 * project that is already set up for the goal, and drops the user in the editor.
 * Files are picked before anything slow happens, so the browser still treats the
 * picker as a direct response to the user's tap.
 */
import { findClip, mainTrack, setTransitionAll } from '../../model/ops';
import type { Project } from '../../model/types';
import { addText, commit, importFiles, newProject, openPanel, select, setAutoCanvas } from '../../state/actions';
import { project, toast } from '../../state/store';
import type { Template } from '../../templates/templates';
import { ACCEPT_AUDIO, ACCEPT_IMAGE, ACCEPT_VIDEO, ACCEPT_VISUAL, pickFiles } from '../components/filePicker';
import { pickAspect } from '../dialogs/dialogState';

/** Asks where the video will be watched, then for files; creates the project. */
async function videoProjectWithFiles(title: string, name: string, accept: string): Promise<File[] | null> {
  const choice = await pickAspect(title, 'You can change this later in Size.');
  if (!choice) return null;
  const files = await pickFiles({ accept, multiple: true });
  if (choice === 'auto') {
    await newProject({ kind: 'video', width: 1920, height: 1080, name });
    setAutoCanvas(true);
  } else {
    await newProject({ kind: 'video', width: choice.width, height: choice.height, name });
    setAutoCanvas(false);
  }
  return files;
}

export async function startPhotoEdit(): Promise<void> {
  const files = await pickFiles({ accept: ACCEPT_IMAGE });
  if (!files.length) return;
  await newProject({ kind: 'photo', width: 1080, height: 1080, name: 'My photo' });
  const ids = await importFiles(files.slice(0, 1));
  if (ids[0]) select(ids[0]);
  openPanel('adjust');
}

export async function startVideo(): Promise<void> {
  const files = await videoProjectWithFiles('Where will people watch your video?', 'My video', ACCEPT_VISUAL);
  if (files?.length) await importFiles(files);
}

export async function startSlideshow(): Promise<void> {
  const files = await videoProjectWithFiles('Where will people watch your slideshow?', 'My slideshow', ACCEPT_IMAGE);
  if (!files?.length) return;
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
  if (top && bottom) {
    commit('Place meme text', (q) => moveTo(moveTo(q, top, 0.12), bottom, 0.88));
    select(top);
    openPanel('text');
  }
}

function moveTo(p: Project, id: string, y: number): Project {
  const loc = findClip(p, id);
  if (!loc) return p;
  const clips = loc.track.clips.slice();
  clips[loc.clipIndex] = { ...loc.clip, transform: { ...loc.clip.transform, y } };
  return { ...p, tracks: p.tracks.map((t) => (t.id === loc.track.id ? { ...t, clips } : t)) };
}

export async function startTemplate(t: Template): Promise<void> {
  const files = await pickFiles({ accept: t.accept === 'image' ? ACCEPT_IMAGE : ACCEPT_VISUAL, multiple: t.multiple });
  if (!files.length) return;
  await newProject({ kind: t.kind, width: t.width, height: t.height, name: t.name });
  setAutoCanvas(false);
  const ids = await importFiles(t.multiple ? files : files.slice(0, 1), 'auto', { keepCanvas: true });
  if (!ids.length) return;
  commit(`Template: ${t.name}`, (p) => t.apply(p));
  select(null);
  toast(`“${t.name}” is ready. Tap any text to change the words.`, 'success', undefined, 6000);
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
