/**
 * Pure scene operations (each returns a new Scene3D, sharing everything it didn't touch).
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { uid } from '../../util/id';
import { setKey, transformAt } from './animation';
import { bounds, fromWork, toWork, type Work } from './mesh';
import { presetMaterial } from './materials';
import { cube, primitive, type PrimitiveKind } from './primitives';
import type {
  AnimChannels,
  CameraObj,
  EmptyObj,
  ID,
  LightKind,
  LightObj,
  Material3D,
  MeshData,
  MeshObj,
  ModelObj,
  Obj3D,
  Scene3D,
  Transform3,
  Vec3,
} from './types';

export const identity = (): Transform3 => ({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });

/* ---------------------------------------------------------------- factories */

export const PRIMITIVE_NAMES: Record<PrimitiveKind, string> = {
  cube: 'Cube',
  sphere: 'Sphere',
  icosphere: 'Ico Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  torus: 'Torus',
  plane: 'Plane',
  grid: 'Grid',
  capsule: 'Capsule',
  pyramid: 'Pyramid',
};

export function meshObject(
  name: string,
  mesh: MeshData,
  materials: ID[] = [],
  t: Transform3 = identity(),
): MeshObj {
  return {
    id: uid('o'),
    kind: 'mesh',
    name,
    parent: null,
    t,
    visible: true,
    locked: false,
    mesh,
    materials,
    modifiers: [],
    shade: 'auto',
    smoothAngle: 30,
    castShadow: true,
    receiveShadow: true,
  };
}

export const LIGHT_NAMES: Record<LightKind, string> = {
  sun: 'Sun',
  point: 'Point light',
  spot: 'Spotlight',
  area: 'Area light',
};

export function lightObject(type: LightKind, t: Transform3 = identity()): LightObj {
  const intensity = type === 'sun' ? 3 : type === 'point' ? 300 : type === 'spot' ? 800 : 12;
  return {
    id: uid('o'),
    kind: 'light',
    name: LIGHT_NAMES[type],
    parent: null,
    t,
    visible: true,
    locked: false,
    light: {
      type,
      color: '#ffffff',
      intensity,
      range: 0,
      angle: 35,
      softness: 0.3,
      size: [1, 1],
      shadow: type !== 'area',
    },
  };
}

export function cameraObject(t: Transform3 = identity()): CameraObj {
  return {
    id: uid('o'),
    kind: 'camera',
    name: 'Camera',
    parent: null,
    t,
    visible: true,
    locked: false,
    camera: { fov: 40, near: 0.05, far: 500 },
  };
}

export function emptyObject(name = 'Empty', t: Transform3 = identity()): EmptyObj {
  return {
    id: uid('o'),
    kind: 'empty',
    name,
    parent: null,
    t,
    visible: true,
    locked: false,
    size: 1,
  };
}

export function modelObject(assetId: ID, name: string, t: Transform3 = identity()): ModelObj {
  return {
    id: uid('o'),
    kind: 'model',
    name,
    parent: null,
    t,
    visible: true,
    locked: false,
    assetId,
    clip: { name: null, speed: 1, loop: true, offset: 0 },
  };
}

/** A transform at `from` looking at `to` (cameras, spotlights, suns point down their -Z axis). */
export function lookAtTransform(from: Vec3, to: Vec3): Transform3 {
  const m = new Matrix4().lookAt(new Vector3(...from), new Vector3(...to), new Vector3(0, 1, 0));
  const e = new Euler().setFromRotationMatrix(m, 'XYZ');
  return { p: from, r: [e.x, e.y, e.z], s: [1, 1, 1] };
}

export function createScene(name: string): Scene3D {
  const now = Date.now();
  return {
    schema: 1,
    id: uid('s'),
    name,
    kind: '3d',
    objects: {},
    order: [],
    materials: {},
    textures: {},
    assets: {},
    world: {
      env: 'studio',
      hdri: null,
      envIntensity: 1,
      envRotation: 0,
      background: 'blur',
      color: '#20222b',
      floorShadow: true,
    },
    render: {
      width: 1920,
      height: 1080,
      fps: 30,
      exposure: 1,
      tone: 'agx',
      shadows: true,
      camera: null,
      transparent: false,
    },
    anim: { start: 0, end: 5 },
    createdAt: now,
    updatedAt: now,
  };
}

/** A cube, a sun and a camera — the familiar starting point. */
export function starterScene(name: string, withCube = true): Scene3D {
  let s = createScene(name);
  const clay = presetMaterial('clay', 'Clay');
  s = addMaterial(s, clay);
  const objs: Obj3D[] = [];
  if (withCube)
    objs.push(meshObject('Cube', cube(), [clay.id], { p: [0, 1, 0], r: [0, 0, 0], s: [1, 1, 1] }));
  const sun = lightObject('sun', lookAtTransform([4, 8, 3], [0, 0, 0]));
  const cam = cameraObject(lookAtTransform([7, 5, 9], [0, 1, 0]));
  objs.push(sun, cam);
  s = addObjects(s, objs);
  return { ...s, render: { ...s.render, camera: cam.id } };
}

/* ------------------------------------------------------------------ helpers */

export function uniqueName(scene: Scene3D, base: string): string {
  const names = new Set(Object.values(scene.objects).map((o) => o.name));
  if (!names.has(base)) return base;
  const root = base.replace(/\.\d{3}$/, '');
  for (let i = 1; ; i++) {
    const n = `${root}.${String(i).padStart(3, '0')}`;
    if (!names.has(n)) return n;
  }
}

function touch(scene: Scene3D, objects: Record<ID, Obj3D>, order = scene.order): Scene3D {
  return { ...scene, objects, order };
}

export function updateObject(scene: Scene3D, id: ID, fn: (o: Obj3D) => Obj3D): Scene3D {
  const o = scene.objects[id];
  if (!o) return scene;
  const n = fn(o);
  if (n === o) return scene;
  return touch(scene, { ...scene.objects, [id]: n });
}

export function patchObject<T extends Obj3D>(scene: Scene3D, id: ID, patch: Partial<T>): Scene3D {
  return updateObject(scene, id, (o) => ({ ...o, ...patch }) as Obj3D);
}

export function addObjects(scene: Scene3D, objs: Obj3D[], parent: ID | null = null): Scene3D {
  const objects = { ...scene.objects };
  const order = scene.order.slice();
  let s = scene;
  for (const o of objs) {
    const named = { ...o, name: uniqueName(s, o.name), parent: parent ?? o.parent };
    objects[named.id] = named;
    order.push(named.id);
    s = { ...s, objects };
  }
  return touch(scene, objects, order);
}

export function childrenOf(scene: Scene3D, id: ID | null): ID[] {
  return scene.order.filter((c) => scene.objects[c]?.parent === id);
}

export function descendants(scene: Scene3D, id: ID): ID[] {
  const out: ID[] = [];
  const walk = (p: ID) => {
    for (const c of childrenOf(scene, p)) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

/** Objects in outliner order: each parent followed by its children (with depth). */
export function outlinerRows(scene: Scene3D): { id: ID; depth: number }[] {
  const rows: { id: ID; depth: number }[] = [];
  const walk = (p: ID | null, depth: number) => {
    for (const c of childrenOf(scene, p)) {
      rows.push({ id: c, depth });
      walk(c, depth + 1);
    }
  };
  walk(null, 0);
  // Orphans (parent missing) still show up.
  for (const id of scene.order) if (!rows.some((r) => r.id === id)) rows.push({ id, depth: 0 });
  return rows;
}

/* --------------------------------------------------------------- transforms */

export function matrixOf(t: Transform3): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...t.p),
    new Quaternion().setFromEuler(new Euler(t.r[0], t.r[1], t.r[2], 'XYZ')),
    new Vector3(...t.s),
  );
}

export function transformOf(m: Matrix4): Transform3 {
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  m.decompose(p, q, s);
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  const clean = (x: number) => (Math.abs(x) < 1e-9 ? 0 : x);
  return {
    p: [clean(p.x), clean(p.y), clean(p.z)],
    r: [clean(e.x), clean(e.y), clean(e.z)],
    s: [s.x, s.y, s.z],
  };
}

/** World matrix of an object at time t (animation and parents included). */
export function worldMatrix(scene: Scene3D, id: ID, t = 0): Matrix4 {
  const o = scene.objects[id];
  if (!o) return new Matrix4();
  const local = matrixOf(transformAt(o, t));
  return o.parent && scene.objects[o.parent]
    ? worldMatrix(scene, o.parent, t).multiply(local)
    : local;
}

/** Sets an object's transform so that its world matrix becomes `world`. */
export function localFromWorld(scene: Scene3D, id: ID, world: Matrix4, t = 0): Transform3 {
  const o = scene.objects[id]!;
  if (!o.parent || !scene.objects[o.parent]) return transformOf(world);
  const parentInv = worldMatrix(scene, o.parent, t).invert();
  return transformOf(parentInv.multiply(world));
}

/**
 * Changes an object's transform at time t. Properties that are already animated (or
 * all of them when auto-key is on) get a keyframe; the rest change directly.
 */
export function setTransformAt(
  scene: Scene3D,
  id: ID,
  next: Transform3,
  t: number,
  autoKey: boolean,
): Scene3D {
  return updateObject(scene, id, (o) => {
    const anim: AnimChannels = { ...(o.anim ?? {}) };
    const base = { ...o.t };
    let keyed = false;
    for (const ch of ['p', 'r', 's'] as const) {
      const value = next[ch];
      const cur = transformAt(o, t)[ch];
      const changed = value.some((x, i) => Math.abs(x - cur[i]!) > 1e-9);
      if (!changed) continue;
      if (autoKey || (anim[ch] && anim[ch]!.length)) {
        anim[ch] = setKey(anim[ch], t, value);
        keyed = true;
      } else base[ch] = value;
    }
    return { ...o, t: base, ...(keyed ? { anim } : {}) };
  });
}

/** Inserts keyframes for the object's current pose at time t (I). */
export function keyObject(
  scene: Scene3D,
  id: ID,
  t: number,
  channels: readonly ('p' | 'r' | 's')[] = ['p', 'r', 's'],
): Scene3D {
  return updateObject(scene, id, (o) => {
    const pose = transformAt(o, t);
    const anim: AnimChannels = { ...(o.anim ?? {}) };
    for (const ch of channels) anim[ch] = setKey(anim[ch], t, pose[ch]);
    return { ...o, anim };
  });
}

/** Removes the object's keys at time t (Alt+I). */
export function unkeyObject(scene: Scene3D, id: ID, t: number, eps = 1 / 240): Scene3D {
  return updateObject(scene, id, (o) => {
    if (!o.anim) return o;
    const pose = transformAt(o, t);
    const anim: AnimChannels = {};
    for (const [ch, keys] of Object.entries(o.anim)) {
      const left = keys.filter((k) => Math.abs(k.t - t) >= eps);
      if (left.length) anim[ch] = left;
    }
    const empty = !Object.keys(anim).length;
    // When the last key goes, the object stays in the pose it had.
    return { ...o, t: empty ? pose : o.t, anim: empty ? undefined : anim };
  });
}

export function setParent(scene: Scene3D, ids: ID[], parent: ID | null, t = 0): Scene3D {
  let s = scene;
  for (const id of ids) {
    if (id === parent) continue;
    if (parent && descendants(s, id).includes(parent)) continue;
    const world = worldMatrix(s, id, t);
    s = patchObject(s, id, { parent });
    s = patchObject(s, id, { t: localFromWorld(s, id, world, t) });
  }
  return s;
}

/* ------------------------------------------------------------ remove / copy */

export function removeObjects(scene: Scene3D, ids: ID[]): Scene3D {
  const drop = new Set(ids);
  let s = scene;
  // Children of removed objects stay where they are (re-parented to the grandparent).
  for (const id of ids) {
    const o = s.objects[id];
    if (!o) continue;
    for (const c of childrenOf(s, id)) {
      if (drop.has(c)) continue;
      let p = o.parent;
      while (p && drop.has(p)) p = s.objects[p]?.parent ?? null;
      s = setParent(s, [c], p);
    }
  }
  const objects = { ...s.objects };
  for (const id of drop) delete objects[id];
  return {
    ...s,
    objects,
    order: s.order.filter((id) => !drop.has(id)),
    render: drop.has(s.render.camera ?? '') ? { ...s.render, camera: null } : s.render,
  };
}

/**
 * Copies objects (Shift+D). A linked duplicate (Alt+D) shares the mesh data, so editing
 * one edits both — exactly how instanced props work in games.
 */
export function duplicateObjects(
  scene: Scene3D,
  ids: ID[],
  linked = false,
): { scene: Scene3D; ids: ID[] } {
  const map = new Map<ID, ID>();
  const all = new Set<ID>();
  for (const id of ids) {
    all.add(id);
    for (const d of descendants(scene, id)) all.add(d);
  }
  const copies: Obj3D[] = [];
  for (const id of scene.order) {
    if (!all.has(id)) continue;
    const o = scene.objects[id]!;
    const nid = uid('o');
    map.set(id, nid);
    let copy: Obj3D;
    if (o.kind === 'mesh') {
      const { mesh, ...rest } = o;
      copy = {
        ...structuredClone(rest),
        kind: 'mesh',
        mesh: linked ? mesh : { ...mesh, v: mesh.v.slice() },
      };
    } else copy = structuredClone(o);
    copies.push({ ...copy, id: nid });
  }
  for (const c of copies) if (c.parent && map.has(c.parent)) c.parent = map.get(c.parent)!;
  return { scene: addObjects(scene, copies), ids: ids.map((id) => map.get(id)!) };
}

/* ----------------------------------------------------------- mesh structure */

/** Moves the object's transform into its vertices (Ctrl+A → All transforms). */
export function applyTransform(scene: Scene3D, id: ID): Scene3D {
  const o = scene.objects[id];
  if (!o || o.kind !== 'mesh') return scene;
  const m = matrixOf(o.t);
  const v = o.mesh.v.slice();
  const p = new Vector3();
  for (let i = 0; i < v.length; i += 3) {
    p.set(v[i]!, v[i + 1]!, v[i + 2]!).applyMatrix4(m);
    v[i] = p.x;
    v[i + 1] = p.y;
    v[i + 2] = p.z;
  }
  let mesh: MeshData = { ...o.mesh, v };
  // A negative scale turns the mesh inside out: flip faces back.
  if (m.determinant() < 0) {
    const w = toWork(mesh);
    w.faces = w.faces.map((f) => f.slice().reverse());
    w.uvs = w.uvs.map((uv, i) => {
      if (!uv) return null;
      const n = w.faces[i]!.length;
      const r: number[] = [];
      for (let c = n - 1; c >= 0; c--) r.push(uv[c * 2]!, uv[c * 2 + 1]!);
      return r;
    });
    mesh = fromWork(w, { dropLoose: false });
  }
  // Children keep their world placement.
  let s = patchObject<MeshObj>(scene, id, { mesh, t: identity() });
  for (const c of childrenOf(scene, id)) {
    const child = s.objects[c]!;
    s = patchObject(s, c, { t: transformOf(m.clone().multiply(matrixOf(child.t))) });
  }
  return s;
}

export type OriginMode = 'geometry' | 'bottom' | 'world';

/** Moves the object's origin (pivot) without moving its shape. */
export function setOrigin(scene: Scene3D, id: ID, mode: OriginMode): Scene3D {
  const o = scene.objects[id];
  if (!o || o.kind !== 'mesh' || !o.mesh.v.length) return scene;
  const b = bounds(o.mesh);
  let local: Vec3;
  if (mode === 'geometry')
    local = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  else if (mode === 'bottom')
    local = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
  else {
    const inv = matrixOf(o.t).invert();
    const w = new Vector3(0, 0, 0).applyMatrix4(inv);
    local = [w.x, w.y, w.z];
  }
  const v = o.mesh.v.slice();
  for (let i = 0; i < v.length; i += 3) {
    v[i]! -= local[0];
    v[i + 1]! -= local[1];
    v[i + 2]! -= local[2];
  }
  const wp = new Vector3(...local).applyMatrix4(matrixOf(o.t));
  return patchObject<MeshObj>(scene, id, {
    mesh: { ...o.mesh, v },
    t: { ...o.t, p: [wp.x, wp.y, wp.z] },
  });
}

/** Joins meshes into `target` (Ctrl+J), keeping where everything is in the world. */
export function joinMeshes(scene: Scene3D, ids: ID[], target: ID): Scene3D {
  const tgt = scene.objects[target];
  if (!tgt || tgt.kind !== 'mesh') return scene;
  const inv = worldMatrix(scene, target).invert();
  const w: Work = toWork(tgt.mesh);
  const materials = tgt.materials.slice();
  const p = new Vector3();
  const others: ID[] = [];
  for (const id of ids) {
    const o = scene.objects[id];
    if (!o || id === target || o.kind !== 'mesh') continue;
    others.push(id);
    const m = inv.clone().multiply(worldMatrix(scene, id));
    const base = w.v.length / 3;
    for (let i = 0; i < o.mesh.v.length; i += 3) {
      p.set(o.mesh.v[i]!, o.mesh.v[i + 1]!, o.mesh.v[i + 2]!).applyMatrix4(m);
      w.v.push(p.x, p.y, p.z);
    }
    const ow = toWork(o.mesh);
    const slotMap = (o.materials.length ? o.materials : ['']).map((mat) => {
      if (!mat) return 0;
      let i = materials.indexOf(mat);
      if (i < 0) {
        i = materials.length;
        materials.push(mat);
      }
      return i;
    });
    const flip = m.determinant() < 0;
    ow.faces.forEach((f, fi) => {
      w.faces.push((flip ? f.slice().reverse() : f).map((i) => i + base));
      const uv = ow.uvs[fi];
      if (uv && flip) {
        const r: number[] = [];
        for (let c = f.length - 1; c >= 0; c--) r.push(uv[c * 2]!, uv[c * 2 + 1]!);
        w.uvs.push(r);
      } else w.uvs.push(uv ?? null);
      w.mats.push(slotMap[ow.mats[fi]!] ?? 0);
    });
  }
  if (!others.length) return scene;
  const s = patchObject<MeshObj>(scene, target, {
    mesh: fromWork(w, { dropLoose: false }),
    materials,
  });
  return removeObjects(s, others);
}

/** Moves the given faces into a new object (P → Selection). */
export function separateFaces(
  scene: Scene3D,
  id: ID,
  faces: Set<number>,
): { scene: Scene3D; id: ID | null } {
  const o = scene.objects[id];
  if (!o || o.kind !== 'mesh' || !faces.size || faces.size === o.mesh.fs.length)
    return { scene, id: null };
  const w = toWork(o.mesh);
  const keep: Work = { v: w.v, faces: [], uvs: [], mats: [] };
  const part: Work = { v: w.v.slice(), faces: [], uvs: [], mats: [] };
  w.faces.forEach((f, fi) => {
    const dst = faces.has(fi) ? part : keep;
    dst.faces.push(f);
    dst.uvs.push(w.uvs[fi]!);
    dst.mats.push(w.mats[fi]!);
  });
  const copy = meshObject(`${o.name} part`, fromWork(part), o.materials.slice(), { ...o.t });
  let s = patchObject<MeshObj>(scene, id, { mesh: fromWork(keep) });
  s = addObjects(s, [
    {
      ...copy,
      parent: o.parent,
      modifiers: structuredClone(o.modifiers),
      shade: o.shade,
      smoothAngle: o.smoothAngle,
    },
  ]);
  return { scene: s, id: copy.id };
}

/* ---------------------------------------------------------------- materials */

export function addMaterial(scene: Scene3D, mat: Material3D): Scene3D {
  return { ...scene, materials: { ...scene.materials, [mat.id]: mat } };
}

export function updateMaterial(scene: Scene3D, id: ID, patch: Partial<Material3D>): Scene3D {
  const m = scene.materials[id];
  if (!m) return scene;
  return { ...scene, materials: { ...scene.materials, [id]: { ...m, ...patch } } };
}

/**
 * Gives an object a material. With `faces` (edit mode) only those faces get it — a new
 * material slot is added if needed.
 */
export function assignMaterial(scene: Scene3D, objId: ID, matId: ID, faces?: Set<number>): Scene3D {
  return updateObject(scene, objId, (o) => {
    if (o.kind !== 'mesh') return o;
    if (!faces || !faces.size) {
      // Whole object: one material for every face.
      const { m: _slots, ...mesh } = o.mesh;
      return { ...o, materials: [matId], mesh };
    }
    // '' marks "no material" (drawn with the default look).
    const materials = o.materials.length ? o.materials.slice() : [''];
    let slot = materials.indexOf(matId);
    if (slot < 0) {
      slot = materials.length;
      materials.push(matId);
    }
    const m = o.mesh.m ? o.mesh.m.slice() : new Uint16Array(o.mesh.fs.length);
    for (const f of faces) m[f] = slot;
    return { ...o, materials, mesh: { ...o.mesh, m } };
  });
}

/** Materials no object uses any more. */
export function unusedMaterials(scene: Scene3D): ID[] {
  const used = new Set<ID>();
  for (const o of Object.values(scene.objects))
    if (o.kind === 'mesh') for (const m of o.materials) used.add(m);
  return Object.keys(scene.materials).filter((id) => !used.has(id));
}

/* ----------------------------------------------------------------- creation */

export function addPrimitive(
  scene: Scene3D,
  kind: PrimitiveKind,
  at: Vec3,
  matId?: ID,
): { scene: Scene3D; id: ID } {
  let s = scene;
  let mat = matId;
  if (!mat) {
    const m = presetMaterial('clay', 'Clay');
    const existing = Object.values(s.materials).find((x) => x.name === 'Clay');
    if (existing) mat = existing.id;
    else {
      s = addMaterial(s, m);
      mat = m.id;
    }
  }
  const mesh = primitive(kind);
  // Sit on the floor rather than half under it.
  const b = bounds(mesh);
  const lift = kind === 'plane' || kind === 'grid' ? 0 : -b.min[1];
  const o = meshObject(PRIMITIVE_NAMES[kind], mesh, [mat], {
    p: [at[0], at[1] + lift, at[2]],
    r: [0, 0, 0],
    s: [1, 1, 1],
  });
  return { scene: addObjects(s, [o]), id: o.id };
}

/** Axis-aligned world bounds of every visible mesh (null when there are none). */
export function sceneBounds(
  scene: Scene3D,
  ids?: ID[],
  t = 0,
): { min: Vector3; max: Vector3 } | null {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  let any = false;
  for (const id of ids ?? scene.order) {
    const o = scene.objects[id];
    if (!o || !o.visible) continue;
    const m = worldMatrix(scene, id, t);
    if (o.kind === 'mesh' && o.mesh.v.length) {
      const b = bounds(o.mesh);
      for (let i = 0; i < 8; i++) {
        p.set(
          i & 1 ? b.max[0] : b.min[0],
          i & 2 ? b.max[1] : b.min[1],
          i & 4 ? b.max[2] : b.min[2],
        ).applyMatrix4(m);
        min.min(p);
        max.max(p);
        any = true;
      }
    } else if (ids) {
      p.setFromMatrixPosition(m);
      min.min(p);
      max.max(p);
      any = true;
    }
  }
  return any ? { min, max } : null;
}

/** Faces assigned to each material slot of a mesh. */
export function facesBySlot(o: MeshObj): number[][] {
  const out: number[][] = o.materials.map(() => []);
  if (!out.length) out.push([]);
  for (let f = 0; f < o.mesh.fs.length; f++) {
    const slot = o.mesh.m ? o.mesh.m[f]! : 0;
    (out[Math.min(slot, out.length - 1)] ??= []).push(f);
  }
  return out;
}
