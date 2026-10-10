import type { LucideIcon } from 'lucide-preact';
import {
  ArrowLeftRight,
  Blend,
  Box,
  Combine,
  Expand,
  FlipHorizontal,
  Grid2x2,
  Layers,
  Merge,
  RefreshCw,
  Scissors,
  Shrink,
  Slice,
  Sparkles,
  SquareDashed,
  Trash2,
  Triangle,
  Ungroup,
  Waypoints,
} from 'lucide-preact';
import type { SelectMode } from '../model/meshOps';
import {
  bevel,
  deleteElements,
  dissolve,
  editGrow,
  editInvert,
  editSelectAll,
  editSelectLinked,
  editSelectLoop,
  extrude,
  fill,
  flipNormals,
  inset,
  loopCutSelected,
  mergeCenter,
  mergeDistance,
  quadsFromTris,
  recalculateNormals,
  separateSelected,
  setSelectMode,
  subdivide,
  triangulateSelected,
  unwrapBox,
} from '../state/actions3d';
import { editSel, selectMode } from '../state/store3d';

interface Op {
  icon: LucideIcon;
  name: string;
  pro?: string;
  key?: string;
  hint: string;
  run: () => void;
}

const MODEL_OPS: Op[] = [
  {
    icon: Box,
    name: 'Pull out',
    pro: 'Extrude',
    key: 'E',
    hint: 'Pulls the selected faces out, adding sides',
    run: () => extrude(),
  },
  {
    icon: Layers,
    name: 'Inset',
    key: 'I',
    hint: 'A smaller face inside each selected face',
    run: () => inset(),
  },
  {
    icon: Sparkles,
    name: 'Round edges',
    pro: 'Bevel',
    key: 'Ctrl+B',
    hint: 'Cuts sharp edges into a slope that catches light',
    run: () => bevel(),
  },
  {
    icon: Scissors,
    name: 'Add loop',
    pro: 'Loop cut',
    key: 'Ctrl+R',
    hint: 'A new ring of edges around the shape, across the selected edge',
    run: () => loopCutSelected(),
  },
  {
    icon: Grid2x2,
    name: 'Subdivide',
    hint: 'Splits each selected face into four',
    run: () => subdivide(),
  },
  {
    icon: Merge,
    name: 'Merge',
    pro: 'Merge at center',
    key: 'M',
    hint: 'Squeezes the selected points into one',
    run: () => mergeCenter(),
  },
  {
    icon: Combine,
    name: 'Fill hole',
    pro: 'Fill',
    key: 'F',
    hint: 'Makes a face from the selected points',
    run: () => fill(),
  },
  {
    icon: Blend,
    name: 'Dissolve',
    hint: 'Removes edges but keeps the surface',
    run: () => dissolve(),
  },
  {
    icon: Trash2,
    name: 'Delete',
    key: 'X',
    hint: 'Removes the selection',
    run: () => deleteElements('auto'),
  },
];

const FIX_OPS: Op[] = [
  {
    icon: Waypoints,
    name: 'Weld doubles',
    pro: 'Merge by distance',
    hint: 'Joins points sitting on top of each other',
    run: () => mergeDistance(),
  },
  {
    icon: RefreshCw,
    name: 'Fix inside-out',
    pro: 'Recalculate normals',
    key: 'Shift+N',
    hint: 'Makes all faces point outwards',
    run: () => recalculateNormals(),
  },
  {
    icon: FlipHorizontal,
    name: 'Flip',
    pro: 'Flip normals',
    hint: 'Turns the selected faces around',
    run: () => flipNormals(),
  },
  {
    icon: Triangle,
    name: 'Triangulate',
    key: 'Ctrl+T',
    hint: 'Splits faces into triangles',
    run: () => triangulateSelected(),
  },
  {
    icon: SquareDashed,
    name: 'Tris to quads',
    key: 'Alt+J',
    hint: 'Joins triangle pairs into four-sided faces',
    run: () => quadsFromTris(),
  },
  {
    icon: Grid2x2,
    name: 'UV: box project',
    hint: 'Lays textures on the selection from six sides',
    run: () => unwrapBox(),
  },
  {
    icon: Ungroup,
    name: 'Separate',
    key: 'P',
    hint: 'Moves the selected faces into a new object',
    run: () => separateSelected(),
  },
];

const SELECT_OPS: Op[] = [
  {
    icon: Expand,
    name: 'All / none',
    key: 'A',
    hint: 'Select everything (or nothing)',
    run: () => editSelectAll(true),
  },
  {
    icon: Waypoints,
    name: 'Connected',
    pro: 'Select linked',
    key: 'Ctrl+L',
    hint: 'Everything connected to the selection',
    run: () => editSelectLinked(),
  },
  {
    icon: ArrowLeftRight,
    name: 'Loop',
    pro: 'Edge loop',
    hint: 'The whole ring of edges through the selected edge',
    run: () => editSelectLoop(),
  },
  { icon: Expand, name: 'Grow', key: 'Ctrl++', hint: 'One step bigger', run: () => editGrow(true) },
  {
    icon: Shrink,
    name: 'Shrink',
    key: 'Ctrl+−',
    hint: 'One step smaller',
    run: () => editGrow(false),
  },
  {
    icon: Slice,
    name: 'Invert',
    key: 'Ctrl+I',
    hint: 'Swap selected and unselected',
    run: () => editInvert(),
  },
];

export function SelectModeSwitch() {
  const sm = selectMode.value;
  const opts: { id: SelectMode; label: string; key: string }[] = [
    { id: 'vert', label: 'Points', key: '1' },
    { id: 'edge', label: 'Edges', key: '2' },
    { id: 'face', label: 'Faces', key: '3' },
  ];
  return (
    <div
      class="segmented select-mode"
      role="radiogroup"
      aria-label="What to select"
      data-coach="select-mode"
    >
      {opts.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={sm === o.id}
          class={sm === o.id ? 'on' : ''}
          title={`${o.label} (${o.key})`}
          onClick={() => setSelectMode(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Edit-mode tools: a floating panel on desktop, a sheet on phones. */
export function EditTools(props: { embedded?: boolean }) {
  const e = editSel.value;
  const count =
    selectMode.value === 'vert'
      ? e.verts.size
      : selectMode.value === 'edge'
        ? e.edges.size
        : e.faces.size;
  const what =
    selectMode.value === 'vert' ? 'point' : selectMode.value === 'edge' ? 'edge' : 'face';
  const list = (title: string, ops: Op[]) => (
    <div class="edit-group">
      <div class="edit-group-title">{title}</div>
      <div class="edit-ops">
        {ops.map((op) => (
          <button
            key={op.name}
            class="edit-op"
            title={`${op.pro ? `${op.pro} — ` : ''}${op.hint}${op.key ? ` (${op.key})` : ''}`}
            onClick={op.run}
          >
            <op.icon size={17} />
            <span>{op.name}</span>
            {op.key && !props.embedded && <kbd class="kbd">{op.key}</kbd>}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div class={`edit-tools ${props.embedded ? 'embedded' : ''}`} data-coach="edit-tools">
      <SelectModeSwitch />
      <p class="faint edit-count">
        {count
          ? `${count} ${what}${count === 1 ? '' : 's'} selected`
          : `Click a ${what} to select it. Drag a box to select many.`}
      </p>
      {list('Shape', MODEL_OPS)}
      {list('Select', SELECT_OPS)}
      {list('Clean up', FIX_OPS)}
    </div>
  );
}
