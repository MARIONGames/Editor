/**
 * Keyboard shortcuts of the 3D studio. They follow Blender wherever it makes sense, so
 * people coming from Blender feel at home; every one of them also has a button.
 */
import { Vector3 } from 'three';
import { useEffect } from 'preact/hooks';
import { isCompact, toast } from '../../state/store';
import {
  applyTransforms,
  bevel,
  cameraToView,
  clearParent,
  clearTransform,
  deleteKeysAtTime,
  deleteSelected,
  duplicateForMove,
  duplicateSelected,
  editGrow,
  editInvert,
  editSelectAll,
  editSelectLinked,
  exitEditMode,
  extrudeForMove,
  finish3d,
  fill,
  hideSelected,
  insertKeys,
  inset,
  invertObjectSelection,
  joinSelected,
  loopCutSelected,
  mergeCenter,
  parentSelected,
  quadsFromTris,
  recalculateNormals,
  redo3d,
  selectAllObjects,
  separateSelected,
  setSelectMode,
  setTime,
  toggleEditMode,
  togglePlay,
  triangulateSelected,
  undo3d,
  unhideAll,
} from '../state/actions3d';
import { allKeyTimes } from '../state/actions3d';
import {
  dialog3d,
  editSel,
  lookThrough,
  mode3d,
  orthoView,
  overlays,
  scene3d,
  selection3d,
  shading,
  sheet3d,
  time3d,
  tool3d,
} from '../state/store3d';
import { contextMenu3d, railMenu, viewportRef } from './viewportRef';

export const KEYMAP3D: { group: string; keys: string[]; what: string }[] = [
  { group: 'View', keys: ['Drag'], what: 'Look around (orbit). Middle mouse works too' },
  { group: 'View', keys: ['Right-drag'], what: 'Slide the view (pan). Shift + middle mouse too' },
  { group: 'View', keys: ['Wheel'], what: 'Zoom towards the mouse' },
  { group: 'View', keys: ['Home'], what: 'Frame everything' },
  { group: 'View', keys: ['F'], what: 'Frame the selection (objects)' },
  {
    group: 'View',
    keys: ['Numpad 1 / 3 / 7'],
    what: 'Front / right / top view (Ctrl = opposite side)',
  },
  { group: 'View', keys: ['Numpad 5'], what: 'Flat view without perspective' },
  { group: 'View', keys: ['Numpad 0'], what: 'Look through the camera' },
  { group: 'View', keys: ['Ctrl', 'Alt', 'Numpad 0'], what: 'Move the camera to this view' },
  { group: 'View', keys: ['Z'], what: 'Next view style (Clay → Look → Final)' },
  { group: 'View', keys: ['Alt', 'Z'], what: 'X-ray' },
  { group: 'Objects', keys: ['Click'], what: 'Select (Shift = add/remove)' },
  { group: 'Objects', keys: ['B'], what: 'Box select' },
  { group: 'Objects', keys: ['A'], what: 'Select all / none' },
  { group: 'Objects', keys: ['Ctrl', 'I'], what: 'Invert selection' },
  { group: 'Objects', keys: ['Shift', 'A'], what: 'Add menu' },
  { group: 'Objects', keys: ['G'], what: 'Move with the mouse (then X/Y/Z, a number, Enter)' },
  { group: 'Objects', keys: ['R'], what: 'Rotate with the mouse' },
  { group: 'Objects', keys: ['S'], what: 'Scale with the mouse' },
  { group: 'Objects', keys: ['Alt', 'G / R / S'], what: 'Reset position / rotation / scale' },
  { group: 'Objects', keys: ['Shift', 'D'], what: 'Copy and move' },
  { group: 'Objects', keys: ['Alt', 'D'], what: 'Linked copy (shares the shape)' },
  { group: 'Objects', keys: ['X'], what: 'Delete' },
  { group: 'Objects', keys: ['H'], what: 'Hide (Alt+H shows all, Shift+H hides the rest)' },
  { group: 'Objects', keys: ['Ctrl', 'J'], what: 'Join into one' },
  { group: 'Objects', keys: ['Ctrl', 'P'], what: 'Parent to the active object (Alt+P unlinks)' },
  { group: 'Objects', keys: ['Ctrl', 'A'], what: 'Apply size & rotation' },
  { group: 'Objects', keys: ['W'], what: 'Select tool (no gizmo)' },
  { group: 'Edit shape', keys: ['Tab'], what: 'Edit shape / back to objects' },
  { group: 'Edit shape', keys: ['1 / 2 / 3'], what: 'Select points / edges / faces' },
  { group: 'Edit shape', keys: ['E'], what: 'Pull out (extrude) and move' },
  { group: 'Edit shape', keys: ['I'], what: 'Inset' },
  { group: 'Edit shape', keys: ['Ctrl', 'B'], what: 'Round edges (bevel)' },
  { group: 'Edit shape', keys: ['Ctrl', 'R'], what: 'Loop cut' },
  { group: 'Edit shape', keys: ['M'], what: 'Merge at center' },
  { group: 'Edit shape', keys: ['F'], what: 'Fill hole' },
  { group: 'Edit shape', keys: ['L'], what: 'Select connected (Ctrl+L)' },
  { group: 'Edit shape', keys: ['Ctrl', '+ / −'], what: 'Grow / shrink selection' },
  { group: 'Edit shape', keys: ['Shift', 'N'], what: 'Fix inside-out faces' },
  { group: 'Edit shape', keys: ['Ctrl', 'T'], what: 'Triangulate (Alt+J: back to quads)' },
  { group: 'Edit shape', keys: ['P'], what: 'Separate into a new object' },
  { group: 'Animate', keys: ['Space'], what: 'Play / pause' },
  { group: 'Animate', keys: ['I'], what: 'Add keyframe (objects)' },
  { group: 'Animate', keys: ['Alt', 'I'], what: 'Remove keyframe' },
  { group: 'Animate', keys: ['← / →'], what: 'One frame back / forward' },
  { group: 'Animate', keys: ['↑ / ↓'], what: 'Next / previous keyframe' },
  { group: 'Animate', keys: ['Shift', '← / →'], what: 'Start / end' },
  { group: 'General', keys: ['Ctrl', 'Z'], what: 'Undo (Ctrl+Shift+Z: redo)' },
  { group: 'General', keys: ['?'], what: 'This list' },
];

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/** Shift+D / Alt+D: copy, then move it with the mouse (Esc keeps the copy in place). */
export function startDuplicateMove(linked: boolean): void {
  const vp = viewportRef.current;
  if (!vp) {
    duplicateSelected(linked);
    return;
  }
  const r = duplicateForMove(linked);
  if (!r) return;
  const label = linked ? 'Linked copy' : 'Copy';
  if (!vp.startModal('move', { before: r.before, base: r.base, label, cancelTo: 'base' }))
    finish3d(label, r.before, r.base);
}

function modal(kind: 'move' | 'rotate' | 'scale'): void {
  const vp = viewportRef.current;
  if (!vp) return;
  const ok = vp.startModal(kind);
  if (!ok)
    toast(
      mode3d.peek() === 'edit'
        ? 'Select some points, edges or faces first.'
        : 'Select something first (click it).',
      'info',
    );
}

export function useStudioShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e) || dialog3d.peek()) return;
      const vp = viewportRef.current;
      if (vp?.modalActive) return;
      const k = e.key;
      const lower = k.length === 1 ? k.toLowerCase() : k;
      const ctrl = e.ctrlKey || e.metaKey;
      const editing = mode3d.peek() === 'edit';
      const code = e.code;
      let handled = true;

      if (ctrl && lower === 'z') e.shiftKey ? redo3d() : undo3d();
      else if (ctrl && lower === 'y') redo3d();
      else if (ctrl && lower === 's')
        toast('Kinora saves automatically on this device.', 'success');
      else if (k === 'Escape') {
        if (contextMenu3d.peek()) contextMenu3d.value = null;
        else if (railMenu.peek()) railMenu.value = null;
        else if (sheet3d.peek()) sheet3d.value = null;
        else if (lookThrough.peek()) lookThrough.value = false;
        else handled = false;
      } else if (k === 'Tab') toggleEditMode();
      else if (k === '?' || k === 'F1') dialog3d.value = { type: 'keymap' };
      // ---------------------------------------------------------- view
      else if (code === 'Numpad0' && ctrl && e.altKey) vp && cameraToView(vp.viewTransform());
      else if (code === 'Numpad0') lookThrough.value = !lookThrough.peek();
      else if (code === 'Numpad1') vp?.viewAxis(ctrl ? 'back' : 'front');
      else if (code === 'Numpad3') vp?.viewAxis(ctrl ? 'left' : 'right');
      else if (code === 'Numpad7') vp?.viewAxis(ctrl ? 'bottom' : 'top');
      else if (code === 'Numpad5') orthoView.value = !orthoView.peek();
      else if (code === 'NumpadDecimal')
        vp?.frame(selection3d.peek().ids.length ? selection3d.peek().ids : undefined);
      else if (k === 'Home') vp?.frame();
      else if (lower === 'z' && e.altKey)
        overlays.value = { ...overlays.peek(), xray: !overlays.peek().xray };
      else if (lower === 'z' && !ctrl)
        shading.value =
          shading.peek() === 'solid'
            ? 'material'
            : shading.peek() === 'material'
              ? 'rendered'
              : 'solid';
      // ---------------------------------------------------- animation
      else if (k === ' ') togglePlay();
      else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const s = scene3d.peek();
        if (!s) return;
        if (e.shiftKey) setTime(k === 'ArrowLeft' ? s.anim.start : s.anim.end);
        else setTime(time3d.peek() + (k === 'ArrowLeft' ? -1 : 1) / s.render.fps);
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        const times = allKeyTimes(
          selection3d.peek().ids.length ? selection3d.peek().ids : (scene3d.peek()?.order ?? []),
        );
        const t = time3d.peek();
        const next =
          k === 'ArrowUp'
            ? times.find((x) => x > t + 1e-4)
            : [...times].reverse().find((x) => x < t - 1e-4);
        if (next !== undefined) setTime(next);
      }
      // ------------------------------------------------------ editing
      else if (editing) handled = editKey(e, lower, ctrl);
      else handled = objectKey(e, lower, ctrl);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function common(lower: string, e: KeyboardEvent, ctrl: boolean): boolean | null {
  if (lower === 'g' && !ctrl && !e.altKey) modal('move');
  else if (lower === 'r' && !ctrl && !e.altKey) modal('rotate');
  else if (lower === 's' && !ctrl && !e.altKey) modal('scale');
  else if (lower === 'b' && !ctrl) viewportRef.current?.armBoxSelect();
  else if (lower === 'w' && !ctrl) tool3d.value = 'select';
  else if (lower === 'a' && e.shiftKey && !ctrl) {
    if (isCompact.peek()) sheet3d.value = 'add';
    else railMenu.value = railMenu.peek() === 'add' ? null : 'add';
  } else return null;
  return true;
}

function objectKey(e: KeyboardEvent, lower: string, ctrl: boolean): boolean {
  if (e.altKey && (lower === 'g' || lower === 'r' || lower === 's')) {
    clearTransform(lower === 'g' ? 'p' : lower === 'r' ? 'r' : 's');
    return true;
  }
  const c = common(lower, e, ctrl);
  if (c) return true;
  if (lower === 'x' || e.key === 'Delete') deleteSelected();
  else if (lower === 'd' && e.shiftKey) startDuplicateMove(false);
  else if (lower === 'd' && e.altKey) startDuplicateMove(true);
  else if (lower === 'h' && e.altKey) unhideAll();
  else if (lower === 'h' && e.shiftKey) hideSelected(true);
  else if (lower === 'h') hideSelected();
  else if (lower === 'a' && e.altKey) selectAllObjects(true);
  else if (lower === 'a' && !ctrl) selectAllObjects(true);
  else if (lower === 'i' && ctrl) invertObjectSelection();
  else if (lower === 'i' && e.altKey) deleteKeysAtTime();
  else if (lower === 'i') insertKeys();
  else if (lower === 'j' && ctrl) joinSelected();
  else if (lower === 'p' && ctrl) parentSelected();
  else if (lower === 'p' && e.altKey) clearParent();
  else if (lower === 'a' && ctrl) applyTransforms();
  else if (lower === 'f' && !ctrl)
    viewportRef.current?.frame(selection3d.peek().ids.length ? selection3d.peek().ids : undefined);
  else return false;
  return true;
}

function editKey(e: KeyboardEvent, lower: string, ctrl: boolean): boolean {
  const c = common(lower, e, ctrl);
  if (c) return true;
  if (lower === '1' && !ctrl) setSelectMode('vert');
  else if (lower === '2' && !ctrl) setSelectMode('edge');
  else if (lower === '3' && !ctrl) setSelectMode('face');
  else if (lower === 'x' || e.key === 'Delete') deleteSelected();
  else if (lower === 'e' && !ctrl) extrudeAndMove();
  else if (lower === 'i' && ctrl) editInvert();
  else if (lower === 'i') inset();
  else if (lower === 'b' && ctrl) bevel();
  else if (lower === 'r' && ctrl) loopCutSelected();
  else if (lower === 'm') mergeCenter();
  else if (lower === 'f') fill();
  else if (lower === 'l') editSelectLinked();
  else if (lower === 'a' && e.altKey) editSelectAll(true);
  else if (lower === 'a') editSelectAll(true);
  else if (ctrl && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) editGrow(true);
  else if (ctrl && (e.key === '-' || e.code === 'NumpadSubtract')) editGrow(false);
  else if (lower === 'n' && e.shiftKey) recalculateNormals();
  else if (lower === 't' && ctrl) triangulateSelected();
  else if (lower === 'j' && e.altKey) quadsFromTris();
  else if (lower === 'p') separateSelected();
  else if (lower === 'h' && e.altKey) unhideAll();
  else if (e.key === 'Escape') exitEditMode();
  else return false;
  return true;
}

/** E: extrude, then follow the mouse along the face normal (one undo step). */
function extrudeAndMove(): void {
  const vp = viewportRef.current;
  const r = extrudeForMove();
  if (!vp || !r) {
    toast('Select faces or edges to pull out.', 'info');
    return;
  }
  const n = new Vector3(...r.normal);
  const restore = () => {
    scene3d.value = r.before;
    editSel.value = r.sel;
  };
  const ok = vp.startModal('move', {
    before: r.before,
    base: r.base,
    label: 'Extrude',
    axis: n.lengthSq() > 1e-9 ? n : undefined,
    axisName: 'normal',
    onCancel: restore,
  });
  if (!ok) restore();
}
