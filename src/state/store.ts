import { batch, computed, signal } from '@preact/signals';
import { findClip, projectDuration } from '../model/ops';
import type { Clip, ID, Project } from '../model/types';
import { History } from './history';

/* ------------------------------------------------------------------ routes */

export type Route =
  | { name: 'home' }
  | { name: 'editor'; projectId: string }
  | { name: 'studio3d'; sceneId: string };

export const route = signal<Route>({ name: 'home' });

/* ----------------------------------------------------------------- project */

export const project = signal<Project | null>(null);
export const selectionId = signal<ID | null>(null);
export const history = new History();
/** Bumped whenever the history stacks change (drives undo/redo buttons). */
export const historyVersion = signal(0);

export const selectedClip = computed<Clip | null>(() => {
  const p = project.value;
  return p ? (findClip(p, selectionId.value)?.clip ?? null) : null;
});

export const duration = computed(() => (project.value ? projectDuration(project.value) : 0));

export const canUndo = computed(() => (historyVersion.value, history.past.length > 0));
export const canRedo = computed(() => (historyVersion.value, history.future.length > 0));

/* ---------------------------------------------------------------- playback */

/** Current time in seconds. */
export const playhead = signal(0);
export const playing = signal(false);
/** Hold to compare with the original (no effects). */
export const compareOriginal = signal(false);

/* -------------------------------------------------------------------- view */

/** Timeline zoom in pixels per second. */
export const zoom = signal(90);
export type PanelId =
  | 'media'
  | 'text'
  | 'stickers'
  | 'music'
  | 'adjust'
  | 'filters'
  | 'transition'
  | 'animation'
  | 'speed'
  | 'volume'
  | 'crop'
  | 'transform'
  | 'canvas'
  | 'magic'
  | 'layers'
  | 'greenscreen'
  | 'shape';

export const panel = signal<PanelId | null>(null);
/** Text clip being typed in (shows the keyboard-friendly editor). */
export const editingTextId = signal<ID | null>(null);

export const viewport = signal({
  w: typeof window !== 'undefined' ? window.innerWidth : 1280,
  h: typeof window !== 'undefined' ? window.innerHeight : 800,
});
/** Phone-style layout (bottom sheets, bottom tool bar). */
export const isCompact = computed(() => viewport.value.w < 900);

if (typeof window !== 'undefined') {
  const update = () => (viewport.value = { w: window.innerWidth, h: window.innerHeight });
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
}

/* ------------------------------------------------------------------ toasts */

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

export const toasts = signal<Toast[]>([]);
let toastSeq = 1;

export function toast(
  message: string,
  kind: Toast['kind'] = 'info',
  action?: Toast['action'],
  ms = 3500,
): void {
  const t: Toast = { id: toastSeq++, message, kind, action };
  toasts.value = [...toasts.value.slice(-2), t];
  setTimeout(() => dismissToast(t.id), action ? ms + 2500 : ms);
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/** Long-running work (imports, analysis). */
export interface BusyState {
  message: string;
  /** 0..1, or null for indeterminate. */
  progress: number | null;
  cancel?: () => void;
}
export const busy = signal<BusyState | null>(null);

/* ---------------------------------------------------------------- settings */

export interface Settings {
  theme: 'system' | 'dark' | 'light';
  hints: boolean;
  /** Show advanced controls everywhere. */
  pro: boolean;
  tourDone: boolean;
  /** The 3D studio has its own first-time tour. */
  tour3dDone: boolean;
  checklistHidden: boolean;
}

const SETTINGS_KEY = 'kinora.settings';

function loadSettings(): Settings {
  const defaults: Settings = {
    theme: 'system',
    hints: true,
    pro: false,
    tourDone: false,
    tour3dDone: false,
    checklistHidden: false,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

export const settings = signal<Settings>(loadSettings());

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value));
  } catch {
    /* private mode: settings just won't persist */
  }
}

/* ------------------------------------------------------------------- reset */

export function resetEditorState(p: Project | null): void {
  batch(() => {
    project.value = p;
    selectionId.value = null;
    playhead.value = 0;
    playing.value = false;
    panel.value = null;
    editingTextId.value = null;
    compareOriginal.value = false;
    history.clear();
    historyVersion.value++;
  });
}
