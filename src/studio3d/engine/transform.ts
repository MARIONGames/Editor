/**
 * Shared math for moving things: the gizmo and the G/R/S keys both produce a world-space
 * delta matrix, and this turns it into a new scene for objects or for mesh vertices.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { transformVerts, selectionCenter } from '../model/meshOps';
import { localFromWorld, patchObject, setTransformAt, worldMatrix } from '../model/scene';
import type { ID, MeshObj, Scene3D } from '../model/types';

export type PivotMode = 'median' | 'active' | 'individual';
export type Orientation = 'global' | 'local';

export interface TransformTargets {
  kind: 'objects' | 'verts';
  base: Scene3D;
  time: number;
  autoKey: boolean;
  /** Objects that move (children of moved objects are left out: they follow their parent). */
  ids: ID[];
  /** Vertex mode: the edited object and its selected vertices. */
  objId?: ID;
  verts?: number[];
  pivot: Vector3;
  /** Orientation of the gizmo / local constraint axes. */
  orient: Quaternion;
  pivotMode: PivotMode;
}

export function objectTargets(
  base: Scene3D,
  ids: readonly ID[],
  active: ID | null,
  time: number,
  autoKey: boolean,
  pivotMode: PivotMode,
): TransformTargets | null {
  const chosen = new Set(ids);
  const roots = ids.filter((id) => {
    const o = base.objects[id];
    if (!o || o.locked) return false;
    for (let p = o.parent; p; p = base.objects[p]?.parent ?? null) if (chosen.has(p)) return false;
    return true;
  });
  if (!roots.length) return null;
  const pos = new Vector3();
  const pivot = new Vector3();
  for (const id of roots) pivot.add(pos.setFromMatrixPosition(worldMatrix(base, id, time)));
  pivot.divideScalar(roots.length);
  const ref = active && roots.includes(active) ? active : roots[roots.length - 1]!;
  const refWorld = worldMatrix(base, ref, time);
  if (pivotMode === 'active') pivot.setFromMatrixPosition(refWorld);
  const orient = new Quaternion();
  refWorld.decompose(new Vector3(), orient, new Vector3());
  return { kind: 'objects', base, time, autoKey, ids: roots, pivot, orient, pivotMode };
}

export function vertexTargets(
  base: Scene3D,
  objId: ID,
  verts: Iterable<number>,
  time: number,
): TransformTargets | null {
  const o = base.objects[objId];
  if (!o || o.kind !== 'mesh') return null;
  const list = [...verts];
  const c = selectionCenter(o.mesh, list);
  if (!c) return null;
  const world = worldMatrix(base, objId, time);
  const pivot = new Vector3(...c).applyMatrix4(world);
  const orient = new Quaternion();
  world.decompose(new Vector3(), orient, new Vector3());
  return {
    kind: 'verts',
    base,
    time,
    autoKey: false,
    ids: [objId],
    objId,
    verts: list,
    pivot,
    orient,
    pivotMode: 'median',
  };
}

const _a = new Matrix4();
const _b = new Matrix4();

/** The scene with `delta` (a world-space matrix) applied to the targets. */
export function applyDelta(t: TransformTargets, delta: Matrix4): Scene3D {
  if (t.kind === 'verts') {
    const o = t.base.objects[t.objId!] as MeshObj;
    const world = worldMatrix(t.base, o.id, t.time);
    // World delta → object space: O⁻¹ · D · O.
    const local = world.clone().invert().multiply(delta).multiply(world);
    return patchObject<MeshObj>(t.base, o.id, {
      mesh: transformVerts(o.mesh, t.verts!, local.elements),
    });
  }
  let s = t.base;
  // For "individual origins" the delta's rotation/scale happens around each object's own origin.
  // A = T(-P) · D · T(P) is the delta relative to the pivot.
  const centered =
    t.pivotMode === 'individual'
      ? _a
          .makeTranslation(-t.pivot.x, -t.pivot.y, -t.pivot.z)
          .multiply(delta)
          .multiply(_b.makeTranslation(t.pivot))
      : null;
  const pos = new Vector3();
  for (const id of t.ids) {
    const w = worldMatrix(t.base, id, t.time);
    let d = delta;
    if (centered) {
      pos.setFromMatrixPosition(w);
      d = new Matrix4()
        .makeTranslation(pos)
        .multiply(centered)
        .multiply(new Matrix4().makeTranslation(-pos.x, -pos.y, -pos.z));
    }
    const next = d.clone().multiply(w);
    s = setTransformAt(s, id, localFromWorld(t.base, id, next, t.time), t.time, t.autoKey);
  }
  return s;
}

/* -------------------------------------------------------- delta builders */

export function moveDelta(d: Vector3): Matrix4 {
  return new Matrix4().makeTranslation(d);
}

export function rotateDelta(pivot: Vector3, axis: Vector3, angle: number): Matrix4 {
  return new Matrix4()
    .makeTranslation(pivot)
    .multiply(new Matrix4().makeRotationAxis(axis.clone().normalize(), angle))
    .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/** Scale by `s` along the axes of `orient`, around the pivot. */
export function scaleDelta(pivot: Vector3, orient: Quaternion, s: Vector3): Matrix4 {
  const r = new Matrix4().makeRotationFromQuaternion(orient);
  const ri = r.clone().transpose();
  return new Matrix4()
    .makeTranslation(pivot)
    .multiply(r)
    .multiply(new Matrix4().makeScale(s.x, s.y, s.z))
    .multiply(ri)
    .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}
