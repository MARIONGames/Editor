/**
 * Templates: a ready-made design that is applied after the user picks their own
 * photos/videos. Everything they add is a normal, editable clip.
 */
import { createShapeClip, createStickerClip, createTextClip } from '../model/defaults';
import { textPresetById } from '../model/textPresets';
import { addOverlayClip, mainTrack, mapTrack, projectDuration, setTransitionAll } from '../model/ops';
import type { Animation, Clip, LoopAnimType, MediaClip, Project, TransitionType } from '../model/types';

export interface Template {
  id: string;
  name: string;
  description: string;
  emoji: string;
  kind: 'video' | 'photo';
  width: number;
  height: number;
  /** What the user is asked to pick. */
  accept: 'image' | 'visual';
  multiple: boolean;
  pickPrompt: string;
  apply: (p: Project) => Project;
}

const k = (p: Project) => Math.min(p.width, p.height) / 1080;

function text(
  p: Project,
  presetId: string,
  value: string,
  start: number,
  duration: number,
  x: number,
  y: number,
  anim: Partial<Animation> = {},
  sizeMul = 1,
): Clip {
  const pr = textPresetById(presetId)!;
  return createTextClip(value, { ...pr.style, size: Math.round((pr.style.size ?? 96) * k(p) * sizeMul) }, {
    start,
    duration,
    transform: { x, y, scale: 1, rotation: 0, flipX: false, flipY: false },
    animation: {
      in: 'fade',
      inDuration: 0.5,
      out: 'fade',
      outDuration: 0.4,
      loop: 'none',
      ...pr.animation,
      ...anim,
    },
  });
}

function sticker(p: Project, emoji: string, start: number, duration: number, x: number, y: number, loop: LoopAnimType = 'none', size = 220): Clip {
  return createStickerClip(emoji, {
    start,
    duration,
    size: Math.round(size * k(p)),
    transform: { x, y, scale: 1, rotation: 0, flipX: false, flipY: false },
    animation: { in: 'pop', inDuration: 0.45, out: 'fade', outDuration: 0.3, loop },
  });
}

/** Applies a look to every photo/video on the main track (or the base photo). */
function styleMedia(p: Project, f: (c: MediaClip, i: number) => MediaClip): Project {
  let i = 0;
  let out = p;
  for (const t of p.tracks) {
    if (t.kind === 'audio') continue;
    if (p.kind === 'video' && t.kind !== 'main') continue;
    out = mapTrack(out, t.id, (tr) => ({ ...tr, clips: tr.clips.map((c) => (c.type === 'media' ? f(c, i++) : c)) }));
    if (p.kind === 'photo') break;
  }
  return out;
}

const withFilter = (id: string, intensity = 0.75) => (c: MediaClip): MediaClip => ({ ...c, effects: { ...c.effects, filter: { id, intensity } } });

function transitions(p: Project, type: TransitionType, duration: number): Project {
  return setTransitionAll(p, { type, duration });
}

function addAll(p: Project, clips: Clip[]): Project {
  return clips.reduce((acc, c) => addOverlayClip(acc, c), p);
}

export const TEMPLATES: Template[] = [
  {
    id: 'birthday',
    name: 'Birthday',
    description: 'Bright colors, confetti and a big “Happy Birthday!”',
    emoji: '🎂',
    kind: 'video',
    width: 1080,
    height: 1920,
    accept: 'visual',
    multiple: true,
    pickPrompt: 'Pick the photos and videos for the birthday video',
    apply: (p) => {
      let q = styleMedia(p, (c) => ({ ...withFilter('vivid', 0.6)(c), motion: c.motion === 'none' ? 'none' : 'auto' }));
      q = transitions(q, 'zoom-in', 0.5);
      const end = projectDuration(q);
      q = addAll(q, [
        text(q, 'bold-pop', 'Happy Birthday!', 0, Math.min(4, end), 0.5, 0.42, { in: 'drop', inDuration: 0.8 }),
        sticker(q, '🎉', 0.3, Math.min(3.7, end), 0.2, 0.22, 'wiggle'),
        sticker(q, '🎈', 0.5, Math.min(3.5, end), 0.82, 0.2, 'float', 260),
        sticker(q, '🎂', 0.7, Math.min(3.3, end), 0.5, 0.66, 'pulse', 300),
      ]);
      if (end > 6) q = addOverlayClip(q, text(q, 'wedding', 'Love you!', end - 3, 3, 0.5, 0.5, { in: 'pop', out: 'fade' }));
      return q;
    },
  },
  {
    id: 'travel',
    name: 'Travel diary',
    description: 'Cinematic colors, slow photo motion and a movie title',
    emoji: '✈️',
    kind: 'video',
    width: 1920,
    height: 1080,
    accept: 'visual',
    multiple: true,
    pickPrompt: 'Pick your best travel photos and clips',
    apply: (p) => {
      let q = styleMedia(p, (c) => ({ ...withFilter('cinematic', 0.7)(c), motion: p.assets[c.assetId]?.kind === 'image' ? 'auto' : 'none' }));
      q = transitions(q, 'dip-black', 0.8);
      const end = projectDuration(q);
      q = addAll(q, [
        text(q, 'cinema', 'THE JOURNEY', 0, Math.min(4.5, end), 0.5, 0.44),
        text(q, 'subtitle', 'Summer ' + new Date().getFullYear(), 0.6, Math.min(3.9, end - 0.6), 0.5, 0.6, { in: 'slide-up' }),
      ]);
      if (end > 7) q = addOverlayClip(q, text(q, 'elegant', 'Until next time…', end - 3.2, 3.2, 0.5, 0.5));
      return q;
    },
  },
  {
    id: 'vlog',
    name: 'Vlog intro',
    description: 'A typewriter title, a friendly wave and quick cuts',
    emoji: '👋',
    kind: 'video',
    width: 1920,
    height: 1080,
    accept: 'visual',
    multiple: true,
    pickPrompt: 'Pick your vlog clips',
    apply: (p) => {
      let q = transitions(p, 'push-left', 0.4);
      const end = projectDuration(q);
      q = addAll(q, [
        text(q, 'typewriter', 'Welcome back to my channel', 0.2, Math.min(4, end - 0.2), 0.5, 0.42, { in: 'typewriter', inDuration: 1.4 }),
        text(q, 'label', 'NEW VIDEO', 0.2, Math.min(4, end - 0.2), 0.5, 0.58, { in: 'pop' }),
        sticker(q, '👋', 0.4, Math.min(3.8, end - 0.4), 0.84, 0.28, 'wiggle', 240),
      ]);
      return q;
    },
  },
  {
    id: 'love',
    name: 'Love story',
    description: 'Dreamy colors, soft fades and floating hearts',
    emoji: '💕',
    kind: 'video',
    width: 1080,
    height: 1350,
    accept: 'visual',
    multiple: true,
    pickPrompt: 'Pick your favourite photos together',
    apply: (p) => {
      let q = styleMedia(p, (c) => ({ ...withFilter('dreamy', 0.8)(c), motion: p.assets[c.assetId]?.kind === 'image' ? 'auto' : 'none' }));
      q = transitions(q, 'fade', 1);
      const end = projectDuration(q);
      q = addAll(q, [
        text(q, 'wedding', 'Forever', 0.2, Math.min(4.5, end - 0.2), 0.5, 0.45, { inDuration: 1.2 }),
        sticker(q, '💕', 0.6, Math.min(4, end - 0.6), 0.25, 0.28, 'float', 200),
        sticker(q, '🤍', 0.9, Math.min(3.7, end - 0.9), 0.78, 0.68, 'heartbeat', 180),
      ]);
      return q;
    },
  },
  {
    id: 'recipe',
    name: 'Recipe steps',
    description: 'Tasty colors and a “Step 1, 2, 3…” caption on every clip',
    emoji: '🍝',
    kind: 'video',
    width: 1080,
    height: 1920,
    accept: 'visual',
    multiple: true,
    pickPrompt: 'Pick your cooking clips in order',
    apply: (p) => {
      let q = styleMedia(p, withFilter('food', 0.8));
      q = transitions(q, 'slide-left', 0.35);
      const m = mainTrack(q);
      const captions: Clip[] = [text(q, 'bold-pop', 'Easy recipe!', 0, Math.min(2.5, m?.clips[0]?.duration ?? 2.5), 0.5, 0.2, { in: 'pop' }, 0.85)];
      m?.clips.forEach((c, i) => {
        const s = c.start + (c.transition?.duration ?? 0) / 2;
        const d = Math.max(0.6, c.duration - (c.transition?.duration ?? 0) / 2);
        captions.push(text(q, 'caption', `Step ${i + 1}`, s, d, 0.5, 0.82, { in: 'slide-up', out: 'fade' }));
      });
      return addAll(q, captions);
    },
  },
  {
    id: 'sale',
    name: 'Big sale',
    description: 'A square post with a bold price badge',
    emoji: '🏷️',
    kind: 'photo',
    width: 1080,
    height: 1080,
    accept: 'image',
    multiple: false,
    pickPrompt: 'Pick a photo of your product',
    apply: (p) => {
      let q = styleMedia(p, (c) => ({ ...withFilter('vivid', 0.7)(c), fit: 'cover' }));
      const band = createShapeClip('rect', {
        width: p.width,
        height: Math.round(p.height * 0.3),
        fill: '#000000',
        opacity: 0.55,
        transform: { x: 0.5, y: 0.85, scale: 1, rotation: 0, flipX: false, flipY: false },
      });
      q = addAll(q, [
        band,
        text(q, 'bold-pop', 'BIG SALE', 0, 1, 0.5, 0.8, {}, 1.2),
        text(q, 'label', 'UP TO 50% OFF', 0, 1, 0.5, 0.93),
        sticker(q, '🔥', 0, 1, 0.86, 0.14, 'none', 200),
      ]);
      return q;
    },
  },
  {
    id: 'quote',
    name: 'Quote',
    description: 'Elegant words over a moody photo',
    emoji: '💬',
    kind: 'photo',
    width: 1080,
    height: 1350,
    accept: 'image',
    multiple: false,
    pickPrompt: 'Pick a background photo',
    apply: (p) => {
      let q = styleMedia(p, (c) => ({ ...withFilter('moody', 0.8)(c), fit: 'cover' }));
      const shade = createShapeClip('rect', {
        width: p.width,
        height: p.height,
        fill: '#000000',
        opacity: 0.35,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, flipX: false, flipY: false },
      });
      q = addAll(q, [
        shade,
        text(q, 'elegant', '“Do what you love,\nlove what you do.”', 0, 1, 0.5, 0.46, {}, 0.8),
        text(q, 'subtitle', '— Your name', 0, 1, 0.5, 0.64, {}, 0.8),
      ]);
      return q;
    },
  },
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
