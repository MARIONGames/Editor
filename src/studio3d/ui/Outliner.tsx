import { useState } from 'preact/hooks';
import {
  Box,
  Camera,
  Eye,
  EyeOff,
  Lamp,
  Lightbulb,
  LocateFixed,
  Lock,
  LockOpen,
  PersonStanding,
  Square,
  Sun,
} from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { outlinerRows } from '../model/scene';
import type { Obj3D } from '../model/types';
import { renameObject, selectObjects, toggleLocked, toggleVisible } from '../state/actions3d';
import { scene3d, selection3d } from '../state/store3d';

function iconOf(o: Obj3D): LucideIcon {
  if (o.kind === 'mesh') return Box;
  if (o.kind === 'camera') return Camera;
  if (o.kind === 'empty') return LocateFixed;
  if (o.kind === 'model') return PersonStanding;
  return o.light.type === 'sun'
    ? Sun
    : o.light.type === 'point'
      ? Lightbulb
      : o.light.type === 'spot'
        ? Lamp
        : Square;
}

/** The list of everything in the scene (children indented under their parents). */
export function Outliner(props: { embedded?: boolean }) {
  const s = scene3d.value;
  const sel = selection3d.value;
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!s) return null;
  const rows = outlinerRows(s);
  const selected = new Set(sel.ids);
  return (
    <section
      class={`outliner ${props.embedded ? 'embedded' : ''}`}
      aria-label="Objects in the scene"
      data-coach="outliner3d"
    >
      {!props.embedded && (
        <div class="side-head">
          <strong>Scene</strong>
          <span class="faint">
            {rows.length} item{rows.length === 1 ? '' : 's'}
          </span>
        </div>
      )}
      <div class="outliner-list scroll-y" role="tree">
        {rows.map(({ id, depth }) => {
          const o = s.objects[id]!;
          const Icon = iconOf(o);
          const isSel = selected.has(id);
          return (
            <div
              key={id}
              role="treeitem"
              aria-selected={isSel}
              class={`ol-row ${isSel ? 'sel' : ''} ${sel.active === id ? 'active' : ''} ${o.visible ? '' : 'hidden-obj'} kind-${o.kind}`}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
              onClick={(e) =>
                selectObjects(
                  [id],
                  e.shiftKey ? 'toggle' : e.ctrlKey || e.metaKey ? 'toggle' : 'set',
                )
              }
              onDblClick={() => setRenaming(id)}
            >
              <Icon size={15} class="ol-icon" />
              {renaming === id ? (
                <input
                  class="input ol-input"
                  autoFocus
                  value={o.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    renameObject(id, (e.target as HTMLInputElement).value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span class="ol-name">
                  {o.name}
                  {s.render.camera === id && <span class="ol-tag">render</span>}
                  {o.anim && <span class="ol-tag anim">animated</span>}
                </span>
              )}
              <button
                class="ol-btn"
                aria-label={o.locked ? `Unlock ${o.name}` : `Lock ${o.name}`}
                title={
                  o.locked
                    ? 'Locked: can’t be selected in the view'
                    : 'Lock (stops accidental clicks)'
                }
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLocked(id);
                }}
              >
                {o.locked ? <Lock size={14} /> : <LockOpen size={14} class="dim" />}
              </button>
              <button
                class="ol-btn"
                aria-label={o.visible ? `Hide ${o.name}` : `Show ${o.name}`}
                title={o.visible ? 'Hide (H)' : 'Show'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleVisible(id);
                }}
              >
                {o.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </div>
          );
        })}
        {!rows.length && (
          <p class="faint ol-empty">Your scene is empty. Tap Add to put in a shape.</p>
        )}
      </div>
    </section>
  );
}
