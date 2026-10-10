/**
 * The interactive tour: each step points at a real control and (where it makes
 * sense) waits until the user actually does the thing — learning by doing.
 */
import { signal } from '@preact/signals';
import { mainTrack } from '../model/ops';
import { on, type AppEvents } from '../state/events';
import { project, updateSettings } from '../state/store';

export interface TourStep {
  /** CSS selector of the element to highlight (optional: centred card). */
  target?: string;
  title: string;
  body: string;
  /** Advance automatically when this event happens. */
  until?: keyof AppEvents;
  /** Label of the button that advances manually. */
  next?: string;
  /** Skip this step when it no longer makes sense (e.g. media already added). */
  skip?: () => boolean;
}

const hasMedia = (): boolean => {
  const p = project.peek();
  if (!p) return false;
  return p.kind === 'photo' ? p.tracks.length > 0 : (mainTrack(p)?.clips.length ?? 0) > 0;
};

export interface TourState {
  steps: TourStep[];
  index: number;
  /** Which "done" flag finishing it sets. */
  flag?: 'tourDone' | 'tour3dDone';
}

export const tour = signal<TourState | null>(null);

const VIDEO_TOUR: TourStep[] = [
  {
    title: 'Welcome to Kinora! 👋',
    body: 'In one minute you’ll know everything you need. You can stop the tour any time.',
    next: 'Show me around',
  },
  {
    target: '[data-coach="empty-add"]',
    title: 'First, add your photos or videos',
    body: 'Tap here and pick a few from your phone or computer. You can add more later.',
    until: 'media:added',
    skip: hasMedia,
  },
  {
    target: '[data-coach="stage"]',
    title: 'This is your video',
    body: 'What you see here is exactly what your finished video will look like. Drag things on it to move them.',
    next: 'Next',
  },
  {
    target: '[data-coach="play"]',
    title: 'Press play ▶',
    body: 'Watch what you have so far. Tap again to pause.',
    until: 'playback:played',
    next: 'Skip',
  },
  {
    target: '[data-coach="timeline"]',
    title: 'Your timeline',
    body: 'Your video from start (left) to end (right). Swipe it to move through time — the white line is the moment you are on.',
    until: 'playhead:moved',
    next: 'Got it',
  },
  {
    target: '.tl-lane.main .tl-clip',
    title: 'Tap a clip',
    body: 'Tap any clip to select it. Then you can cut it, change its look, or delete it.',
    until: 'clip:selected',
    next: 'Skip',
  },
  {
    target: '[data-coach="tool-split"]',
    title: 'Cut it in two ✂',
    body: 'Move the white line to a moment, then tap Split. Now it’s two pieces — select the one you don’t want and tap Delete.',
    until: 'clip:split',
    next: 'Skip',
  },
  {
    target: '[data-coach="tool-text"]',
    title: 'Add some words',
    body: 'Tap Text to add a title or caption, then type your words. Drag the text on the picture to move it. (On a phone, tap Done first to see all tools.)',
    until: 'text:added',
    next: 'Skip',
  },
  {
    target: '[data-coach="undo"]',
    title: 'Made a mistake? No problem',
    body: 'Undo takes back your last change — as many times as you like. Your work is also saved automatically.',
    next: 'Next',
  },
  {
    target: '[data-coach="export"]',
    title: 'Share it 🎉',
    body: 'When you’re happy, tap Export. Kinora creates a video file you can post anywhere — in full quality, with no watermark.',
    next: 'Finish',
  },
];

const PHOTO_TOUR: TourStep[] = [
  {
    title: 'Welcome to Kinora! 👋',
    body: 'Let’s make this photo look amazing. It only takes a minute.',
    next: 'Show me around',
  },
  {
    target: '[data-coach="tool-adjust"]',
    title: 'Fix the light and color',
    body: 'Tap Adjust. Try the magic “Auto-enhance” button, or move any slider. Hold the 👁 button to compare with the original.',
    until: 'adjust:changed',
    next: 'Skip',
  },
  {
    target: '[data-coach="tool-filters"]',
    title: 'Try a look',
    body: 'Filters give your photo a style with one tap. Use the Strength slider to make it subtle.',
    until: 'filter:set',
    next: 'Skip',
  },
  {
    target: '[data-coach="tool-text"]',
    title: 'Add words',
    body: 'Add a caption or title. Drag it on the photo to move it; pull a corner to resize.',
    until: 'text:added',
    next: 'Skip',
  },
  {
    target: '[data-coach="export"]',
    title: 'Save your photo',
    body: 'Export saves a full-quality copy. Your original photo is never changed.',
    next: 'Finish',
  },
];

let unsub: (() => void) | null = null;

export function startTour(kind: 'video' | 'photo'): void {
  tour.value = { steps: kind === 'photo' ? PHOTO_TOUR : VIDEO_TOUR, index: 0, flag: 'tourDone' };
  listen();
}

/** Starts a tour defined elsewhere (the 3D studio brings its own steps). */
export function startCustomTour(steps: TourStep[], flag: TourState['flag']): void {
  tour.value = { steps, index: 0, flag };
  listen();
}

function listen(): void {
  unsub?.();
  const events = new Set<keyof AppEvents>();
  for (const s of tour.peek()?.steps ?? []) if (s.until) events.add(s.until);
  const offs = [...events].map((e) =>
    on(e, () => {
      const t = tour.peek();
      if (t && t.steps[t.index]?.until === e) setTimeout(() => advance(), 350);
    }),
  );
  unsub = () => offs.forEach((f) => f());
}

export function advance(): void {
  const t = tour.peek();
  if (!t) return;
  let i = t.index + 1;
  while (i < t.steps.length && t.steps[i]!.skip?.()) i++;
  if (i >= t.steps.length) endTour();
  else tour.value = { ...t, index: i };
}

export function endTour(): void {
  const flag = tour.peek()?.flag ?? 'tourDone';
  tour.value = null;
  unsub?.();
  unsub = null;
  updateSettings({ [flag]: true });
}
