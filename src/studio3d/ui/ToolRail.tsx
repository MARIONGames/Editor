import {
  ArrowDownToLine,
  Box,
  Check,
  Clapperboard,
  Gamepad2,
  Layers,
  MousePointer2,
  Move,
  Orbit,
  Palette,
  Plus,
  Rotate3d,
  Scale3d,
  Scissors,
  Sparkles,
  SlidersHorizontal,
  SquareDashedMousePointer,
  Sun,
  Trash2,
  WandSparkles,
} from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import type { Tool3D } from '../engine/viewport';
import { autoLight, turntable } from '../magic3d';
import {
  deleteSelected,
  dropToFloor,
  enterEditMode,
  exitEditMode,
  extrude,
  inset,
  bevel,
  loopCutSelected,
  setSelectMode,
} from '../state/actions3d';
import {
  dialog3d,
  mode3d,
  selection3d,
  selectMode,
  sheet3d,
  tab3d,
  tool3d,
  type Tab3D,
} from '../state/store3d';
import { AddMenu } from './AddMenu';
import { railMenu, viewportRef } from './viewportRef';

export const TOOLS: { id: Tool3D; label: string; icon: LucideIcon; key: string; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    icon: MousePointer2,
    key: 'W',
    hint: 'Click to pick, drag a box to pick many',
  },
  {
    id: 'move',
    label: 'Move',
    icon: Move,
    key: 'G',
    hint: 'Drag the arrows to move along one direction',
  },
  { id: 'rotate', label: 'Rotate', icon: Rotate3d, key: 'R', hint: 'Drag the rings to turn it' },
  {
    id: 'scale',
    label: 'Scale',
    icon: Scale3d,
    key: 'S',
    hint: 'Drag to make it bigger or smaller',
  },
];

/** Desktop: the vertical tool rail on the left. */
export function ToolRail() {
  const menu = railMenu.value;
  const setMenu = (m: 'add' | 'magic' | null) => (railMenu.value = m);
  const tool = tool3d.value;
  return (
    <nav class="tooldock vertical tool-rail" aria-label="Tools">
      <div class="tooldock-items">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            class={`tool ${tool === t.id ? 'active' : ''}`}
            title={`${t.label} (${t.key}) — ${t.hint}`}
            aria-pressed={tool === t.id}
            data-coach={`tool-${t.id}`}
            onClick={() => (tool3d.value = t.id)}
          >
            <span class="tool-icon">
              <t.icon size={22} />
            </span>
            <span class="tool-label">{t.label}</span>
          </button>
        ))}
        <div class="rail-sep" />
        <button
          class={`tool ${menu === 'add' ? 'active' : ''}`}
          title="Add a shape, light or camera (Shift+A)"
          data-coach="add3d"
          onClick={() => setMenu(menu === 'add' ? null : 'add')}
        >
          <span class="tool-icon add-plus">
            <Plus size={22} />
          </span>
          <span class="tool-label">Add</span>
        </button>
        <button
          class={`tool magic ${menu === 'magic' ? 'active' : ''}`}
          title="One-tap helpers"
          onClick={() => setMenu(menu === 'magic' ? null : 'magic')}
        >
          <span class="tool-icon">
            <WandSparkles size={20} />
          </span>
          <span class="tool-label">Magic</span>
        </button>
      </div>
      {menu && (
        <div class="rail-pop" onPointerLeave={() => setMenu(null)}>
          {menu === 'add' ? (
            <AddMenu onDone={() => setMenu(null)} />
          ) : (
            <MagicMenu onDone={() => setMenu(null)} />
          )}
        </div>
      )}
    </nav>
  );
}

export function MagicMenu(props: { onDone?: () => void }) {
  const done = () => props.onDone?.();
  const items: { icon: LucideIcon; title: string; text: string; run: () => void }[] = [
    {
      icon: Sun,
      title: 'Light it beautifully',
      text: 'Adds a soft three-light studio setup around your model',
      run: autoLight,
    },
    {
      icon: Orbit,
      title: 'Turntable',
      text: 'One slow turn of the selection — the classic way to show a model',
      run: turntable,
    },
    {
      icon: ArrowDownToLine,
      title: 'Put on the floor',
      text: 'Moves the selection down until it rests on the ground',
      run: dropToFloor,
    },
    {
      icon: Gamepad2,
      title: 'Game-ready check',
      text: 'Polygons, triangles, UVs and scale — ready for Unity, Unreal or Godot?',
      run: () => (dialog3d.value = { type: 'game-check' }),
    },
  ];
  return (
    <div class="magic-menu">
      {items.map((it) => (
        <button
          key={it.title}
          class="magic-item"
          onClick={() => {
            it.run();
            done();
          }}
        >
          <it.icon size={20} />
          <span>
            <strong>{it.title}</strong>
            <small>{it.text}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Phone: the bottom tool bar (changes in edit mode). */
export function BottomDock3D() {
  const editing = mode3d.value === 'edit';
  const tool = tool3d.value;
  const hasSel = selection3d.value.ids.length > 0;
  const openTab = (t: Tab3D) => {
    tab3d.value = t;
    sheet3d.value = 'props';
  };
  if (editing) {
    const sm = selectMode.value;
    return (
      <nav class="tooldock horizontal dock3d" aria-label="Edit tools">
        <div class="tooldock-items scroll-x">
          <DockBtn icon={Check} label="Done" cls="done" onClick={() => exitEditMode()} />
          <DockBtn
            icon={SquareDashedMousePointer}
            label={sm === 'vert' ? 'Points' : sm === 'edge' ? 'Edges' : 'Faces'}
            onClick={() => setSelectMode(sm === 'vert' ? 'edge' : sm === 'edge' ? 'face' : 'vert')}
          />
          <DockBtn
            icon={
              tool === 'move'
                ? Move
                : tool === 'rotate'
                  ? Rotate3d
                  : tool === 'scale'
                    ? Scale3d
                    : MousePointer2
            }
            label={TOOLS.find((t) => t.id === tool)!.label}
            onClick={() => (tool3d.value = nextTool(tool))}
          />
          <DockBtn icon={Box} label="Pull out" onClick={() => extrude()} />
          <DockBtn icon={Layers} label="Inset" onClick={() => inset()} />
          <DockBtn icon={Sparkles} label="Round" onClick={() => bevel()} />
          <DockBtn icon={Scissors} label="Cut loop" onClick={() => loopCutSelected()} />
          <DockBtn icon={Trash2} label="Delete" cls="danger" onClick={() => deleteSelected()} />
          <DockBtn icon={SlidersHorizontal} label="More" onClick={() => (sheet3d.value = 'edit')} />
        </div>
      </nav>
    );
  }
  return (
    <nav class="tooldock horizontal dock3d" aria-label="Tools">
      <div class="tooldock-items scroll-x">
        <DockBtn
          icon={Plus}
          label="Add"
          cls="add"
          coach="add3d"
          onClick={() => (sheet3d.value = 'add')}
        />
        <DockBtn
          icon={
            tool === 'move'
              ? Move
              : tool === 'rotate'
                ? Rotate3d
                : tool === 'scale'
                  ? Scale3d
                  : MousePointer2
          }
          label={TOOLS.find((t) => t.id === tool)!.label}
          onClick={() => (tool3d.value = nextTool(tool))}
        />
        <DockBtn icon={Box} label="Shape" disabled={!hasSel} onClick={() => enterEditMode()} />
        <DockBtn icon={Palette} label="Looks" coach="looks3d" onClick={() => openTab('material')} />
        <DockBtn icon={Clapperboard} label="Animate" onClick={() => openTab('animate')} />
        <DockBtn icon={Layers} label="Objects" onClick={() => (sheet3d.value = 'outliner')} />
        <DockBtn
          icon={WandSparkles}
          label="Magic"
          cls="magic"
          onClick={() => (sheet3d.value = 'magic')}
        />
        <DockBtn icon={SlidersHorizontal} label="More" onClick={() => openTab(tab3d.peek())} />
        <DockBtn
          icon={Orbit}
          label="Frame"
          onClick={() =>
            viewportRef.current?.frame(
              selection3d.peek().ids.length ? selection3d.peek().ids : undefined,
            )
          }
        />
      </div>
    </nav>
  );
}

function nextTool(t: Tool3D): Tool3D {
  return t === 'move' ? 'rotate' : t === 'rotate' ? 'scale' : t === 'scale' ? 'select' : 'move';
}

function DockBtn(props: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  cls?: string;
  disabled?: boolean;
  coach?: string;
}) {
  return (
    <button
      class={`tool ${props.cls ?? ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      data-coach={props.coach}
    >
      <span class="tool-icon">
        <props.icon size={22} />
      </span>
      <span class="tool-label">{props.label}</span>
    </button>
  );
}
