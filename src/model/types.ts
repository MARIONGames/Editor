/**
 * Kinora project model.
 *
 * Everything in here is plain, serialisable data. Edits are made with the pure
 * functions in `ops.ts`, which never mutate their input (structural sharing).
 */

export type ID = string;

export const SCHEMA_VERSION = 1;

export type ProjectKind = 'video' | 'photo';

export interface Project {
  schema: number;
  id: ID;
  name: string;
  kind: ProjectKind;
  /** Output canvas size in pixels. */
  width: number;
  height: number;
  /** Frames per second for playback stepping and export. */
  fps: number;
  background: Background;
  assets: Record<ID, Asset>;
  /** Drawn in order: index 0 is the bottom layer. Audio tracks are not drawn. */
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

export interface Background {
  /** CSS colour, or 'transparent' (photo projects exported as PNG/WebP). */
  color: string;
  /** Fill empty space around main-track media with a blurred copy of it. */
  blur: boolean;
}

export type AssetKind = 'image' | 'video' | 'audio';

export interface Asset {
  id: ID;
  kind: AssetKind;
  name: string;
  mime: string;
  size: number;
  /** Display size (rotation applied). 0 for audio. */
  width: number;
  height: number;
  /** Seconds. 0 for images. */
  duration: number;
  hasAudio: boolean;
  fps?: number;
  addedAt: number;
}

export type TrackKind = 'main' | 'overlay' | 'audio';

export interface Track {
  id: ID;
  kind: TrackKind;
  /** Sorted by start time. */
  clips: Clip[];
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  /** Track volume multiplier (0..2). */
  volume: number;
}

export interface Transform {
  /** Centre of the clip, as a fraction of the canvas width (0 = left edge, 1 = right edge). */
  x: number;
  /** Centre of the clip, as a fraction of the canvas height. */
  y: number;
  /** Multiplier on the clip's base size. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

/** Fractions of the source removed from each side (0..1). */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'add';

/** All values are -100..100 (or 0..100 where negative makes no sense). 0 = unchanged. */
export interface Adjustments {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  vibrance: number;
  saturation: number;
  hue: number;
  clarity: number;
  sharpen: number;
  blur: number;
  vignette: number;
  grain: number;
  fade: number;
}

export type AdjustKey = keyof Adjustments;

export interface FilterRef {
  id: string;
  /** 0..1 */
  intensity: number;
}

export interface ChromaKey {
  /** Hex colour to remove. */
  color: string;
  /** 0..1 how close a colour must be to be removed. */
  similarity: number;
  /** 0..1 edge softness. */
  smoothness: number;
  /** 0..1 how much of the key colour's tint to remove from the edges. */
  spill: number;
}

export interface Effects {
  adjust: Adjustments;
  filter: FilterRef | null;
  chromaKey: ChromaKey | null;
}

export type TransitionType =
  | 'fade'
  | 'dip-black'
  | 'dip-white'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'push-left'
  | 'push-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'circle'
  | 'blur'
  | 'spin';

export interface Transition {
  type: TransitionType;
  /** Seconds. Clamped to half of the shorter neighbouring clip. */
  duration: number;
}

export type AnimInType =
  | 'none'
  | 'fade'
  | 'pop'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'spin'
  | 'drop'
  | 'blur'
  | 'typewriter';

export type AnimOutType = Exclude<AnimInType, 'typewriter'>;

export type LoopAnimType = 'none' | 'pulse' | 'float' | 'wiggle' | 'spin' | 'blink' | 'heartbeat';

export interface Animation {
  in: AnimInType;
  inDuration: number;
  out: AnimOutType;
  outDuration: number;
  loop: LoopAnimType;
}

/** Slow "Ken Burns" movement for photos in videos. */
export type Motion =
  | 'none'
  | 'auto'
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'pan-down';

export interface ClipCommon {
  id: ID;
  /** Timeline position in seconds. */
  start: number;
  /** Timeline duration in seconds. */
  duration: number;
  transform: Transform;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
  effects: Effects;
  /** Main track only: the transition *into* this clip from the previous one. */
  transition: Transition | null;
  animation: Animation;
}

export interface MediaClip extends ClipCommon {
  type: 'media';
  assetId: ID;
  /** Source in-point in seconds. */
  in: number;
  /** Playback speed (0.25..4). The clip uses `duration * speed` seconds of source. */
  speed: number;
  /** 0..2 (1 = original). */
  volume: number;
  /** Audio fade in / out in seconds. */
  fadeIn: number;
  fadeOut: number;
  /** Keep voices natural when speed != 1. */
  keepPitch: boolean;
  crop: Crop;
  /** Quarter turns (0–3) applied before the free rotation (Crop → Rotate). */
  turns: number;
  /** How the media fills the canvas before `transform.scale`. */
  fit: 'contain' | 'cover';
  motion: Motion;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
  font: string;
  /** Font size in canvas pixels. */
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  align: TextAlign;
  /** Multiple of the font size. */
  lineHeight: number;
  /** Extra spacing between letters, in em. */
  letterSpacing: number;
  uppercase: boolean;
  /** Outline width in em (0 = no outline). */
  strokeWidth: number;
  strokeColor: string;
  shadow: boolean;
  shadowColor: string;
  /** In em. */
  shadowBlur: number;
  /** Vertical shadow offset in em. */
  shadowOffset: number;
  box: boolean;
  boxColor: string;
  /** In em. */
  boxPadding: number;
  /** In em. */
  boxRadius: number;
}

export interface TextClip extends ClipCommon {
  type: 'text';
  text: string;
  style: TextStyle;
}

export interface StickerClip extends ClipCommon {
  type: 'sticker';
  emoji: string;
  /** Size of the sticker box in canvas pixels. */
  size: number;
}

export type ShapeKind =
  | 'rect'
  | 'rounded'
  | 'ellipse'
  | 'triangle'
  | 'star'
  | 'heart'
  | 'arrow'
  | 'line'
  | 'bubble';

export interface ShapeClip extends ClipCommon {
  type: 'shape';
  shape: ShapeKind;
  width: number;
  height: number;
  fill: string;
  strokeColor: string;
  /** Outline width in canvas pixels (0 = none). */
  strokeWidth: number;
}

export type Clip = MediaClip | TextClip | StickerClip | ShapeClip;
export type ClipType = Clip['type'];

/** Where a clip lives inside a project. */
export interface ClipLocation {
  track: Track;
  trackIndex: number;
  clip: Clip;
  clipIndex: number;
}
