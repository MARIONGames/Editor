/**
 * State of the 3D studio. Like the 2D editor, the scene is an immutable value in a
 * signal; every edit replaces it and the old value is the undo step.
 */
import { batch, computed, signal } from '@preact/signals';
import { History } from '../../state/history';
import { emptySelection, type MeshSelection, type SelectMode } from '../model/meshOps';
import type { ID, Obj3D, Scene3D } from '../model/types';
import type { SnapSettings } from '../engine/modal';
import type { Orientation, PivotMode } from '../engine/transform';
import type { Mode3D, Overlays, Shading, Tool3D } from '../engine/viewport';

export interface Selection3D {
  ids: ID[];
  active: ID | null;
}

/** What undo restores besides the scene itself. */
export interface UndoState {
  sel: Selection3D;
  mode: Mode3D;
  edit: MeshSelection;
}

export const scene3d = signal<Scene3D | null>(null);
export const selection3d = signal<Selection3D>({ ids: [], active: null });
export const mode3d = signal<Mode3D>('object');
export const editSel = signal<MeshSelection>(emptySelection());
export const selectMode = signal<SelectMode>('vert');

export const time3d = signal(0);
export const playing3d = signal(false);
/** Every change at the current time becomes a keyframe. */
export const autoKey = signal(false);

export const shading = signal<Shading>('rendered');
export const overlays = signal<Overlays>({ grid: true, wire: false, xray: false, helpers: true });
export const tool3d = signal<Tool3D>('move');
export const snap3d = signal<SnapSettings>({ on: false, move: 0.25, rotate: 15, scale: 0.1 });
export const orientation = signal<Orientation>('global');
export const pivotMode = signal<PivotMode>('median');
/** Looking through the scene camera (numpad 0). */
export const lookThrough = signal(false);
export const orthoView = signal(false);
/** Header text while G/R/S runs. */
export const modalStatus = signal<string | null>(null);

export const history3d = new History<Scene3D, UndoState>();
export const historyVersion3d = signal(0);
export const canUndo3d = computed(() => (historyVersion3d.value, history3d.past.length > 0));
export const canRedo3d = computed(() => (historyVersion3d.value, history3d.future.length > 0));

export type Tab3D = 'object' | 'material' | 'modifiers' | 'animate' | 'world' | 'render';
export const tab3d = signal<Tab3D>('object');
/** Phone layout: which sheet is open. */
export type Sheet3D = 'add' | 'outliner' | 'props' | 'edit' | 'magic' | null;
export const sheet3d = signal<Sheet3D>(null);

/**
 * "Adjust last operation": the last tool you used can be re-run with different numbers
 * (like Blender's redo panel) until you do something else.
 */
export interface LastOp {
  label: string;
  params: Record<string, number>;
  fields: { key: string; label: string; min: number; max: number; step: number; unit?: string }[];
  /** Re-runs the operation on `before` with new params. */
  run: (
    params: Record<string, number>,
  ) => { scene: Scene3D; edit?: MeshSelection; sel?: Selection3D } | null;
}
export const lastOp = signal<LastOp | null>(null);

export const activeObject = computed<Obj3D | null>(() => {
  const s = scene3d.value;
  const a = selection3d.value.active;
  return s && a ? (s.objects[a] ?? null) : null;
});

export const selectedObjects = computed<Obj3D[]>(() => {
  const s = scene3d.value;
  if (!s) return [];
  return selection3d.value.ids.map((id) => s.objects[id]).filter((o): o is Obj3D => !!o);
});

export function resetStudioState(s: Scene3D | null): void {
  batch(() => {
    scene3d.value = s;
    selection3d.value = { ids: [], active: null };
    mode3d.value = 'object';
    editSel.value = emptySelection();
    time3d.value = s?.anim.start ?? 0;
    playing3d.value = false;
    lookThrough.value = false;
    modalStatus.value = null;
    lastOp.value = null;
    sheet3d.value = null;
    history3d.clear();
    historyVersion3d.value++;
  });
}

/** Dialogs of the 3D studio. */
export type Dialog3D = { type: 'export' } | { type: 'keymap' } | { type: 'game-check' } | null;
export const dialog3d = signal<Dialog3D>(null);
