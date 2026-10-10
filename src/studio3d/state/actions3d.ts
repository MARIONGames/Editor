/**
 * Commands of the 3D studio. Every change goes through `commit3d`, which records one
 * undo step with a plain-language label, keeps the selection valid and autosaves.
 */
import { batch } from '@preact/signals';
import { emit } from '../../state/events';
import { closeProject } from '../../state/actions';
import { project, route, toast } from '../../state/store';
import * as db from '../../storage/db';
import { uid } from '../../util/id';
import {
  keyTimes,
  mergeChannels,
  presetKeys,
  removeKeys,
  setEase,
  moveKeys,
  transformAt,
  type MotionPreset,
} from '../model/animation';
import { createMaterial, MATERIAL_PRESETS, presetMaterial, presetPatch } from '../model/materials';
import { edgeEnds, edgeTable, faceOffsets } from '../model/mesh';
import {
  boxProjectUV,
  deleteEdges,
  deleteFaces,
  deleteVerts,
  dissolveEdges,
  edgeLoop,
  emptySelection,
  extrudeEdges,
  extrudeFaces,
  fillVerts,
  flipFaces,
  growSelection,
  insetFaces,
  invertSelection,
  mergeAtCenter,
  mergeByDistance,
  recalcNormals,
  selectAll,
  selectionFromEdges,
  selectionFromFaces,
  selectionFromVerts,
  selectionNormal,
  selectLinked,
  subdivideFaces,
  triangulateFaces,
  trisToQuads,
  type MeshSelection,
  type OpResult,
  type SelectMode,
} from '../model/meshOps';
import { bevelEdges, loopCut } from '../model/meshTools';
import { apply as applyModifierTo, createModifier, evaluate } from '../model/modifiers';
import type { PrimitiveKind } from '../model/primitives';
import {
  addMaterial,
  addObjects,
  addPrimitive as addPrimitiveTo,
  applyTransform,
  assignMaterial,
  cameraObject,
  descendants,
  duplicateObjects,
  emptyObject,
  joinMeshes,
  keyObject,
  lightObject,
  localFromWorld,
  lookAtTransform,
  matrixOf,
  patchObject,
  removeObjects,
  sceneBounds,
  separateFaces,
  setOrigin,
  setParent,
  setTransformAt,
  starterScene,
  unkeyObject,
  uniqueName,
  updateMaterial as updateMaterialIn,
  updateObject,
  worldMatrix,
  type OriginMode,
} from '../model/scene';
import type {
  Ease,
  ID,
  LightKind,
  Material3D,
  MeshData,
  MeshObj,
  Modifier,
  ModifierKind,
  Obj3D,
  RenderSettings3D,
  Scene3D,
  Transform3,
  Vec3,
  World3D,
} from '../model/types';
import type { SelectHow } from '../engine/viewport';
import { flushSave3d, scheduleSave3d } from './persist3d';
import {
  editSel,
  history3d,
  historyVersion3d,
  lastOp,
  mode3d,
  playing3d,
  resetStudioState,
  scene3d,
  selection3d,
  selectMode,
  time3d,
  autoKey,
  type LastOp,
  type Selection3D,
  type UndoState,
} from './store3d';

/* ------------------------------------------------------------------ commit */

export interface Commit3DOptions {
  /** Merge rapid changes with the same key into one undo step (sliders, drags). */
  coalesce?: string;
  sel?: Selection3D;
  edit?: MeshSelection;
  /** Keep the "adjust last operation" panel (only runOp sets this). */
  keepOp?: boolean;
}

function undoState(): UndoState {
  return { sel: selection3d.peek(), mode: mode3d.peek(), edit: editSel.peek() };
}

/** Drops selected ids that no longer exist and leaves edit mode if its object is gone. */
function validate(s: Scene3D): void {
  const sel = selection3d.peek();
  const ids = sel.ids.filter((id) => s.objects[id]);
  const active = sel.active && s.objects[sel.active] ? sel.active : (ids[ids.length - 1] ?? null);
  if (ids.length !== sel.ids.length || active !== sel.active) selection3d.value = { ids, active };
  if (mode3d.peek() === 'edit') {
    const o = active ? s.objects[active] : undefined;
    if (!o || o.kind !== 'mesh') {
      mode3d.value = 'object';
      editSel.value = emptySelection();
    } else {
      // Keep the edit selection inside the mesh.
      const nv = o.mesh.v.length / 3;
      const e = editSel.peek();
      if ([...e.verts].some((v) => v >= nv)) editSel.value = emptySelection();
    }
  }
}

export function commit3d(
  label: string,
  fn: (s: Scene3D) => Scene3D,
  opts: Commit3DOptions = {},
): boolean {
  const prev = scene3d.peek();
  if (!prev) return false;
  const next = fn(prev);
  if (next === prev) {
    batch(() => {
      if (opts.sel) selection3d.value = opts.sel;
      if (opts.edit) editSel.value = opts.edit;
    });
    return false;
  }
  history3d.record(prev, undoState(), label, opts.coalesce);
  batch(() => {
    const stamped = { ...next, updatedAt: Date.now() };
    scene3d.value = stamped;
    if (opts.sel) selection3d.value = opts.sel;
    if (opts.edit) editSel.value = opts.edit;
    validate(stamped);
    if (!opts.keepOp) lastOp.value = null;
    historyVersion3d.value++;
  });
  scheduleSave3d();
  return true;
}

/** Shows an in-progress change (gizmo drags, G/R/S) without an undo step. */
export function live3d(next: Scene3D): void {
  scene3d.value = next;
}

/** Ends a gesture: one undo step from `before` to `after`. */
export function finish3d(label: string, before: Scene3D, after: Scene3D): void {
  history3d.record(before, undoState(), label);
  batch(() => {
    scene3d.value = { ...after, updatedAt: Date.now() };
    lastOp.value = null;
    historyVersion3d.value++;
  });
  scheduleSave3d();
  emit('3d:transformed', { how: label });
}

export function endGesture3d(): void {
  history3d.breakCoalescing();
}

function restore(entry: { project: Scene3D; selection: UndoState }): void {
  batch(() => {
    scene3d.value = entry.project;
    selection3d.value = entry.selection.sel;
    mode3d.value = entry.selection.mode;
    editSel.value = entry.selection.edit;
    lastOp.value = null;
    validate(entry.project);
    historyVersion3d.value++;
  });
  scheduleSave3d();
}

export function undo3d(): void {
  const s = scene3d.peek();
  if (!s) return;
  const entry = history3d.undo({ project: s, selection: undoState(), label: '' });
  if (!entry) return;
  restore(entry);
  toast(`Undid: ${entry.label}`);
  emit('undo', {});
}

export function redo3d(): void {
  const s = scene3d.peek();
  if (!s) return;
  const entry = history3d.redo({ project: s, selection: undoState(), label: '' });
  if (!entry) return;
  restore(entry);
  toast(`Redid: ${entry.label}`);
}

/**
 * Runs an operation that can be adjusted afterwards ("Adjust last operation"): the
 * panel re-runs `run` on the scene from before the operation with new numbers.
 */
export function runOp(
  label: string,
  params: Record<string, number>,
  fields: LastOp['fields'],
  run: (
    base: Scene3D,
    p: Record<string, number>,
  ) => { scene: Scene3D; edit?: MeshSelection; sel?: Selection3D } | null,
): boolean {
  const base = scene3d.peek();
  if (!base) return false;
  const r = run(base, params);
  if (!r || r.scene === base) return false;
  commit3d(label, () => r.scene, { edit: r.edit, sel: r.sel, keepOp: true });
  lastOp.value = fields.length ? { label, params, fields, run: (p) => run(base, p) } : null;
  return true;
}

export function adjustLastOp(params: Record<string, number>): void {
  const op = lastOp.peek();
  if (!op) return;
  const r = op.run(params);
  if (!r) return;
  batch(() => {
    scene3d.value = { ...r.scene, updatedAt: Date.now() };
    if (r.edit) editSel.value = r.edit;
    if (r.sel) selection3d.value = r.sel;
    lastOp.value = { ...op, params };
  });
  scheduleSave3d();
}

/* ---------------------------------------------------------------- scenes */

export type SceneStart = 'model' | 'blank' | 'product' | 'animate';

export async function newScene(start: SceneStart = 'model', name?: string): Promise<Scene3D> {
  let s = starterScene(
    name ??
      (start === 'product' ? 'Product shot' : start === 'animate' ? 'My animation' : 'My 3D model'),
    start !== 'blank',
  );
  if (start === 'product') s = productStage(s);
  if (start === 'animate') {
    const cube = s.order.find((id) => s.objects[id]!.kind === 'mesh');
    if (cube)
      s = updateObject(s, cube, (o) => ({
        ...o,
        anim: mergeChannels(o.anim, presetKeys('bounce', o.t, 0, 2)),
      }));
    s = { ...s, anim: { start: 0, end: 2 } };
  }
  await openSceneObject(s);
  void db.requestPersistence();
  return s;
}

/** A pedestal, soft key/rim lights and a turntable-ready camera: instant product shots. */
function productStage(scene: Scene3D): Scene3D {
  let s = scene;
  const sun = s.order.find((id) => s.objects[id]!.kind === 'light');
  if (sun) s = removeObjects(s, [sun]);
  const ped = presetMaterial('matte', 'Pedestal');
  s = addMaterial(s, { ...ped, color: '#e9e6e1', roughness: 0.8 });
  const r = addPrimitiveTo(s, 'cylinder', [0, 0, 0], ped.id);
  s = patchObject(r.scene, r.id, {
    name: 'Pedestal',
    t: { p: [0, 0, 0], r: [0, 0, 0], s: [1.6, 0.25, 1.6] },
  } as Partial<Obj3D>);
  const cube = s.order.find((id) => s.objects[id]!.name === 'Cube');
  if (cube)
    s = patchObject(s, cube, {
      t: { p: [0, 1.5, 0], r: [0, Math.PI / 5, 0], s: [1, 1, 1] },
    } as Partial<Obj3D>);
  const key = lightObject('area', lookAtTransform([3, 4, 3], [0, 1, 0]));
  const rim = lightObject('area', lookAtTransform([-3, 3, -2.5], [0, 1, 0]));
  const fill = lightObject('spot', lookAtTransform([-4, 5, 4], [0, 1, 0]));
  s = addObjects(s, [
    { ...key, name: 'Key light', light: { ...key.light, intensity: 18, size: [2, 2] } },
    {
      ...rim,
      name: 'Rim light',
      light: { ...rim.light, intensity: 14, size: [1.5, 1.5], color: '#cfe0ff' },
    },
    {
      ...fill,
      name: 'Fill light',
      light: { ...fill.light, intensity: 250, angle: 40, softness: 0.8 },
    },
  ]);
  const cam = s.render.camera;
  if (cam)
    s = patchObject(s, cam, { t: lookAtTransform([5.5, 3.2, 6.5], [0, 1.2, 0]) } as Partial<Obj3D>);
  return { ...s, world: { ...s.world, background: 'color', color: '#f1eee9', envIntensity: 0.8 } };
}

async function openSceneObject(s: Scene3D): Promise<void> {
  if (project.peek()) await closeProject();
  resetStudioState(s);
  route.value = { name: 'studio3d', sceneId: s.id };
  try {
    await db.saveScene(s);
  } catch (err) {
    console.warn('Could not save scene', err);
  }
  emit('3d:opened', { kind: 'scene' });
}

export async function openScene(id: string): Promise<boolean> {
  try {
    const raw = (await db.loadScene(id)) as Scene3D | undefined;
    if (!raw || raw.kind !== '3d') {
      toast('That 3D scene could not be found.', 'error');
      return false;
    }
    await openSceneObject(raw);
    return true;
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not open the scene.', 'error');
    return false;
  }
}

export async function closeScene(): Promise<void> {
  await flushSave3d();
  resetStudioState(null);
  route.value = { name: 'home' };
}

export async function duplicateScene(id: string): Promise<void> {
  const raw = (await db.loadScene(id)) as Scene3D | undefined;
  if (!raw) return;
  await db.saveScene({
    ...raw,
    id: uid('s'),
    name: `${raw.name} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export function renameScene(name: string): void {
  const n = name.trim();
  if (n) commit3d('Rename scene', (s) => (s.name === n ? s : { ...s, name: n }));
}

/* ------------------------------------------------------------- selection */

export function selectObjects(ids: ID[], how: SelectHow = 'set'): void {
  const s = scene3d.peek();
  if (!s) return;
  const cur = selection3d.peek();
  let next: ID[];
  let active = cur.active;
  if (how === 'set') {
    next = ids.slice();
    active = ids[ids.length - 1] ?? null;
  } else if (how === 'add') {
    next = [...cur.ids.filter((i) => !ids.includes(i)), ...ids];
    if (ids.length) active = ids[ids.length - 1]!;
  } else if (how === 'remove') {
    next = cur.ids.filter((i) => !ids.includes(i));
    if (active && ids.includes(active)) active = next[next.length - 1] ?? null;
  } else {
    // Toggle (Shift+click): a selected non-active object becomes active first, like Blender.
    const id = ids[0];
    if (!id) return;
    if (cur.ids.includes(id) && cur.active === id) {
      next = cur.ids.filter((i) => i !== id);
      active = next[next.length - 1] ?? null;
    } else {
      next = [...cur.ids.filter((i) => i !== id), id];
      active = id;
    }
  }
  next = next.filter((id) => s.objects[id]);
  selection3d.value = {
    ids: next,
    active: active && next.includes(active) ? active : (next[next.length - 1] ?? null),
  };
  if (mode3d.peek() === 'edit') exitEditMode();
  const a = selection3d.peek().active;
  if (a) emit('3d:selected', { kind: s.objects[a]!.kind });
}

export function selectAllObjects(toggle = true): void {
  const s = scene3d.peek();
  if (!s) return;
  const visible = s.order.filter((id) => s.objects[id]!.visible && !s.objects[id]!.locked);
  if (toggle && selection3d.peek().ids.length) selection3d.value = { ids: [], active: null };
  else
    selection3d.value = {
      ids: visible,
      active: selection3d.peek().active ?? visible[visible.length - 1] ?? null,
    };
}

export function invertObjectSelection(): void {
  const s = scene3d.peek();
  if (!s) return;
  const cur = new Set(selection3d.peek().ids);
  const ids = s.order.filter(
    (id) => !cur.has(id) && s.objects[id]!.visible && !s.objects[id]!.locked,
  );
  selection3d.value = { ids, active: ids[ids.length - 1] ?? null };
}

/* ------------------------------------------------------------- edit mode */

function activeMesh(): MeshObj | null {
  const s = scene3d.peek();
  const a = selection3d.peek().active;
  const o = s && a ? s.objects[a] : undefined;
  return o?.kind === 'mesh' ? o : null;
}

export function enterEditMode(): boolean {
  const o = activeMesh();
  if (!o) {
    toast('Select a shape first, then edit its points, edges and faces.', 'info');
    return false;
  }
  batch(() => {
    selection3d.value = { ids: [o.id], active: o.id };
    mode3d.value = 'edit';
    editSel.value = emptySelection();
  });
  emit('3d:mode', { mode: 'edit' });
  return true;
}

export function exitEditMode(): void {
  if (mode3d.peek() !== 'edit') return;
  batch(() => {
    mode3d.value = 'object';
    editSel.value = emptySelection();
  });
  lastOp.value = null;
  emit('3d:mode', { mode: 'object' });
}

export function toggleEditMode(): void {
  if (mode3d.peek() === 'edit') exitEditMode();
  else enterEditMode();
}

function selFrom(m: MeshData, mode: SelectMode, ids: Set<number>): MeshSelection {
  return mode === 'vert'
    ? selectionFromVerts(m, ids)
    : mode === 'edge'
      ? selectionFromEdges(m, ids)
      : selectionFromFaces(m, ids);
}

function idsOf(sel: MeshSelection, mode: SelectMode): Set<number> {
  return mode === 'vert' ? sel.verts : mode === 'edge' ? sel.edges : sel.faces;
}

export function selectElements(ids: Set<number>, how: SelectHow): void {
  const o = activeMesh();
  if (!o) return;
  const mode = selectMode.peek();
  const cur = idsOf(editSel.peek(), mode);
  let next: Set<number>;
  if (how === 'set') next = new Set(ids);
  else if (how === 'add') next = new Set([...cur, ...ids]);
  else if (how === 'remove') next = new Set([...cur].filter((i) => !ids.has(i)));
  else {
    next = new Set(cur);
    for (const i of ids) {
      if (next.has(i)) next.delete(i);
      else next.add(i);
    }
  }
  editSel.value = selFrom(o.mesh, mode, next);
}

export function setSelectMode(mode: SelectMode): void {
  const o = activeMesh();
  selectMode.value = mode;
  if (!o) return;
  const cur = editSel.peek();
  // Converting keeps what is fully selected (like Blender).
  editSel.value =
    mode === 'vert'
      ? selectionFromVerts(o.mesh, cur.verts)
      : mode === 'edge'
        ? selectionFromEdges(o.mesh, cur.edges)
        : selectionFromFaces(o.mesh, cur.faces);
}

export function editSelectAll(toggle = true): void {
  const o = activeMesh();
  if (!o) return;
  editSel.value = toggle && editSel.peek().verts.size ? emptySelection() : selectAll(o.mesh);
}

export function editInvert(): void {
  const o = activeMesh();
  if (o) editSel.value = invertSelection(o.mesh, editSel.peek(), selectMode.peek());
}

export function editSelectLinked(): void {
  const o = activeMesh();
  if (o && editSel.peek().verts.size) editSel.value = selectLinked(o.mesh, editSel.peek().verts);
}

export function editGrow(grow: boolean): void {
  const o = activeMesh();
  if (o) editSel.value = growSelection(o.mesh, editSel.peek().verts, grow);
}

/** Selects the edge loop through the last selected edge (Alt+click in Blender). */
export function editSelectLoop(): void {
  const o = activeMesh();
  if (!o) return;
  const edges = [...editSel.peek().edges];
  const start = edges[edges.length - 1];
  if (start === undefined) {
    toast('Select an edge first, then pick its loop.', 'info');
    return;
  }
  const loop = edgeLoop(o.mesh, start);
  editSel.value = selectionFromEdges(o.mesh, new Set([...edges, ...loop]));
}

/* ------------------------------------------------------------ mesh edits */

interface MeshOpSpec {
  label: string;
  params?: Record<string, number>;
  fields?: LastOp['fields'];
  /** Returns the new mesh (and selection), or a message explaining what to select. */
  run: (
    m: MeshData,
    sel: MeshSelection,
    p: Record<string, number>,
  ) => OpResult | MeshData | string | null;
}

/** Runs a mesh operation on the edited object (adjustable afterwards). */
export function meshOp(spec: MeshOpSpec): boolean {
  const o = activeMesh();
  if (!o || mode3d.peek() !== 'edit') return false;
  const sel = editSel.peek();
  const id = o.id;
  let message: string | null = null;
  const ok = runOp(spec.label, spec.params ?? {}, spec.fields ?? [], (base, p) => {
    const obj = base.objects[id] as MeshObj | undefined;
    if (!obj) return null;
    const r = spec.run(obj.mesh, sel, p);
    if (typeof r === 'string') {
      message = r;
      return null;
    }
    if (!r) return null;
    const res = 'mesh' in r && 'sel' in r ? r : { mesh: r as MeshData, sel: null };
    if (res.mesh === obj.mesh) return null;
    const next = patchObject<MeshObj>(base, id, { mesh: res.mesh });
    return { scene: next, edit: res.sel ?? emptySelection() };
  });
  if (message) toast(message, 'info');
  if (ok) emit('3d:edited', { op: spec.label });
  return ok;
}

const distanceField = (label = 'Distance'): LastOp['fields'][number] => ({
  key: 'distance',
  label,
  min: -5,
  max: 5,
  step: 0.01,
  unit: 'm',
});

export function extrude(distance = 0.5): boolean {
  return meshOp({
    label: 'Extrude',
    params: { distance },
    fields: [distanceField()],
    run: (m, sel, p) => {
      if (sel.faces.size) return extrudeFaces(m, sel.faces, p.distance!);
      if (sel.edges.size) {
        const n = selectionNormal(m, sel);
        return extrudeEdges(m, sel.edges, [
          n[0] * p.distance!,
          n[1] * p.distance!,
          n[2] * p.distance!,
        ]);
      }
      return 'Select faces (or edges) to pull out.';
    },
  });
}

/** Extrude for the E key: zero-length extrusion, then a move along the normal. */
export function extrudeForMove(): {
  before: Scene3D;
  base: Scene3D;
  normal: Vec3;
  sel: MeshSelection;
} | null {
  const o = activeMesh();
  const s = scene3d.peek();
  if (!o || !s) return null;
  const sel = editSel.peek();
  let r: OpResult;
  if (sel.faces.size) r = extrudeFaces(o.mesh, sel.faces, 0);
  else if (sel.edges.size) r = extrudeEdges(o.mesh, sel.edges);
  else return null;
  const n = selectionNormal(o.mesh, sel);
  const world = worldMatrix(s, o.id, time3d.peek());
  const wn: Vec3 = [
    world.elements[0]! * n[0] + world.elements[4]! * n[1] + world.elements[8]! * n[2],
    world.elements[1]! * n[0] + world.elements[5]! * n[1] + world.elements[9]! * n[2],
    world.elements[2]! * n[0] + world.elements[6]! * n[1] + world.elements[10]! * n[2],
  ];
  const base = patchObject<MeshObj>(s, o.id, { mesh: r.mesh });
  batch(() => {
    scene3d.value = base;
    editSel.value = r.sel;
  });
  return { before: s, base, normal: wn, sel };
}

export function inset(thickness = 0.1, depth = 0): boolean {
  return meshOp({
    label: 'Inset',
    params: { thickness, depth },
    fields: [
      { key: 'thickness', label: 'Border', min: 0, max: 2, step: 0.005, unit: 'm' },
      { key: 'depth', label: 'Depth', min: -2, max: 2, step: 0.005, unit: 'm' },
    ],
    run: (m, sel, p) =>
      sel.faces.size ? insetFaces(m, sel.faces, p.thickness!, p.depth!) : 'Select faces to inset.',
  });
}

export function bevel(width = 0.1): boolean {
  return meshOp({
    label: 'Bevel',
    params: { width },
    fields: [{ key: 'width', label: 'Width', min: 0.001, max: 2, step: 0.005, unit: 'm' }],
    run: (m, sel, p) => {
      let edges = sel.edges;
      if (!edges.size && sel.faces.size) edges = selectionFromFaces(m, sel.faces).edges;
      return edges.size ? bevelEdges(m, edges, p.width!) : 'Select the edges to round off.';
    },
  });
}

export function loopCutSelected(cuts = 1): boolean {
  return meshOp({
    label: 'Loop cut',
    params: { cuts, slide: 0 },
    fields: [
      { key: 'cuts', label: 'Cuts', min: 1, max: 32, step: 1 },
      { key: 'slide', label: 'Slide', min: -1, max: 1, step: 0.01 },
    ],
    run: (m, sel, p) => {
      const e = [...sel.edges];
      let start = e[e.length - 1];
      if (start === undefined && sel.faces.size) {
        // A face is enough: cut across its first edge.
        const fi = [...sel.faces][0]!;
        const o = faceOffsets(m)[fi]!;
        const a = m.f[o]!;
        const b = m.f[o + 1]!;
        start = a < b ? a * 2 ** 24 + b : b * 2 ** 24 + a;
      }
      if (start === undefined) return 'Select an edge: the cut goes across it, all the way around.';
      return loopCut(m, start, Math.round(p.cuts!), p.slide!);
    },
  });
}

export function subdivide(): boolean {
  return meshOp({
    label: 'Subdivide',
    run: (m, sel) => (sel.faces.size ? subdivideFaces(m, sel.faces) : 'Select faces to subdivide.'),
  });
}

export function deleteElements(what: 'verts' | 'edges' | 'faces' | 'auto' = 'auto'): boolean {
  return meshOp({
    label: 'Delete',
    run: (m, sel) => {
      const kind =
        what === 'auto'
          ? selectMode.peek() === 'vert'
            ? 'verts'
            : selectMode.peek() === 'edge'
              ? 'edges'
              : 'faces'
          : what;
      if (kind === 'verts') return sel.verts.size ? deleteVerts(m, sel.verts) : 'Nothing selected.';
      if (kind === 'edges') return sel.edges.size ? deleteEdges(m, sel.edges) : 'Nothing selected.';
      return sel.faces.size ? deleteFaces(m, sel.faces) : 'Nothing selected.';
    },
  });
}

export function dissolve(): boolean {
  return meshOp({
    label: 'Dissolve edges',
    run: (m, sel) => (sel.edges.size ? dissolveEdges(m, sel.edges) : 'Select edges to dissolve.'),
  });
}

export function mergeCenter(): boolean {
  return meshOp({
    label: 'Merge at center',
    run: (m, sel) =>
      sel.verts.size > 1 ? mergeAtCenter(m, sel.verts) : 'Select two or more points to merge.',
  });
}

export function mergeDistance(distance = 0.001): boolean {
  let removed = 0;
  const ok = meshOp({
    label: 'Merge by distance',
    params: { distance },
    fields: [{ key: 'distance', label: 'Distance', min: 0, max: 1, step: 0.0005, unit: 'm' }],
    run: (m, sel, p) => {
      const r = mergeByDistance(m, p.distance!, sel.verts.size ? sel.verts : undefined);
      removed = r.removed;
      return r.mesh;
    },
  });
  toast(
    removed
      ? `Merged ${removed} point${removed === 1 ? '' : 's'}.`
      : 'No points were close enough to merge.',
    'info',
  );
  return ok;
}

export function fill(): boolean {
  return meshOp({
    label: 'Fill',
    run: (m, sel) =>
      sel.verts.size >= 3 ? fillVerts(m, sel.verts) : 'Select at least three points around a hole.',
  });
}

export function flipNormals(): boolean {
  return meshOp({
    label: 'Flip normals',
    run: (m, sel) => flipFaces(m, sel.faces.size ? sel.faces : undefined),
  });
}

export function recalculateNormals(): boolean {
  return meshOp({
    label: 'Recalculate normals',
    run: (m, sel) => recalcNormals(m, sel.faces.size ? sel.faces : undefined),
  });
}

export function triangulateSelected(): boolean {
  return meshOp({
    label: 'Triangulate',
    run: (m, sel) => triangulateFaces(m, sel.faces.size ? sel.faces : undefined),
  });
}

export function quadsFromTris(): boolean {
  return meshOp({ label: 'Triangles to quads', run: (m) => trisToQuads(m) });
}

export function unwrapBox(scale = 1): boolean {
  return meshOp({
    label: 'UV: box project',
    params: { scale },
    fields: [{ key: 'scale', label: 'Scale', min: 0.05, max: 20, step: 0.05 }],
    run: (m, sel, p) => boxProjectUV(m, sel.faces.size ? sel.faces : undefined, p.scale!),
  });
}

/** Moves the selected faces into their own object (P). */
export function separateSelected(): void {
  const o = activeMesh();
  if (!o) return;
  const faces = editSel.peek().faces;
  if (!faces.size) {
    toast('Select faces to separate.', 'info');
    return;
  }
  commit3d('Separate', (s) => separateFaces(s, o.id, faces).scene, { edit: emptySelection() });
}

/* --------------------------------------------------------------- objects */

/**
 * Where a new shape goes: the requested spot, or the nearest free spot around it so it
 * doesn't end up hidden inside something that is already there.
 */
function freeSpot(s: Scene3D, at: Vec3, size = 2): Vec3 {
  const t = time3d.peek();
  const boxes = s.order
    .filter(
      (id) =>
        s.objects[id]!.visible &&
        (s.objects[id]!.kind === 'mesh' || s.objects[id]!.kind === 'model'),
    )
    .map((id) => sceneBounds(s, [id], t))
    .filter((b): b is NonNullable<typeof b> => !!b);
  const free = (x: number, z: number) =>
    boxes.every(
      (b) =>
        x + size / 2 <= b.min.x ||
        x - size / 2 >= b.max.x ||
        z + size / 2 <= b.min.z ||
        z - size / 2 >= b.max.z,
    );
  if (free(at[0], at[2])) return at;
  const step = size * 1.25;
  for (let ring = 1; ring <= 6; ring++) {
    for (let k = 0; k < ring * 8; k++) {
      const a = (k / (ring * 8)) * Math.PI * 2;
      const x = Math.round((at[0] + Math.cos(a) * step * ring) * 4) / 4;
      const z = Math.round((at[2] + Math.sin(a) * step * ring) * 4) / 4;
      if (free(x, z)) return [x, at[1], z];
    }
  }
  return at;
}

export function addPrimitive(kind: PrimitiveKind, at?: Vec3): ID | null {
  let id: ID | null = null;
  exitEditMode();
  commit3d(`Add ${kind}`, (s) => {
    const r = addPrimitiveTo(
      s,
      kind,
      freeSpot(s, at ?? [0, 0, 0], kind === 'plane' || kind === 'grid' ? 2.2 : 2.1),
    );
    id = r.id;
    return r.scene;
  });
  if (id) {
    selection3d.value = { ids: [id], active: id };
    emit('3d:added', { kind });
  }
  return id;
}

export function addLight(type: LightKind): ID | null {
  exitEditMode();
  const pos: Vec3 = type === 'sun' ? [4, 8, 3] : type === 'area' ? [2.5, 3.5, 2.5] : [2.5, 4, 2];
  const o = lightObject(type, lookAtTransform(pos, [0, 0.8, 0]));
  commit3d(
    `Add ${o.name.toLowerCase()}`,
    (s) => addObjects(s, [{ ...o, name: uniqueName(s, o.name) }]),
    { sel: { ids: [o.id], active: o.id } },
  );
  emit('3d:added', { kind: `light:${type}` });
  return o.id;
}

export function addCamera(t?: Transform3): ID {
  exitEditMode();
  const o = cameraObject(t ?? lookAtTransform([6, 4, 8], [0, 1, 0]));
  commit3d(
    'Add camera',
    (s) => {
      const next = addObjects(s, [{ ...o, name: uniqueName(s, 'Camera') }]);
      return s.render.camera && s.objects[s.render.camera]
        ? next
        : { ...next, render: { ...next.render, camera: o.id } };
    },
    { sel: { ids: [o.id], active: o.id } },
  );
  emit('3d:added', { kind: 'camera' });
  return o.id;
}

export function addEmpty(): ID {
  exitEditMode();
  const o = emptyObject('Empty', { p: [0, 1, 0], r: [0, 0, 0], s: [1, 1, 1] });
  commit3d('Add empty', (s) => addObjects(s, [{ ...o, name: uniqueName(s, 'Empty') }]), {
    sel: { ids: [o.id], active: o.id },
  });
  return o.id;
}

export function deleteSelected(): void {
  if (mode3d.peek() === 'edit') {
    deleteElements('auto');
    return;
  }
  const ids = selection3d.peek().ids;
  if (!ids.length) return;
  const n = ids.length;
  commit3d(n === 1 ? 'Delete object' : `Delete ${n} objects`, (s) => removeObjects(s, ids), {
    sel: { ids: [], active: null },
  });
}

/** Shift+D (copy) or Alt+D (linked copy). Returns the scene before, for a follow-up move. */
export function duplicateSelected(linked = false): Scene3D | null {
  const ids = selection3d.peek().ids;
  const before = scene3d.peek();
  if (!ids.length || !before) return null;
  let newIds: ID[] = [];
  commit3d(linked ? 'Linked copy' : 'Copy', (s) => {
    const r = duplicateObjects(s, ids, linked);
    newIds = r.ids;
    let out = r.scene;
    for (const id of newIds)
      out = patchObject(out, id, {
        name: uniqueName(out, out.objects[id]!.name.replace(/\.\d{3}$/, '')),
      });
    return out;
  });
  selection3d.value = { ids: newIds, active: newIds[newIds.length - 1] ?? null };
  return before;
}

/** Shift+D: makes the copy without an undo step yet (the following move adds one). */
export function duplicateForMove(linked = false): { before: Scene3D; base: Scene3D } | null {
  const ids = selection3d.peek().ids;
  const before = scene3d.peek();
  if (!ids.length || !before) return null;
  const r = duplicateObjects(before, ids, linked);
  let base = r.scene;
  for (const id of r.ids)
    base = patchObject(base, id, {
      name: uniqueName(base, base.objects[id]!.name.replace(/\.\d{3}$/, '')),
    });
  batch(() => {
    scene3d.value = base;
    selection3d.value = { ids: r.ids, active: r.ids[r.ids.length - 1] ?? null };
  });
  return { before, base };
}

export function patchObj<T extends Obj3D>(
  id: ID,
  patch: Partial<T>,
  label: string,
  coalesce?: string,
): void {
  commit3d(label, (s) => patchObject<T>(s, id, patch), { coalesce });
}

export function renameObject(id: ID, name: string): void {
  const n = name.trim();
  if (n)
    commit3d('Rename', (s) =>
      s.objects[id]?.name === n
        ? s
        : patchObject(s, id, {
            name: uniqueName(
              { ...s, objects: { ...s.objects, [id]: { ...s.objects[id]!, name: '' } } },
              n,
            ),
          }),
    );
}

export function toggleVisible(id: ID): void {
  const o = scene3d.peek()?.objects[id];
  if (o) patchObj(id, { visible: !o.visible }, o.visible ? 'Hide' : 'Show');
}

export function toggleLocked(id: ID): void {
  const o = scene3d.peek()?.objects[id];
  if (o) patchObj(id, { locked: !o.locked }, o.locked ? 'Unlock' : 'Lock');
}

export function hideSelected(unselected = false): void {
  const s = scene3d.peek();
  if (!s) return;
  const sel = new Set(selection3d.peek().ids);
  const ids = unselected ? s.order.filter((id) => !sel.has(id)) : [...sel];
  if (!ids.length) return;
  commit3d('Hide', (sc) => ids.reduce((acc, id) => patchObject(acc, id, { visible: false }), sc), {
    sel: unselected ? undefined : { ids: [], active: null },
  });
}

export function unhideAll(): void {
  const s = scene3d.peek();
  if (!s) return;
  const hidden = s.order.filter((id) => !s.objects[id]!.visible);
  if (!hidden.length) return;
  commit3d(
    'Show all',
    (sc) => hidden.reduce((acc, id) => patchObject(acc, id, { visible: true }), sc),
    { sel: { ids: hidden, active: hidden[hidden.length - 1]! } },
  );
}

/** Sets one number of the active object's position/rotation/scale (keys it when animated or auto-key is on). */
export function setTransformValue(
  id: ID,
  ch: 'p' | 'r' | 's',
  axis: 0 | 1 | 2,
  value: number,
): void {
  const s = scene3d.peek();
  const o = s?.objects[id];
  if (!o) return;
  const t = time3d.peek();
  const cur = transformAt(o, t);
  const next: Transform3 = { p: [...cur.p] as Vec3, r: [...cur.r] as Vec3, s: [...cur.s] as Vec3 };
  next[ch][axis] = value;
  commit3d(
    ch === 'p' ? 'Move' : ch === 'r' ? 'Rotate' : 'Scale',
    (sc) => setTransformAt(sc, id, next, t, autoKey.peek()),
    { coalesce: `tf:${id}:${ch}${axis}` },
  );
}

/** Alt+G / Alt+R / Alt+S: put position, rotation or scale back to zero / one. */
export function clearTransform(ch: 'p' | 'r' | 's'): void {
  const ids = selection3d.peek().ids;
  if (!ids.length) return;
  const t = time3d.peek();
  commit3d(ch === 'p' ? 'Clear position' : ch === 'r' ? 'Clear rotation' : 'Clear scale', (s) =>
    ids.reduce((acc, id) => {
      const o = acc.objects[id];
      if (!o || o.locked) return acc;
      const cur = transformAt(o, t);
      return setTransformAt(
        acc,
        id,
        { ...cur, [ch]: ch === 's' ? [1, 1, 1] : [0, 0, 0] },
        t,
        autoKey.peek(),
      );
    }, s),
  );
}

export function applyTransforms(): void {
  const ids = selection3d.peek().ids.filter((id) => scene3d.peek()?.objects[id]?.kind === 'mesh');
  if (!ids.length) {
    toast('Select a shape to apply its size and rotation to.', 'info');
    return;
  }
  commit3d('Apply transform', (s) => ids.reduce((acc, id) => applyTransform(acc, id), s));
}

export function setOriginTo(mode: OriginMode): void {
  const ids = selection3d.peek().ids;
  commit3d('Set origin', (s) => ids.reduce((acc, id) => setOrigin(acc, id, mode), s));
}

export function joinSelected(): void {
  const { ids, active } = selection3d.peek();
  if (ids.length < 2 || !active) {
    toast('Select two or more shapes to join them.', 'info');
    return;
  }
  commit3d('Join', (s) => joinMeshes(s, ids, active), { sel: { ids: [active], active } });
}

export function parentSelected(): void {
  const { ids, active } = selection3d.peek();
  const children = ids.filter((id) => id !== active);
  if (!active || !children.length) {
    toast('Select the children first, then the parent last (it becomes the active one).', 'info');
    return;
  }
  commit3d('Set parent', (s) => setParent(s, children, active, time3d.peek()));
}

export function clearParent(): void {
  const ids = selection3d.peek().ids;
  if (ids.length) commit3d('Clear parent', (s) => setParent(s, ids, null, time3d.peek()));
}

/** Moves objects so they rest on the floor (or on top of the highest point below them). */
export function dropToFloor(): void {
  const ids = selection3d.peek().ids;
  if (!ids.length) return;
  const t = time3d.peek();
  commit3d('Drop to floor', (s) =>
    ids.reduce((acc, id) => {
      const b = sceneBounds(acc, [id], t);
      const o = acc.objects[id];
      if (!b || !o || o.parent) return acc;
      const cur = transformAt(o, t);
      return setTransformAt(
        acc,
        id,
        { ...cur, p: [cur.p[0], cur.p[1] - b.min.y, cur.p[2]] },
        t,
        autoKey.peek(),
      );
    }, s),
  );
  emit('3d:edited', { op: 'drop' });
}

export function setRenderCamera(id: ID): void {
  commit3d('Use this camera', (s) => ({ ...s, render: { ...s.render, camera: id } }));
}

/** Puts the render camera where you are looking from (Ctrl+Alt+Numpad0). */
export function cameraToView(view: Transform3): void {
  const s = scene3d.peek();
  if (!s) return;
  const cam = s.render.camera && s.objects[s.render.camera] ? s.render.camera : null;
  if (!cam) {
    addCamera(view);
    return;
  }
  const o = s.objects[cam]!;
  const t = time3d.peek();
  const local = localFromWorld(s, cam, matrixOf(view), t);
  commit3d('Camera to view', (sc) =>
    setTransformAt(sc, cam, { ...local, s: transformAt(o, t).s }, t, autoKey.peek()),
  );
}

/* ------------------------------------------------------------- materials */

export function applyMaterialPreset(presetId: string): void {
  const s = scene3d.peek();
  if (!s) return;
  const sel = selection3d.peek();
  const meshes = sel.ids.filter((id) => s.objects[id]?.kind === 'mesh');
  if (!meshes.length) {
    toast('Select a shape first, then pick a look for it.', 'info');
    return;
  }
  const mat = presetMaterial(presetId);
  const faces =
    mode3d.peek() === 'edit' && editSel.peek().faces.size ? editSel.peek().faces : undefined;
  commit3d(`Material: ${mat.name}`, (sc) => {
    let next = addMaterial(sc, mat);
    for (const id of meshes)
      next = assignMaterial(next, id, mat.id, id === sel.active ? faces : undefined);
    return next;
  });
  emit('3d:material', { preset: presetId });
}

/** Changes the active object's material in place (all objects using it change too). */
export function updateMaterial(id: ID, patch: Partial<Material3D>, coalesce?: string): void {
  commit3d('Change material', (s) => updateMaterialIn(s, id, patch), {
    coalesce: coalesce ? `mat:${id}:${coalesce}` : undefined,
  });
}

export function setMaterialPresetOn(matId: ID, presetId: string): void {
  const preset = MATERIAL_PRESETS.find((p) => p.id === presetId);
  commit3d('Change material', (s) => {
    const cur = s.materials[matId];
    // A material still named after a preset (or the default) takes the new preset's name.
    const named =
      !cur || cur.name === 'Material' || MATERIAL_PRESETS.some((p) => p.name === cur.name);
    return updateMaterialIn(s, matId, {
      ...presetPatch(presetId),
      ...(named && preset ? { name: preset.name } : {}),
    });
  });
  emit('3d:material', { preset: presetId });
}

/** Gives the active object its own copy of a shared material. */
export function makeMaterialUnique(objId: ID, slot: number): void {
  const s = scene3d.peek();
  const o = s?.objects[objId];
  if (!s || !o || o.kind !== 'mesh') return;
  const src = s.materials[o.materials[slot] ?? ''];
  if (!src) return;
  const copy = createMaterial({
    ...structuredClone(src),
    id: undefined as unknown as string,
    name: `${src.name} copy`,
  });
  copy.id = uid('mat');
  commit3d('Make material unique', (sc) => {
    const next = addMaterial(sc, copy);
    const mats = o.materials.slice();
    mats[slot] = copy.id;
    return patchObject<MeshObj>(next, objId, { materials: mats });
  });
}

export function addMaterialSlot(objId: ID): void {
  const s = scene3d.peek();
  const o = s?.objects[objId];
  if (!o || o.kind !== 'mesh') return;
  const mat = createMaterial({ name: 'Material', color: '#7c5cff' });
  commit3d('Add material slot', (sc) =>
    patchObject<MeshObj>(addMaterial(sc, mat), objId, {
      materials: [...(o.materials.length ? o.materials : ['']), mat.id],
    }),
  );
}

/** Edit mode: puts the selected faces on a material slot. */
export function assignSlotToFaces(objId: ID, slot: number): void {
  const o = scene3d.peek()?.objects[objId];
  const faces = editSel.peek().faces;
  if (!o || o.kind !== 'mesh' || !faces.size) {
    toast('Select faces in edit mode, then assign them.', 'info');
    return;
  }
  commit3d('Assign material', (s) => assignMaterial(s, objId, o.materials[slot] ?? '', faces));
}

export function setTexture(matId: ID, slot: keyof Material3D['maps'], textureId: ID | null): void {
  commit3d(textureId ? 'Add texture' : 'Remove texture', (s) => {
    const m = s.materials[matId];
    if (!m) return s;
    const maps = { ...m.maps };
    if (textureId) maps[slot] = textureId;
    else delete maps[slot];
    return updateMaterialIn(s, matId, { maps });
  });
}

/* ------------------------------------------------------------- modifiers */

export function addModifier(kind: ModifierKind): void {
  const o = activeMesh();
  if (!o) {
    toast('Select a shape to add an effect to it.', 'info');
    return;
  }
  const mod = createModifier(kind);
  commit3d(`Add ${kind}`, (s) =>
    patchObject<MeshObj>(s, o.id, { modifiers: [...o.modifiers, mod] }),
  );
  emit('3d:modifier', { kind });
}

export function updateModifier(
  objId: ID,
  modId: ID,
  patch: Partial<Modifier>,
  coalesce = true,
): void {
  commit3d(
    'Change effect',
    (s) =>
      updateObject(s, objId, (o) =>
        o.kind === 'mesh'
          ? {
              ...o,
              modifiers: o.modifiers.map((m) =>
                m.id === modId ? ({ ...m, ...patch } as Modifier) : m,
              ),
            }
          : o,
      ),
    { coalesce: coalesce ? `mod:${modId}` : undefined },
  );
}

export function removeModifier(objId: ID, modId: ID): void {
  commit3d('Remove effect', (s) =>
    updateObject(s, objId, (o) =>
      o.kind === 'mesh' ? { ...o, modifiers: o.modifiers.filter((m) => m.id !== modId) } : o,
    ),
  );
}

export function moveModifier(objId: ID, modId: ID, dir: -1 | 1): void {
  commit3d('Reorder effects', (s) =>
    updateObject(s, objId, (o) => {
      if (o.kind !== 'mesh') return o;
      const i = o.modifiers.findIndex((m) => m.id === modId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.modifiers.length) return o;
      const mods = o.modifiers.slice();
      [mods[i], mods[j]] = [mods[j]!, mods[i]!];
      return { ...o, modifiers: mods };
    }),
  );
}

/** Bakes one modifier (and the ones above it) into the mesh. */
export function applyModifier(objId: ID, modId: ID): void {
  commit3d('Apply effect', (s) =>
    updateObject(s, objId, (o) => {
      if (o.kind !== 'mesh') return o;
      const i = o.modifiers.findIndex((m) => m.id === modId);
      if (i < 0) return o;
      let mesh = o.mesh;
      for (const m of o.modifiers.slice(0, i + 1)) if (m.enabled) mesh = applyModifierTo(mesh, m);
      return { ...o, mesh, modifiers: o.modifiers.slice(i + 1) };
    }),
  );
}

/** Bakes the whole stack (e.g. before exporting to a game engine). */
export function applyAllModifiers(objId: ID): void {
  commit3d('Apply all effects', (s) =>
    updateObject(s, objId, (o) =>
      o.kind === 'mesh' && o.modifiers.length
        ? { ...o, mesh: evaluate(o.mesh, o.modifiers), modifiers: [] }
        : o,
    ),
  );
}

/* -------------------------------------------------------------- animation */

export function setTime(t: number): void {
  const s = scene3d.peek();
  if (!s) return;
  time3d.value = Math.max(0, t);
}

export function togglePlay(): void {
  playing3d.value = !playing3d.peek();
  if (playing3d.peek()) emit('3d:played', {});
}

/** I: keys position, rotation and scale of the selected objects at the current time. */
export function insertKeys(channels: readonly ('p' | 'r' | 's')[] = ['p', 'r', 's']): void {
  const ids = selection3d.peek().ids;
  if (!ids.length) {
    toast('Select something to animate first.', 'info');
    return;
  }
  const t = time3d.peek();
  commit3d('Add keyframe', (s) => ids.reduce((acc, id) => keyObject(acc, id, t, channels), s));
  emit('3d:keyed', { how: 'insert' });
}

export function deleteKeysAtTime(): void {
  const ids = selection3d.peek().ids;
  const t = time3d.peek();
  commit3d('Remove keyframe', (s) => ids.reduce((acc, id) => unkeyObject(acc, id, t), s));
}

export function applyMotion(preset: MotionPreset, duration?: number): void {
  const s = scene3d.peek();
  const ids = selection3d.peek().ids;
  if (!s || !ids.length) {
    toast('Select something to animate first.', 'info');
    return;
  }
  const start = time3d.peek();
  const dur = duration ?? Math.max(1, Math.min(4, s.anim.end - start || 2));
  commit3d(`Motion: ${preset}`, (sc) => {
    let next = sc;
    for (const id of ids)
      next = updateObject(next, id, (o) => ({
        ...o,
        anim: mergeChannels(o.anim, presetKeys(preset, transformAt(o, start), start, dur)),
      }));
    const end = Math.max(next.anim.end, start + dur);
    return end !== next.anim.end ? { ...next, anim: { ...next.anim, end } } : next;
  });
  emit('3d:keyed', { how: preset });
}

export function clearAnimation(): void {
  const ids = selection3d.peek().ids;
  const t = time3d.peek();
  commit3d('Remove animation', (s) =>
    ids.reduce(
      (acc, id) =>
        updateObject(acc, id, (o) =>
          o.anim ? { ...o, t: transformAt(o, t), anim: undefined } : o,
        ),
      s,
    ),
  );
}

/** Changes how motion eases out of the given key times on the selected objects. */
export function setKeyEase(times: number[], e: Ease): void {
  const ids = selection3d.peek().ids;
  commit3d('Change easing', (s) =>
    ids.reduce(
      (acc, id) =>
        updateObject(acc, id, (o) => {
          if (!o.anim) return o;
          const anim = Object.fromEntries(
            Object.entries(o.anim).map(([ch, keys]) => [ch, setEase(keys, times, e)]),
          );
          return { ...o, anim };
        }),
      s,
    ),
  );
}

export function moveKeyTimes(objIds: ID[], times: number[], dt: number, coalesce?: string): void {
  commit3d(
    'Move keyframes',
    (s) =>
      objIds.reduce(
        (acc, id) =>
          updateObject(acc, id, (o) => {
            if (!o.anim) return o;
            const anim = Object.fromEntries(
              Object.entries(o.anim).map(([ch, keys]) => [ch, moveKeys(keys, times, dt)]),
            );
            return { ...o, anim };
          }),
        s,
      ),
    { coalesce },
  );
}

export function deleteKeyTimes(objIds: ID[], times: number[]): void {
  commit3d('Delete keyframes', (s) =>
    objIds.reduce(
      (acc, id) =>
        updateObject(acc, id, (o) => {
          if (!o.anim) return o;
          const pose = transformAt(o, time3d.peek());
          const anim = Object.fromEntries(
            Object.entries(o.anim)
              .map(([ch, keys]) => [ch, removeKeys(keys, times)])
              .filter(([, k]) => (k as unknown[]).length),
          );
          return Object.keys(anim).length ? { ...o, anim } : { ...o, t: pose, anim: undefined };
        }),
      s,
    ),
  );
}

export function allKeyTimes(objIds: ID[]): number[] {
  const s = scene3d.peek();
  if (!s) return [];
  const set = new Set<number>();
  for (const id of objIds)
    for (const t of keyTimes(s.objects[id]?.anim)) set.add(Math.round(t * 1000) / 1000);
  return [...set].sort((a, b) => a - b);
}

export function setAnimRange(start: number, end: number): void {
  commit3d(
    'Animation length',
    (s) => ({ ...s, anim: { start: Math.max(0, start), end: Math.max(start + 0.1, end) } }),
    { coalesce: 'anim-range' },
  );
}

/* ---------------------------------------------------------- world/render */

export function patchWorld(patch: Partial<World3D>, coalesce?: string): void {
  commit3d('Change world', (s) => ({ ...s, world: { ...s.world, ...patch } }), {
    coalesce: coalesce ? `world:${coalesce}` : undefined,
  });
}

export function patchRender(patch: Partial<RenderSettings3D>, coalesce?: string): void {
  commit3d('Change render settings', (s) => ({ ...s, render: { ...s.render, ...patch } }), {
    coalesce: coalesce ? `render:${coalesce}` : undefined,
  });
}

/** The objects a "select children" or outliner click would act on. */
export function withChildren(id: ID): ID[] {
  const s = scene3d.peek();
  return s ? [id, ...descendants(s, id)] : [id];
}

/** Edge keys of the selection as [a, b] pairs (debugging and status bar). */
export function selectionCounts(): { verts: number; edges: number; faces: number } {
  const e = editSel.peek();
  return { verts: e.verts.size, edges: e.edges.size, faces: e.faces.size };
}

export { edgeEnds, edgeTable };
