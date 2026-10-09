import {
  NEUTRAL_ADJUST,
  defaultAnimation,
  defaultCrop,
  defaultTextStyle,
  defaultTransform,
} from './defaults';
import { normalizeProject } from './ops';
import { SCHEMA_VERSION, type Clip, type Project, type Track } from './types';

/**
 * Makes a project loaded from storage safe to use: fills fields added in newer
 * versions with defaults and re-establishes every invariant. Unknown future
 * versions are rejected so we never silently corrupt them.
 */
export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Not a Kinora project');
  const p = raw as Partial<Project>;
  if (typeof p.schema === 'number' && p.schema > SCHEMA_VERSION) {
    throw new Error('This project was made with a newer version of Kinora. Please update the app.');
  }
  if (!p.id || !Array.isArray(p.tracks)) throw new Error('Not a Kinora project');
  const project: Project = {
    schema: SCHEMA_VERSION,
    id: p.id,
    name: p.name || 'Untitled',
    kind: p.kind === 'photo' ? 'photo' : 'video',
    width: p.width || 1920,
    height: p.height || 1080,
    fps: p.fps || 30,
    background: { color: '#000000', blur: true, ...(p.background ?? {}) },
    assets: p.assets ?? {},
    tracks: p.tracks.map(fixTrack),
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  };
  return normalizeProject(project);
}

function fixTrack(t: Track): Track {
  return {
    id: t.id,
    kind: t.kind === 'main' || t.kind === 'audio' ? t.kind : 'overlay',
    clips: (t.clips ?? []).map(fixClip),
    muted: !!t.muted,
    hidden: !!t.hidden,
    locked: !!t.locked,
    volume: typeof t.volume === 'number' ? t.volume : 1,
  };
}

function fixClip(c: Clip): Clip {
  const base = {
    ...c,
    transform: { ...defaultTransform(), ...c.transform },
    opacity: typeof c.opacity === 'number' ? c.opacity : 1,
    blend: c.blend ?? 'normal',
    effects: {
      adjust: { ...NEUTRAL_ADJUST, ...(c.effects?.adjust ?? {}) },
      filter: c.effects?.filter ?? null,
      chromaKey: c.effects?.chromaKey ?? null,
    },
    transition: c.transition ?? null,
    animation: { ...defaultAnimation(), ...c.animation },
  };
  switch (c.type) {
    case 'media':
      return {
        ...base,
        type: 'media',
        in: c.in ?? 0,
        speed: c.speed ?? 1,
        volume: c.volume ?? 1,
        fadeIn: c.fadeIn ?? 0,
        fadeOut: c.fadeOut ?? 0,
        keepPitch: c.keepPitch ?? true,
        crop: { ...defaultCrop(), ...c.crop },
        fit: c.fit ?? 'contain',
        motion: c.motion ?? 'none',
      } as Clip;
    case 'text':
      return { ...base, type: 'text', style: { ...defaultTextStyle(), ...c.style } } as Clip;
    default:
      return base as Clip;
  }
}
