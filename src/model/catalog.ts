import type { AnimInType, AnimOutType, LoopAnimType, Motion, TransitionType } from './types';

/** Plain-language catalogues used by the pickers. */

export interface TransitionDef {
  type: TransitionType;
  name: string;
  hint: string;
  duration: number;
}

export const TRANSITIONS: TransitionDef[] = [
  { type: 'fade', name: 'Fade', hint: 'One picture slowly turns into the next', duration: 0.6 },
  { type: 'dip-black', name: 'Fade to black', hint: 'Goes dark, then the next clip appears', duration: 0.8 },
  { type: 'dip-white', name: 'Flash', hint: 'A quick white flash between clips', duration: 0.5 },
  { type: 'slide-left', name: 'Slide left', hint: 'The next clip slides in from the right', duration: 0.5 },
  { type: 'slide-right', name: 'Slide right', hint: 'The next clip slides in from the left', duration: 0.5 },
  { type: 'slide-up', name: 'Slide up', hint: 'The next clip slides up from the bottom', duration: 0.5 },
  { type: 'slide-down', name: 'Slide down', hint: 'The next clip drops in from the top', duration: 0.5 },
  { type: 'push-left', name: 'Push', hint: 'The next clip pushes the old one away', duration: 0.5 },
  { type: 'push-right', name: 'Push right', hint: 'Pushes the old clip to the right', duration: 0.5 },
  { type: 'wipe-left', name: 'Wipe', hint: 'A straight line wipes across the picture', duration: 0.6 },
  { type: 'wipe-down', name: 'Wipe down', hint: 'A line wipes from top to bottom', duration: 0.6 },
  { type: 'wipe-up', name: 'Wipe up', hint: 'A line wipes from bottom to top', duration: 0.6 },
  { type: 'wipe-right', name: 'Wipe right', hint: 'A line wipes from left to right', duration: 0.6 },
  { type: 'zoom-in', name: 'Zoom in', hint: 'Zooms into the next clip', duration: 0.5 },
  { type: 'zoom-out', name: 'Zoom out', hint: 'Zooms out to reveal the next clip', duration: 0.5 },
  { type: 'circle', name: 'Circle', hint: 'A growing circle reveals the next clip', duration: 0.7 },
  { type: 'blur', name: 'Blur', hint: 'Blurs out, then blurs into the next clip', duration: 0.6 },
  { type: 'spin', name: 'Spin', hint: 'A playful spin into the next clip', duration: 0.6 },
];

export function transitionDef(type: TransitionType): TransitionDef {
  return TRANSITIONS.find((t) => t.type === type) ?? TRANSITIONS[0]!;
}

export interface AnimDef<T extends string> {
  type: T;
  name: string;
}

export const ANIM_IN: AnimDef<AnimInType>[] = [
  { type: 'none', name: 'None' },
  { type: 'fade', name: 'Fade in' },
  { type: 'pop', name: 'Pop' },
  { type: 'slide-up', name: 'Rise' },
  { type: 'slide-down', name: 'Drop down' },
  { type: 'slide-left', name: 'From right' },
  { type: 'slide-right', name: 'From left' },
  { type: 'zoom-in', name: 'Zoom in' },
  { type: 'zoom-out', name: 'Zoom out' },
  { type: 'drop', name: 'Bounce' },
  { type: 'spin', name: 'Spin' },
  { type: 'blur', name: 'Focus' },
  { type: 'typewriter', name: 'Typewriter' },
];

export const ANIM_OUT: AnimDef<AnimOutType>[] = [
  { type: 'none', name: 'None' },
  { type: 'fade', name: 'Fade out' },
  { type: 'pop', name: 'Pop' },
  { type: 'slide-up', name: 'Fly up' },
  { type: 'slide-down', name: 'Fall' },
  { type: 'slide-left', name: 'To left' },
  { type: 'slide-right', name: 'To right' },
  { type: 'zoom-in', name: 'Zoom in' },
  { type: 'zoom-out', name: 'Zoom out' },
  { type: 'drop', name: 'Drop' },
  { type: 'spin', name: 'Spin' },
  { type: 'blur', name: 'Blur' },
];

export const ANIM_LOOP: AnimDef<LoopAnimType>[] = [
  { type: 'none', name: 'None' },
  { type: 'pulse', name: 'Pulse' },
  { type: 'float', name: 'Float' },
  { type: 'wiggle', name: 'Wiggle' },
  { type: 'heartbeat', name: 'Heartbeat' },
  { type: 'blink', name: 'Blink' },
  { type: 'spin', name: 'Spin' },
];

export const MOTIONS: { type: Motion; name: string; hint: string }[] = [
  { type: 'none', name: 'Still', hint: 'The photo does not move' },
  { type: 'auto', name: 'Auto', hint: 'Kinora picks a gentle movement for each photo' },
  { type: 'zoom-in', name: 'Zoom in', hint: 'Slowly moves closer' },
  { type: 'zoom-out', name: 'Zoom out', hint: 'Slowly moves away' },
  { type: 'pan-left', name: 'Pan left', hint: 'Glides to the left' },
  { type: 'pan-right', name: 'Pan right', hint: 'Glides to the right' },
  { type: 'pan-up', name: 'Pan up', hint: 'Glides upwards' },
  { type: 'pan-down', name: 'Pan down', hint: 'Glides downwards' },
];

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export const STICKER_CATEGORIES: { id: string; name: string; emoji: string[] }[] = [
  {
    id: 'popular',
    name: 'Popular',
    emoji: ['❤️', '😂', '🔥', '✨', '👍', '🎉', '😍', '🥳', '😎', '💯', '⭐', '👀', '🙌', '💥', '🤩', '😭'],
  },
  {
    id: 'faces',
    name: 'Faces',
    emoji: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😊', '😇', '🙂', '😉', '😌', '😋', '😜', '🤪', '🤔', '🤫', '😴', '😱', '🤯', '😡', '🥺', '😬', '🤗', '🤓', '😏', '🙄', '😮', '🥰', '😘'],
  },
  {
    id: 'party',
    name: 'Party',
    emoji: ['🎂', '🎁', '🎈', '🎊', '🎉', '🥂', '🍾', '🍰', '🧁', '🎶', '🎵', '🪩', '🕺', '💃', '👑', '🏆'],
  },
  {
    id: 'love',
    name: 'Love',
    emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💕', '💘', '💝', '💐', '🌹', '💍', '😻'],
  },
  {
    id: 'nature',
    name: 'Nature',
    emoji: ['☀️', '🌈', '⛅', '🌙', '⭐', '🌸', '🌻', '🍀', '🌴', '🌊', '🏔️', '🌵', '🍁', '❄️', '⚡', '🌍'],
  },
  {
    id: 'travel',
    name: 'Travel',
    emoji: ['✈️', '🚗', '🚲', '⛵', '🏖️', '🗺️', '📍', '🧳', '🏕️', '🗽', '🗼', '🎡', '🚀', '🚂', '📸', '🌅'],
  },
  {
    id: 'food',
    name: 'Food',
    emoji: ['🍕', '🍔', '🍟', '🌮', '🍣', '🍜', '🍩', '🍪', '🍫', '🍓', '🍉', '🥑', '☕', '🧋', '🍷', '🍦'],
  },
  {
    id: 'animals',
    name: 'Animals',
    emoji: ['🐶', '🐱', '🐻', '🐼', '🦊', '🐰', '🦁', '🐯', '🐸', '🐵', '🦄', '🐝', '🦋', '🐢', '🐬', '🐧'],
  },
  {
    id: 'signs',
    name: 'Signs',
    emoji: ['✅', '❌', '⚠️', '❓', '❗', '💡', '📢', '🔔', '👉', '👈', '👆', '👇', '➡️', '⬅️', '🆕', '🔝'],
  },
];
