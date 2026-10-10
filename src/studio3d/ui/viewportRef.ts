/** The live viewport (menus and shortcuts call into it: framing, G/R/S, renders). */
import { computed, signal } from '@preact/signals';
import { settings } from '../../state/store';
import type { Viewport } from '../engine/viewport';

export const viewportRef: { current: Viewport | null } = { current: null };

/** Bumped when the view changes (camera frame overlay follows it). */
export const viewVersion = signal(0);

/** Right-click menu position. */
export const contextMenu3d = signal<{ x: number; y: number } | null>(null);

export const isLightTheme = computed(() => {
  const t = settings.value.theme;
  if (t !== 'system') return t === 'light';
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches;
});

/** Desktop tool rail popover (Shift+A opens the add menu). */
export const railMenu = signal<'add' | 'magic' | null>(null);
