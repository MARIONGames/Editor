import { useEffect } from 'preact/hooks';
import { startDuplicateMove } from './shortcuts3d';
import {
  applyTransforms,
  bevel,
  clearParent,
  deleteSelected,
  dropToFloor,
  enterEditMode,
  exitEditMode,
  extrude,
  fill,
  hideSelected,
  inset,
  joinSelected,
  loopCutSelected,
  mergeCenter,
  parentSelected,
  recalculateNormals,
  setOriginTo,
  subdivide,
} from '../state/actions3d';
import { mode3d, selection3d } from '../state/store3d';
import { contextMenu3d, viewportRef } from './viewportRef';

interface Item {
  label: string;
  key?: string;
  run: () => void;
  danger?: boolean;
}

export function ContextMenu3D() {
  const pos = contextMenu3d.value;
  useEffect(() => {
    if (!pos) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && (contextMenu3d.value = null);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [pos]);
  if (!pos) return null;
  const editing = mode3d.value === 'edit';
  const sel = selection3d.value.ids;
  const items: Item[] = editing
    ? [
        { label: 'Pull out (extrude)', key: 'E', run: () => extrude() },
        { label: 'Inset', key: 'I', run: () => inset() },
        { label: 'Round edges (bevel)', key: 'Ctrl+B', run: () => bevel() },
        { label: 'Add loop (loop cut)', key: 'Ctrl+R', run: () => loopCutSelected() },
        { label: 'Subdivide', run: () => subdivide() },
        { label: 'Merge at center', key: 'M', run: () => mergeCenter() },
        { label: 'Fill hole', key: 'F', run: () => fill() },
        { label: 'Fix inside-out faces', key: 'Shift+N', run: () => recalculateNormals() },
        { label: 'Delete', key: 'X', run: () => deleteSelected(), danger: true },
        { label: 'Back to objects', key: 'Tab', run: () => exitEditMode() },
      ]
    : sel.length
      ? [
          { label: 'Edit shape', key: 'Tab', run: () => enterEditMode() },
          { label: 'Copy', key: 'Shift+D', run: () => startDuplicateMove(false) },
          {
            label: 'Linked copy (shares the shape)',
            key: 'Alt+D',
            run: () => startDuplicateMove(true),
          },
          { label: 'Put on the floor', run: () => dropToFloor() },
          { label: 'Frame it', key: 'F', run: () => viewportRef.current?.frame(sel) },
          ...(sel.length > 1
            ? [
                { label: 'Join into one', key: 'Ctrl+J', run: () => joinSelected() },
                {
                  label: 'Make the last one the parent',
                  key: 'Ctrl+P',
                  run: () => parentSelected(),
                },
              ]
            : []),
          { label: 'Unlink from parent', key: 'Alt+P', run: () => clearParent() },
          { label: 'Pivot to center', run: () => setOriginTo('geometry') },
          { label: 'Apply size & rotation', key: 'Ctrl+A', run: () => applyTransforms() },
          { label: 'Hide', key: 'H', run: () => hideSelected() },
          { label: 'Delete', key: 'X', run: () => deleteSelected(), danger: true },
        ]
      : [{ label: 'Frame everything', key: 'Home', run: () => viewportRef.current?.frame() }];
  const x = Math.min(pos.x, window.innerWidth - 250);
  const y = Math.min(pos.y, window.innerHeight - items.length * 38 - 20);
  return (
    <div
      class="ctx-backdrop"
      onPointerDown={() => (contextMenu3d.value = null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        class="menu ctx-menu"
        style={{ left: `${x}px`, top: `${Math.max(8, y)}px` }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {items.map((it) => (
          <button
            key={it.label}
            class={it.danger ? 'danger' : ''}
            onClick={() => {
              contextMenu3d.value = null;
              it.run();
            }}
          >
            <span class="grow">{it.label}</span>
            {it.key && <kbd class="kbd">{it.key}</kbd>}
          </button>
        ))}
      </div>
    </div>
  );
}
