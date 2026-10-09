import { uid } from '../util/id';
import { DEFAULT_FONT } from './fonts';
import {
  SCHEMA_VERSION,
  type Adjustments,
  type Animation,
  type Asset,
  type Crop,
  type Effects,
  type MediaClip,
  type Project,
  type ProjectKind,
  type ShapeClip,
  type ShapeKind,
  type StickerClip,
  type TextClip,
  type TextStyle,
  type Track,
  type TrackKind,
  type Transform,
} from './types';

/** Default length of a photo on the video timeline. */
export const DEFAULT_PHOTO_DURATION = 3;
/** Default length of a text / sticker / shape overlay. */
export const DEFAULT_OVERLAY_DURATION = 3;
/** Shortest clip we allow (seconds). */
export const MIN_CLIP_DURATION = 0.1;
/** Longest still clip (seconds). */
export const MAX_STILL_DURATION = 3600;
/** Photo projects keep every layer on [0, PHOTO_TIME). */
export const PHOTO_TIME = 1;

export const ADJUST_KEYS: (keyof Adjustments)[] = [
  'exposure',
  'brightness',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'temperature',
  'tint',
  'vibrance',
  'saturation',
  'hue',
  'clarity',
  'sharpen',
  'blur',
  'vignette',
  'grain',
  'fade',
];

export const NEUTRAL_ADJUST: Readonly<Adjustments> = Object.freeze({
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  hue: 0,
  clarity: 0,
  sharpen: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
  fade: 0,
});

export const defaultTransform = (): Transform => ({
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
});

export const defaultCrop = (): Crop => ({ left: 0, top: 0, right: 0, bottom: 0 });

export const defaultEffects = (): Effects => ({
  adjust: { ...NEUTRAL_ADJUST },
  filter: null,
  chromaKey: null,
});

export const defaultAnimation = (): Animation => ({
  in: 'none',
  inDuration: 0.5,
  out: 'none',
  outDuration: 0.5,
  loop: 'none',
});

export const defaultTextStyle = (): TextStyle => ({
  font: DEFAULT_FONT,
  size: 96,
  weight: 800,
  italic: false,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.15,
  letterSpacing: 0,
  uppercase: false,
  strokeWidth: 0,
  strokeColor: '#000000',
  shadow: true,
  shadowColor: '#00000099',
  shadowBlur: 0.12,
  shadowOffset: 0.04,
  box: false,
  boxColor: '#000000aa',
  boxPadding: 0.3,
  boxRadius: 0.25,
});

export function createTrack(kind: TrackKind): Track {
  return { id: uid('t'), kind, clips: [], muted: false, hidden: false, locked: false, volume: 1 };
}

export interface CreateProjectOptions {
  kind: ProjectKind;
  width: number;
  height: number;
  name?: string;
  fps?: number;
}

export function createProject(opts: CreateProjectOptions): Project {
  const now = Date.now();
  return {
    schema: SCHEMA_VERSION,
    id: uid('p'),
    name: opts.name ?? (opts.kind === 'photo' ? 'My photo' : 'My video'),
    kind: opts.kind,
    width: Math.round(opts.width),
    height: Math.round(opts.height),
    fps: opts.fps ?? 30,
    background: { color: '#000000', blur: opts.kind === 'video' },
    assets: {},
    tracks: opts.kind === 'video' ? [createTrack('main')] : [],
    createdAt: now,
    updatedAt: now,
  };
}

function baseClip() {
  return {
    id: uid('c'),
    start: 0,
    duration: DEFAULT_OVERLAY_DURATION,
    transform: defaultTransform(),
    opacity: 1,
    blend: 'normal' as const,
    effects: defaultEffects(),
    transition: null,
    animation: defaultAnimation(),
  };
}

export function createMediaClip(asset: Asset, opts: Partial<MediaClip> = {}): MediaClip {
  const duration =
    asset.kind === 'image' ? DEFAULT_PHOTO_DURATION : Math.max(MIN_CLIP_DURATION, asset.duration);
  return {
    ...baseClip(),
    type: 'media',
    assetId: asset.id,
    duration,
    in: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    keepPitch: true,
    crop: defaultCrop(),
    turns: 0,
    fit: 'contain',
    motion: 'none',
    ...opts,
  };
}

export function createTextClip(text: string, style: Partial<TextStyle> = {}, opts: Partial<TextClip> = {}): TextClip {
  return {
    ...baseClip(),
    type: 'text',
    text,
    style: { ...defaultTextStyle(), ...style },
    ...opts,
  };
}

export function createStickerClip(emoji: string, opts: Partial<StickerClip> = {}): StickerClip {
  return { ...baseClip(), type: 'sticker', emoji, size: 220, ...opts };
}

export function createShapeClip(shape: ShapeKind, opts: Partial<ShapeClip> = {}): ShapeClip {
  const square = shape === 'ellipse' || shape === 'star' || shape === 'heart' || shape === 'triangle';
  return {
    ...baseClip(),
    type: 'shape',
    shape,
    width: shape === 'line' || shape === 'arrow' ? 480 : square ? 320 : 420,
    height: shape === 'line' ? 24 : shape === 'arrow' ? 140 : square ? 320 : 260,
    fill: shape === 'line' ? '#ffffff' : '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 0,
    ...opts,
  };
}

/** Common canvas sizes, in plain language. */
export interface CanvasPreset {
  id: string;
  label: string;
  hint: string;
  width: number;
  height: number;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: '16:9', label: 'Wide 16:9', hint: 'YouTube, TV, laptops', width: 1920, height: 1080 },
  { id: '9:16', label: 'Tall 9:16', hint: 'TikTok, Reels, Shorts, Stories', width: 1080, height: 1920 },
  { id: '1:1', label: 'Square 1:1', hint: 'Instagram & Facebook posts', width: 1080, height: 1080 },
  { id: '4:5', label: 'Portrait 4:5', hint: 'Instagram feed (more space)', width: 1080, height: 1350 },
  { id: '4:3', label: 'Classic 4:3', hint: 'Old TV, presentations', width: 1440, height: 1080 },
  { id: '21:9', label: 'Cinema 21:9', hint: 'Movie look with black bars', width: 2520, height: 1080 },
];
