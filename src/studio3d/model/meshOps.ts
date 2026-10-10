/**
 * Modeling operations. Every function is pure: it takes a mesh (and a selection) and
 * returns a new mesh plus what should be selected afterwards, so the editor can undo,
 * redo and "adjust the last operation" by simply re-running it.
 */
import {
  edgeEnds,
  edgeKey,
  edgeTable,
  faceCenter,
  faceNormal,
  faceOffsets,
  fromWork,
  toWork,
  triangulate,
  vertCount,
  vertexFaces,
  type Work,
} from './mesh';
import type { MeshData } from './types';

export type SelectMode = 'vert' | 'edge' | 'face';

export interface MeshSelection {
  verts: Set<number>;
  /** Edge keys (see `edgeKey`). */
  edges: Set<number>;
  faces: Set<number>;
}

export const emptySelection = (): MeshSelection => ({
  verts: new Set(),
  edges: new Set(),
  faces: new Set(),
});

/* --------------------------------------------------------------- selection */

/** Fills in edges/faces from vertices (an edge/face is selected when all its vertices are). */
export function selectionFromVerts(m: MeshData, verts: Set<number>): MeshSelection {
  const edges = new Set<number>();
  const faces = new Set<number>();
  const et = edgeTable(m);
  for (const k of et.keys) {
    const [a, b] = edgeEnds(k);
    if (verts.has(a) && verts.has(b)) edges.add(k);
  }
  const o = faceOffsets(m);
  for (let fi = 0; fi < m.fs.length; fi++) {
    let all = true;
    for (let c = o[fi]!; c < o[fi + 1]!; c++) if (!verts.has(m.f[c]!)) all = false;
    if (all) faces.add(fi);
  }
  return { verts: new Set(verts), edges, faces };
}

export function selectionFromEdges(m: MeshData, edges: Set<number>): MeshSelection {
  const verts = new Set<number>();
  for (const k of edges) for (const v of edgeEnds(k)) verts.add(v);
  const s = selectionFromVerts(m, verts);
  // Keep exactly the chosen edges plus faces whose edges are all chosen.
  const faces = new Set<number>();
  const o = faceOffsets(m);
  for (const fi of s.faces) {
    const n = m.fs[fi]!;
    let all = true;
    for (let c = 0; c < n; c++)
      if (!edges.has(edgeKey(m.f[o[fi]! + c]!, m.f[o[fi]! + ((c + 1) % n)]!))) all = false;
    if (all) faces.add(fi);
  }
  return { verts, edges: new Set(edges), faces };
}

export function selectionFromFaces(m: MeshData, faces: Set<number>): MeshSelection {
  const verts = new Set<number>();
  const edges = new Set<number>();
  const o = faceOffsets(m);
  for (const fi of faces) {
    const n = m.fs[fi]!;
    for (let c = 0; c < n; c++) {
      const a = m.f[o[fi]! + c]!;
      verts.add(a);
      edges.add(edgeKey(a, m.f[o[fi]! + ((c + 1) % n)]!));
    }
  }
  return { verts, edges, faces: new Set(faces) };
}

export function selectAll(m: MeshData): MeshSelection {
  const verts = new Set<number>();
  for (let i = 0; i < vertCount(m); i++) verts.add(i);
  return selectionFromVerts(m, verts);
}

export function invertSelection(m: MeshData, sel: MeshSelection, mode: SelectMode): MeshSelection {
  if (mode === 'face') {
    const faces = new Set<number>();
    for (let i = 0; i < m.fs.length; i++) if (!sel.faces.has(i)) faces.add(i);
    return selectionFromFaces(m, faces);
  }
  if (mode === 'edge') {
    const edges = new Set<number>();
    for (const k of edgeTable(m).keys) if (!sel.edges.has(k)) edges.add(k);
    return selectionFromEdges(m, edges);
  }
  const verts = new Set<number>();
  for (let i = 0; i < vertCount(m); i++) if (!sel.verts.has(i)) verts.add(i);
  return selectionFromVerts(m, verts);
}

/** Every vertex connected to the selection (Ctrl+L). */
export function selectLinked(m: MeshData, seed: Set<number>): MeshSelection {
  const vf = vertexFaces(m);
  const o = faceOffsets(m);
  const seen = new Set<number>(seed);
  const stack = [...seed];
  while (stack.length) {
    const v = stack.pop()!;
    for (let k = vf.start[v]!; k < vf.start[v + 1]!; k++) {
      const fi = vf.faces[k]!;
      for (let c = o[fi]!; c < o[fi + 1]!; c++) {
        const u = m.f[c]!;
        if (!seen.has(u)) {
          seen.add(u);
          stack.push(u);
        }
      }
    }
  }
  return selectionFromVerts(m, seen);
}

/** Grow (Ctrl+NumpadPlus) or shrink (Ctrl+NumpadMinus) the vertex selection by one ring. */
export function growSelection(m: MeshData, verts: Set<number>, grow: boolean): MeshSelection {
  const vf = vertexFaces(m);
  const o = faceOffsets(m);
  if (grow) {
    const out = new Set(verts);
    for (const v of verts)
      for (let k = vf.start[v]!; k < vf.start[v + 1]!; k++) {
        const fi = vf.faces[k]!;
        for (let c = o[fi]!; c < o[fi + 1]!; c++) out.add(m.f[c]!);
      }
    return selectionFromVerts(m, out);
  }
  const out = new Set<number>();
  for (const v of verts) {
    let inner = true;
    for (let k = vf.start[v]!; k < vf.start[v + 1]! && inner; k++) {
      const fi = vf.faces[k]!;
      for (let c = o[fi]!; c < o[fi + 1]!; c++) if (!verts.has(m.f[c]!)) inner = false;
    }
    if (inner) out.add(v);
  }
  return selectionFromVerts(m, out);
}

/** Edges around a vertex. */
function vertexEdges(m: MeshData, v: number): number[] {
  const vf = vertexFaces(m);
  const o = faceOffsets(m);
  const out = new Set<number>();
  for (let k = vf.start[v]!; k < vf.start[v + 1]!; k++) {
    const fi = vf.faces[k]!;
    const n = m.fs[fi]!;
    for (let c = 0; c < n; c++) {
      const a = m.f[o[fi]! + c]!;
      const b = m.f[o[fi]! + ((c + 1) % n)]!;
      if (a === v || b === v) out.add(edgeKey(a, b));
    }
  }
  return [...out];
}

/**
 * Edge loop through `start` (Alt+click): continues straight across every 4-way vertex.
 */
export function edgeLoop(m: MeshData, start: number): Set<number> {
  const et = edgeTable(m);
  const loop = new Set<number>([start]);
  const walk = (from: number, edge: number) => {
    let prevEdge = edge;
    let v = from;
    for (let guard = 0; guard < 100000; guard++) {
      const around = vertexEdges(m, v);
      if (around.length !== 4) return;
      const facesOfPrev = new Set(et.faces[et.index.get(prevEdge)!]);
      // The continuing edge shares no face with the edge we came along.
      const next = around.find(
        (e) => e !== prevEdge && !et.faces[et.index.get(e)!]!.some((f) => facesOfPrev.has(f)),
      );
      if (next === undefined || loop.has(next)) return;
      loop.add(next);
      const [a, b] = edgeEnds(next);
      v = a === v ? b : a;
      prevEdge = next;
    }
  };
  const [a, b] = edgeEnds(start);
  walk(b, start);
  walk(a, start);
  return loop;
}

/* --------------------------------------------------------------- transforms */

/** Applies a 4×4 column-major matrix to the given vertices. */
export function transformVerts(
  m: MeshData,
  verts: Iterable<number>,
  mat: ArrayLike<number>,
): MeshData {
  const v = m.v.slice();
  for (const i of verts) {
    const x = m.v[i * 3]!,
      y = m.v[i * 3 + 1]!,
      z = m.v[i * 3 + 2]!;
    v[i * 3] = mat[0]! * x + mat[4]! * y + mat[8]! * z + mat[12]!;
    v[i * 3 + 1] = mat[1]! * x + mat[5]! * y + mat[9]! * z + mat[13]!;
    v[i * 3 + 2] = mat[2]! * x + mat[6]! * y + mat[10]! * z + mat[14]!;
  }
  return { ...m, v };
}

export function translateVerts(
  m: MeshData,
  verts: Iterable<number>,
  d: [number, number, number],
): MeshData {
  return transformVerts(m, verts, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d[0], d[1], d[2], 1]);
}

/** Center of the selected vertices (median point). */
export function selectionCenter(
  m: MeshData,
  verts: Iterable<number>,
): [number, number, number] | null {
  let n = 0;
  const c: [number, number, number] = [0, 0, 0];
  for (const i of verts) {
    c[0] += m.v[i * 3]!;
    c[1] += m.v[i * 3 + 1]!;
    c[2] += m.v[i * 3 + 2]!;
    n++;
  }
  if (!n) return null;
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** Average normal of the selected faces (or of faces touching the selected vertices). */
export function selectionNormal(m: MeshData, sel: MeshSelection): [number, number, number] {
  let faces = sel.faces;
  if (!faces.size) faces = selectionFromVerts(m, sel.verts).faces;
  if (!faces.size) {
    const vf = vertexFaces(m);
    faces = new Set();
    for (const v of sel.verts)
      for (let k = vf.start[v]!; k < vf.start[v + 1]!; k++) faces.add(vf.faces[k]!);
  }
  const n: [number, number, number] = [0, 0, 0];
  const t = [0, 0, 0];
  for (const fi of faces) {
    faceNormal(m, fi, t);
    n[0] += t[0]!;
    n[1] += t[1]!;
    n[2] += t[2]!;
  }
  const l = Math.hypot(...n) || 1;
  return l < 1e-9 ? [0, 1, 0] : [n[0] / l, n[1] / l, n[2] / l];
}

/* ------------------------------------------------------------ face clean-up */

/** Removes repeated corners and faces that collapsed to fewer than 3 corners. */
function cleanWork(w: Work): Work {
  const faces: number[][] = [];
  const uvs: (number[] | null)[] = [];
  const mats: number[] = [];
  w.faces.forEach((f, fi) => {
    const keep: number[] = [];
    const uv = w.uvs[fi];
    const kuv: number[] = [];
    for (let c = 0; c < f.length; c++) {
      if (f[c] === f[(c + 1) % f.length]) continue;
      keep.push(f[c]!);
      if (uv) kuv.push(uv[c * 2]!, uv[c * 2 + 1]!);
    }
    if (new Set(keep).size < 3) return;
    faces.push(keep);
    uvs.push(uv ? kuv : null);
    mats.push(w.mats[fi]!);
  });
  return { v: w.v, faces, uvs, mats };
}

function removeFaces(w: Work, drop: Set<number>): Work {
  return {
    v: w.v,
    faces: w.faces.filter((_, i) => !drop.has(i)),
    uvs: w.uvs.filter((_, i) => !drop.has(i)),
    mats: w.mats.filter((_, i) => !drop.has(i)),
  };
}

/* ------------------------------------------------------------------ extrude */

export interface OpResult {
  mesh: MeshData;
  sel: MeshSelection;
}

/**
 * Extrudes a region of faces (E): the faces move out along their average normal by
 * `distance`, walls are added along the region's border.
 */
export function extrudeFaces(m: MeshData, faces: Set<number>, distance = 0): OpResult {
  if (!faces.size) return { mesh: m, sel: emptySelection() };
  const w = toWork(m);
  const uses = new Map<number, number>();
  for (const fi of faces) {
    const f = w.faces[fi]!;
    for (let c = 0; c < f.length; c++) {
      const k = edgeKey(f[c]!, f[(c + 1) % f.length]!);
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  const dir = selectionNormal(m, { verts: new Set(), edges: new Set(), faces });
  const dup = new Map<number, number>();
  const copy = (v: number) => {
    let n = dup.get(v);
    if (n === undefined) {
      n = w.v.length / 3;
      w.v.push(
        w.v[v * 3]! + dir[0] * distance,
        w.v[v * 3 + 1]! + dir[1] * distance,
        w.v[v * 3 + 2]! + dir[2] * distance,
      );
      dup.set(v, n);
    }
    return n;
  };
  for (const fi of faces) {
    const f = w.faces[fi]!;
    for (let c = 0; c < f.length; c++) {
      const a = f[c]!;
      const b = f[(c + 1) % f.length]!;
      if (uses.get(edgeKey(a, b)) === 1) {
        w.faces.push([a, b, copy(b), copy(a)]);
        w.uvs.push(null);
        w.mats.push(w.mats[fi]!);
      }
    }
  }
  for (const fi of faces) w.faces[fi] = w.faces[fi]!.map(copy);
  const mesh = fromWork(w);
  return { mesh, sel: selectionFromFaces(mesh, faces) };
}

/** Extrudes edges (E in edge mode): each edge grows a new face, the new edges are selected. */
export function extrudeEdges(
  m: MeshData,
  edges: Set<number>,
  offset: [number, number, number] = [0, 0, 0],
): OpResult {
  if (!edges.size) return { mesh: m, sel: emptySelection() };
  const w = toWork(m);
  const et = edgeTable(m);
  const o = faceOffsets(m);
  const dup = new Map<number, number>();
  const copy = (v: number) => {
    let n = dup.get(v);
    if (n === undefined) {
      n = w.v.length / 3;
      w.v.push(w.v[v * 3]! + offset[0], w.v[v * 3 + 1]! + offset[1], w.v[v * 3 + 2]! + offset[2]);
      dup.set(v, n);
    }
    return n;
  };
  const newEdges: [number, number][] = [];
  for (const k of edges) {
    let [a, b] = edgeEnds(k);
    const ei = et.index.get(k);
    const fi = ei === undefined ? undefined : et.faces[ei]![0];
    if (fi !== undefined) {
      // Orient the new face against the existing one so normals stay consistent.
      const n = m.fs[fi]!;
      for (let c = 0; c < n; c++) {
        if (m.f[o[fi]! + c] === a && m.f[o[fi]! + ((c + 1) % n)] === b) [a, b] = [b, a];
      }
    }
    const na = copy(a);
    const nb = copy(b);
    w.faces.push([a, b, nb, na]);
    w.uvs.push(null);
    w.mats.push(fi === undefined ? 0 : w.mats[fi]!);
    newEdges.push([na, nb]);
  }
  const mesh = fromWork(w, { dropLoose: false });
  return { mesh, sel: selectionFromEdges(mesh, new Set(newEdges.map(([a, b]) => edgeKey(a, b)))) };
}

/* -------------------------------------------------------------------- inset */

/** Insets each face (I): a smaller copy inside it, joined by a ring of quads. */
export function insetFaces(
  m: MeshData,
  faces: Set<number>,
  thickness: number,
  depth = 0,
): OpResult {
  if (!faces.size) return { mesh: m, sel: emptySelection() };
  const w = toWork(m);
  const nrm = [0, 0, 0];
  for (const fi of faces) {
    const f = w.faces[fi]!;
    const n = f.length;
    faceNormal(m, fi, nrm);
    const P = f.map((i) => [w.v[i * 3]!, w.v[i * 3 + 1]!, w.v[i * 3 + 2]!] as const);
    const inner: number[] = [];
    const uv = w.uvs[fi];
    let cu = 0;
    let cv = 0;
    if (uv) {
      for (let c = 0; c < n; c++) {
        cu += uv[c * 2]! / n;
        cv += uv[c * 2 + 1]! / n;
      }
    }
    const center = [0, 0, 0];
    for (const p of P) for (let k = 0; k < 3; k++) center[k]! += p[k]! / n;
    const innerUv: number[] = [];
    for (let c = 0; c < n; c++) {
      const p = P[c]!;
      const prev = P[(c + n - 1) % n]!;
      const next = P[(c + 1) % n]!;
      const dPrev = norm(sub(p, prev));
      const dNext = norm(sub(next, p));
      const inPrev = norm(cross(nrm, dPrev));
      const inNext = norm(cross(nrm, dNext));
      let bis = norm([inPrev[0]! + inNext[0]!, inPrev[1]! + inNext[1]!, inPrev[2]! + inNext[2]!]);
      if (!Number.isFinite(bis[0]!)) bis = inNext;
      const cos = Math.max(0.2, dot(bis, inNext));
      const dist = thickness / cos;
      const q = [
        p[0] + bis[0]! * dist + nrm[0]! * depth,
        p[1] + bis[1]! * dist + nrm[1]! * depth,
        p[2] + bis[2]! * dist + nrm[2]! * depth,
      ];
      inner.push(w.v.length / 3);
      w.v.push(q[0]!, q[1]!, q[2]!);
      if (uv) {
        const toCenter = Math.hypot(center[0]! - p[0], center[1]! - p[1], center[2]! - p[2]) || 1;
        const t = Math.min(0.95, dist / toCenter);
        innerUv.push(
          uv[c * 2]! + (cu - uv[c * 2]!) * t,
          uv[c * 2 + 1]! + (cv - uv[c * 2 + 1]!) * t,
        );
      }
    }
    for (let c = 0; c < n; c++) {
      const c1 = (c + 1) % n;
      w.faces.push([f[c]!, f[c1]!, inner[c1]!, inner[c]!]);
      w.uvs.push(
        uv
          ? [
              uv[c * 2]!,
              uv[c * 2 + 1]!,
              uv[c1 * 2]!,
              uv[c1 * 2 + 1]!,
              innerUv[c1 * 2]!,
              innerUv[c1 * 2 + 1]!,
              innerUv[c * 2]!,
              innerUv[c * 2 + 1]!,
            ]
          : null,
      );
      w.mats.push(w.mats[fi]!);
    }
    w.faces[fi] = inner;
    w.uvs[fi] = uv ? innerUv : null;
  }
  const mesh = fromWork(w);
  return { mesh, sel: selectionFromFaces(mesh, faces) };
}

/* ------------------------------------------------------------------- delete */

export function deleteFaces(m: MeshData, faces: Set<number>): MeshData {
  return fromWork(removeFaces(toWork(m), faces));
}

export function deleteVerts(m: MeshData, verts: Set<number>): MeshData {
  const drop = new Set<number>();
  const o = faceOffsets(m);
  for (let fi = 0; fi < m.fs.length; fi++)
    for (let c = o[fi]!; c < o[fi + 1]!; c++)
      if (verts.has(m.f[c]!)) {
        drop.add(fi);
        break;
      }
  return deleteFaces(m, drop);
}

export function deleteEdges(m: MeshData, edges: Set<number>): MeshData {
  const et = edgeTable(m);
  const drop = new Set<number>();
  for (const k of edges) {
    const ei = et.index.get(k);
    if (ei !== undefined) for (const f of et.faces[ei]!) drop.add(f);
  }
  return deleteFaces(m, drop);
}

/** Removes edges but keeps the surface: the faces on both sides become one (Dissolve). */
export function dissolveEdges(m: MeshData, edges: Set<number>): OpResult {
  const et = edgeTable(m);
  const parent = new Int32Array(m.fs.length).map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (const k of edges) {
    const ei = et.index.get(k);
    if (ei === undefined) continue;
    const fs = et.faces[ei]!;
    if (fs.length === 2 && fs[0] !== fs[1]) parent[find(fs[0]!)] = find(fs[1]!);
  }
  const groups = new Map<number, number[]>();
  for (let fi = 0; fi < m.fs.length; fi++) {
    const r = find(fi);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(fi);
  }
  const w = toWork(m);
  const out: Work = { v: w.v, faces: [], uvs: [], mats: [] };
  const merged = new Set<number>();
  for (const members of groups.values()) {
    if (members.length === 1) {
      const fi = members[0]!;
      out.faces.push(w.faces[fi]!);
      out.uvs.push(w.uvs[fi]!);
      out.mats.push(w.mats[fi]!);
      continue;
    }
    // Directed boundary edges of the group (edges used once inside it).
    const count = new Map<number, number>();
    for (const fi of members) {
      const f = w.faces[fi]!;
      for (let c = 0; c < f.length; c++) {
        const k = edgeKey(f[c]!, f[(c + 1) % f.length]!);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    const next = new Map<number, number>();
    let ok = true;
    for (const fi of members) {
      const f = w.faces[fi]!;
      for (let c = 0; c < f.length; c++) {
        const a = f[c]!;
        const b = f[(c + 1) % f.length]!;
        if (count.get(edgeKey(a, b)) !== 1) continue;
        if (next.has(a)) ok = false;
        next.set(a, b);
      }
    }
    const loop: number[] = [];
    if (ok && next.size >= 3) {
      const first = next.keys().next().value as number;
      let v = first;
      for (let g = 0; g <= next.size; g++) {
        loop.push(v);
        v = next.get(v)!;
        if (v === first) break;
      }
      if (loop.length !== next.size) ok = false;
    } else ok = false;
    if (!ok) {
      // Holes or odd shapes: keep the original faces.
      for (const fi of members) {
        out.faces.push(w.faces[fi]!);
        out.uvs.push(w.uvs[fi]!);
        out.mats.push(w.mats[fi]!);
      }
      continue;
    }
    // Carry corner UVs over from the original faces.
    const uvOf = new Map<number, [number, number]>();
    let hasUv = true;
    for (const fi of members) {
      const uv = w.uvs[fi];
      if (!uv) hasUv = false;
      else w.faces[fi]!.forEach((v, c) => uvOf.set(v, [uv[c * 2]!, uv[c * 2 + 1]!]));
    }
    merged.add(out.faces.length);
    out.faces.push(loop);
    out.uvs.push(hasUv ? loop.flatMap((v) => uvOf.get(v) ?? [0, 0]) : null);
    out.mats.push(w.mats[members[0]!]!);
  }
  const mesh = fromWork(out);
  return { mesh, sel: selectionFromFaces(mesh, merged) };
}

/* -------------------------------------------------------------------- merge */

function remapWork(w: Work, map: (v: number) => number): Work {
  return cleanWork({ ...w, faces: w.faces.map((f) => f.map(map)) });
}

/** Merges the selected vertices into one at their center (M → At center). */
export function mergeAtCenter(m: MeshData, verts: Set<number>): OpResult {
  if (verts.size < 2) return { mesh: m, sel: selectionFromVerts(m, verts) };
  const c = selectionCenter(m, verts)!;
  const w = toWork(m);
  const target = Math.min(...verts);
  w.v[target * 3] = c[0];
  w.v[target * 3 + 1] = c[1];
  w.v[target * 3 + 2] = c[2];
  const mesh = fromWork(remapWork(w, (v) => (verts.has(v) ? target : v)));
  // Find the merged vertex again (indices shift when loose vertices are dropped).
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < vertCount(mesh); i++) {
    const d = Math.hypot(
      mesh.v[i * 3]! - c[0],
      mesh.v[i * 3 + 1]! - c[1],
      mesh.v[i * 3 + 2]! - c[2],
    );
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { mesh, sel: selectionFromVerts(mesh, new Set([best])) };
}

/** Joins vertices closer than `distance` (Merge by distance / "remove doubles"). */
export function mergeByDistance(
  m: MeshData,
  distance = 0.0001,
  only?: Set<number>,
): { mesh: MeshData; removed: number } {
  const n = vertCount(m);
  const cell = Math.max(distance, 1e-9) * 2;
  const grid = new Map<string, number[]>();
  const map = new Int32Array(n).map((_, i) => i);
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  let removed = 0;
  for (let i = 0; i < n; i++) {
    if (only && !only.has(i)) continue;
    const x = m.v[i * 3]!,
      y = m.v[i * 3 + 1]!,
      z = m.v[i * 3 + 2]!;
    const cx = Math.floor(x / cell),
      cy = Math.floor(y / cell),
      cz = Math.floor(z / cell);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++)
      for (let dy = -1; dy <= 1 && found < 0; dy++)
        for (let dz = -1; dz <= 1 && found < 0; dz++) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (Math.hypot(m.v[j * 3]! - x, m.v[j * 3 + 1]! - y, m.v[j * 3 + 2]! - z) <= distance) {
              found = j;
              break;
            }
          }
        }
    if (found >= 0) {
      map[i] = found;
      removed++;
    } else {
      const k = keyOf(x, y, z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(i);
    }
  }
  if (!removed) return { mesh: m, removed: 0 };
  return { mesh: fromWork(remapWork(toWork(m), (v) => map[v]!)), removed };
}

/* ------------------------------------------------------------------ normals */

export function flipFaces(m: MeshData, faces?: Set<number>): MeshData {
  const w = toWork(m);
  w.faces.forEach((f, fi) => {
    if (faces && !faces.has(fi)) return;
    w.faces[fi] = f.slice().reverse();
    const uv = w.uvs[fi];
    if (uv) {
      const pairs: number[] = [];
      for (let c = f.length - 1; c >= 0; c--) pairs.push(uv[c * 2]!, uv[c * 2 + 1]!);
      w.uvs[fi] = pairs;
    }
  });
  return fromWork(w, { dropLoose: false });
}

/** Makes every face point outwards (Shift+N), or inwards when `inside`. */
export function recalcNormals(m: MeshData, faces?: Set<number>, inside = false): MeshData {
  const et = edgeTable(m);
  const o = faceOffsets(m);
  const nf = m.fs.length;
  const inSet = (fi: number) => !faces || faces.has(fi);
  const flip = new Uint8Array(nf);
  const comp = new Int32Array(nf).fill(-1);
  const dirOf = (fi: number, a: number, b: number) => {
    // +1 when the face (as currently flipped) walks a→b.
    const n = m.fs[fi]!;
    for (let c = 0; c < n; c++) {
      const x = m.f[o[fi]! + c]!;
      const y = m.f[o[fi]! + ((c + 1) % n)]!;
      if (x === a && y === b) return flip[fi] ? -1 : 1;
      if (x === b && y === a) return flip[fi] ? 1 : -1;
    }
    return 0;
  };
  const components: number[][] = [];
  for (let s = 0; s < nf; s++) {
    if (comp[s]! >= 0 || !inSet(s)) continue;
    const id = components.length;
    const members: number[] = [];
    comp[s] = id;
    const queue = [s];
    while (queue.length) {
      const fi = queue.shift()!;
      members.push(fi);
      const n = m.fs[fi]!;
      for (let c = 0; c < n; c++) {
        const a = m.f[o[fi]! + c]!;
        const b = m.f[o[fi]! + ((c + 1) % n)]!;
        for (const g of et.faces[et.index.get(edgeKey(a, b))!]!) {
          if (g === fi || comp[g]! >= 0 || !inSet(g)) continue;
          comp[g] = id;
          // Neighbours must walk the shared edge the other way.
          if (dirOf(g, a, b) === dirOf(fi, a, b)) flip[g] = 1;
          queue.push(g);
        }
      }
    }
    components.push(members);
  }
  // Point each component away from its center: test the face farthest from it.
  const cen = [0, 0, 0];
  const nrm = [0, 0, 0];
  for (const members of components) {
    const center = [0, 0, 0];
    for (const fi of members) {
      faceCenter(m, fi, cen);
      for (let k = 0; k < 3; k++) center[k]! += cen[k]! / members.length;
    }
    let far = members[0]!;
    let fd = -1;
    for (const fi of members) {
      faceCenter(m, fi, cen);
      const d = Math.hypot(cen[0]! - center[0]!, cen[1]! - center[1]!, cen[2]! - center[2]!);
      if (d > fd) {
        fd = d;
        far = fi;
      }
    }
    faceCenter(m, far, cen);
    faceNormal(m, far, nrm);
    const outward =
      dot(nrm, [cen[0]! - center[0]!, cen[1]! - center[1]!, cen[2]! - center[2]!]) *
      (flip[far] ? -1 : 1);
    const wantFlip = outward < 0 !== inside;
    if (wantFlip) for (const fi of members) flip[fi] = flip[fi] ? 0 : 1;
  }
  const toFlip = new Set<number>();
  for (let fi = 0; fi < nf; fi++) if (flip[fi]) toFlip.add(fi);
  return toFlip.size ? flipFaces(m, toFlip) : m;
}

/* ---------------------------------------------------------------- subdivide */

/** Splits faces into smaller quads (Subdivide). Neighbours get the new edge points too. */
export function subdivideFaces(m: MeshData, faces: Set<number>): OpResult {
  if (!faces.size) return { mesh: m, sel: emptySelection() };
  const w = toWork(m);
  const mids = new Map<number, number>();
  const mid = (a: number, b: number) => {
    const k = edgeKey(a, b);
    let i = mids.get(k);
    if (i === undefined) {
      i = w.v.length / 3;
      w.v.push(
        (w.v[a * 3]! + w.v[b * 3]!) / 2,
        (w.v[a * 3 + 1]! + w.v[b * 3 + 1]!) / 2,
        (w.v[a * 3 + 2]! + w.v[b * 3 + 2]!) / 2,
      );
      mids.set(k, i);
    }
    return i;
  };
  const newFaces: number[] = [];
  const replaced = new Set<number>();
  const extra: { f: number[]; uv: number[] | null; mat: number }[] = [];
  for (const fi of faces) {
    const f = w.faces[fi]!;
    const n = f.length;
    const uv = w.uvs[fi];
    const center = w.v.length / 3;
    const c = [0, 0, 0];
    for (const v of f) for (let k = 0; k < 3; k++) c[k]! += w.v[v * 3 + k]! / n;
    w.v.push(c[0]!, c[1]!, c[2]!);
    let cu = 0;
    let cv = 0;
    if (uv)
      for (let k = 0; k < n; k++) {
        cu += uv[k * 2]! / n;
        cv += uv[k * 2 + 1]! / n;
      }
    for (let k = 0; k < n; k++) {
      const prev = (k + n - 1) % n;
      const next = (k + 1) % n;
      const quad = [f[k]!, mid(f[k]!, f[next]!), center, mid(f[prev]!, f[k]!)];
      const quv = uv
        ? [
            uv[k * 2]!,
            uv[k * 2 + 1]!,
            (uv[k * 2]! + uv[next * 2]!) / 2,
            (uv[k * 2 + 1]! + uv[next * 2 + 1]!) / 2,
            cu,
            cv,
            (uv[prev * 2]! + uv[k * 2]!) / 2,
            (uv[prev * 2 + 1]! + uv[k * 2 + 1]!) / 2,
          ]
        : null;
      extra.push({ f: quad, uv: quv, mat: w.mats[fi]! });
    }
    replaced.add(fi);
  }
  // Insert edge midpoints into unselected neighbours so the surface stays closed.
  w.faces.forEach((f, fi) => {
    if (replaced.has(fi)) return;
    const out: number[] = [];
    const uv = w.uvs[fi];
    const ouv: number[] = [];
    for (let c = 0; c < f.length; c++) {
      const a = f[c]!;
      const b = f[(c + 1) % f.length]!;
      out.push(a);
      if (uv) ouv.push(uv[c * 2]!, uv[c * 2 + 1]!);
      const mi = mids.get(edgeKey(a, b));
      if (mi !== undefined) {
        out.push(mi);
        if (uv) {
          const c1 = (c + 1) % f.length;
          ouv.push((uv[c * 2]! + uv[c1 * 2]!) / 2, (uv[c * 2 + 1]! + uv[c1 * 2 + 1]!) / 2);
        }
      }
    }
    w.faces[fi] = out;
    if (uv) w.uvs[fi] = ouv;
  });
  const keep = removeFaces(w, replaced);
  for (const e of extra) {
    newFaces.push(keep.faces.length);
    keep.faces.push(e.f);
    keep.uvs.push(e.uv);
    keep.mats.push(e.mat);
  }
  const mesh = fromWork(keep);
  return { mesh, sel: selectionFromFaces(mesh, new Set(newFaces)) };
}

/* --------------------------------------------------------------------- fill */

/** Makes a face from the selected vertices (F). Fills a hole when they form its border. */
export function fillVerts(m: MeshData, verts: Set<number>): OpResult {
  if (verts.size < 3) return { mesh: m, sel: selectionFromVerts(m, verts) };
  const et = edgeTable(m);
  const o = faceOffsets(m);
  // Border edges (one face) between selected verts, walked against their face's direction.
  const next = new Map<number, number>();
  for (let ei = 0; ei < et.keys.length; ei++) {
    if (et.faces[ei]!.length !== 1) continue;
    const [a, b] = edgeEnds(et.keys[ei]!);
    if (!verts.has(a) || !verts.has(b)) continue;
    const fi = et.faces[ei]![0]!;
    const n = m.fs[fi]!;
    for (let c = 0; c < n; c++) {
      const x = m.f[o[fi]! + c]!;
      const y = m.f[o[fi]! + ((c + 1) % n)]!;
      if (x === a && y === b) next.set(b, a);
      else if (x === b && y === a) next.set(a, b);
    }
  }
  let loop: number[] = [];
  if (next.size === verts.size) {
    const first = verts.values().next().value as number;
    let v = first;
    for (let g = 0; g < verts.size; g++) {
      loop.push(v);
      v = next.get(v) ?? -1;
      if (v < 0) break;
    }
    if (v !== first || loop.length !== verts.size) loop = [];
  }
  if (!loop.length) {
    // Free vertices: order them around their center in their best-fit plane.
    const ids = [...verts];
    const c = selectionCenter(m, ids)!;
    const rel = (i: number) => [m.v[i * 3]! - c[0], m.v[i * 3 + 1]! - c[1], m.v[i * 3 + 2]! - c[2]];
    // Plane normal from the largest triangle spanned around the center.
    let far = ids[0]!;
    for (const i of ids) if (Math.hypot(...rel(i)) > Math.hypot(...rel(far))) far = i;
    let nrm: number[] = [0, 1, 0];
    let best = 0;
    for (const i of ids) {
      const x = cross(rel(far), rel(i));
      const l = Math.hypot(x[0]!, x[1]!, x[2]!);
      if (l > best) {
        best = l;
        nrm = x;
      }
    }
    nrm = norm(nrm);
    if (!Number.isFinite(nrm[0]!)) nrm = [0, 1, 0];
    const ref = Math.abs(nrm[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const ax = norm(cross(ref, nrm));
    const ay = cross(nrm, ax);
    const ang = (i: number) => {
      const p = [m.v[i * 3]! - c[0], m.v[i * 3 + 1]! - c[1], m.v[i * 3 + 2]! - c[2]];
      return Math.atan2(dot(p, ay), dot(p, ax));
    };
    loop = ids.sort((a, b) => ang(a) - ang(b));
    // Face away from the rest of the mesh.
    const mc = selectionCenter(
      m,
      Array.from({ length: vertCount(m) }, (_, i) => i),
    )!;
    if (dot(nrm, [c[0] - mc[0], c[1] - mc[1], c[2] - mc[2]]) < 0) loop.reverse();
  }
  const w = toWork(m);
  w.faces.push(loop);
  w.uvs.push(null);
  w.mats.push(0);
  const mesh = fromWork(w, { dropLoose: false });
  return { mesh, sel: selectionFromFaces(mesh, new Set([mesh.fs.length - 1])) };
}

/* ----------------------------------------------------------------- triangles */

export function triangulateFaces(m: MeshData, faces?: Set<number>): MeshData {
  const tri = triangulate(m);
  const w = toWork(m);
  const out: Work = { v: w.v, faces: [], uvs: [], mats: [] };
  const o = faceOffsets(m);
  const done = new Set<number>();
  for (let t = 0; t < tri.face.length; t++) {
    const fi = tri.face[t]!;
    if ((faces && !faces.has(fi)) || m.fs[fi] === 3) continue;
    done.add(fi);
    const cs = [tri.corners[t * 3]!, tri.corners[t * 3 + 1]!, tri.corners[t * 3 + 2]!];
    out.faces.push(cs.map((c) => m.f[c]!));
    out.uvs.push(
      m.uv && !Number.isNaN(m.uv[o[fi]! * 2]!)
        ? cs.flatMap((c) => [m.uv![c * 2]!, m.uv![c * 2 + 1]!])
        : null,
    );
    out.mats.push(w.mats[fi]!);
  }
  w.faces.forEach((f, fi) => {
    if (done.has(fi)) return;
    out.faces.push(f);
    out.uvs.push(w.uvs[fi]!);
    out.mats.push(w.mats[fi]!);
  });
  return fromWork(out, { dropLoose: false });
}

/** Joins pairs of triangles into quads where they form a flat, convex quad (Alt+J). */
export function trisToQuads(m: MeshData, maxAngleDeg = 40): MeshData {
  const et = edgeTable(m);
  const w = toWork(m);
  const used = new Uint8Array(m.fs.length);
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  const n1 = [0, 0, 0];
  const n2 = [0, 0, 0];
  const cand: { e: number; score: number }[] = [];
  for (let ei = 0; ei < et.keys.length; ei++) {
    const fs = et.faces[ei]!;
    if (fs.length !== 2 || m.fs[fs[0]!] !== 3 || m.fs[fs[1]!] !== 3) continue;
    faceNormal(m, fs[0]!, n1);
    faceNormal(m, fs[1]!, n2);
    const d = dot(n1, n2);
    if (d < cosMax) continue;
    cand.push({ e: ei, score: d });
  }
  cand.sort((a, b) => b.score - a.score);
  const out: Work = { v: w.v, faces: [], uvs: [], mats: [] };
  for (const { e } of cand) {
    const [fa, fb] = et.faces[e]! as [number, number];
    if (used[fa] || used[fb] || w.mats[fa] !== w.mats[fb]) continue;
    const [a, b] = edgeEnds(et.keys[e]!);
    const A = w.faces[fa]!;
    const B = w.faces[fb]!;
    const oppA = A.find((x) => x !== a && x !== b)!;
    const oppB = B.find((x) => x !== a && x !== b)!;
    // Quad in A's winding: start at oppA, walk A, insert oppB between the shared vertices.
    const i = A.indexOf(oppA);
    const q = [A[i]!, A[(i + 1) % 3]!, oppB, A[(i + 2) % 3]!];
    const pos = (v: number) => [w.v[v * 3]!, w.v[v * 3 + 1]!, w.v[v * 3 + 2]!];
    // Convexity check: all corner turns agree with the face normal.
    faceNormal(m, fa, n1);
    let convex = true;
    for (let k = 0; k < 4; k++) {
      const p0 = pos(q[k]!);
      const p1 = pos(q[(k + 1) % 4]!);
      const p2 = pos(q[(k + 2) % 4]!);
      if (dot(cross(sub(p1, p0), sub(p2, p1)), n1) <= 0) convex = false;
    }
    if (!convex) continue;
    used[fa] = used[fb] = 1;
    out.faces.push(q);
    const uvA = w.uvs[fa];
    const uvB = w.uvs[fb];
    if (uvA && uvB) {
      const uvFor = (v: number) => {
        const ia = A.indexOf(v);
        if (ia >= 0) return [uvA[ia * 2]!, uvA[ia * 2 + 1]!];
        const ib = B.indexOf(v);
        return [uvB[ib * 2]!, uvB[ib * 2 + 1]!];
      };
      out.uvs.push(q.flatMap(uvFor));
    } else out.uvs.push(null);
    out.mats.push(w.mats[fa]!);
  }
  w.faces.forEach((f, fi) => {
    if (used[fi]) return;
    out.faces.push(f);
    out.uvs.push(w.uvs[fi]!);
    out.mats.push(w.mats[fi]!);
  });
  return fromWork(out, { dropLoose: false });
}

/* ----------------------------------------------------------------------- UV */

/** Box projection (cube mapping): every face takes UVs from the axis it faces most. */
export function boxProjectUV(m: MeshData, faces?: Set<number>, scale = 1): MeshData {
  const o = faceOffsets(m);
  const uv = m.uv ? m.uv.slice() : new Float32Array(m.f.length * 2).fill(NaN);
  const n = [0, 0, 0];
  for (let fi = 0; fi < m.fs.length; fi++) {
    if (faces && !faces.has(fi)) continue;
    faceNormal(m, fi, n);
    const ax = Math.abs(n[0]!),
      ay = Math.abs(n[1]!),
      az = Math.abs(n[2]!);
    for (let c = o[fi]!; c < o[fi + 1]!; c++) {
      const i = m.f[c]! * 3;
      const x = m.v[i]!,
        y = m.v[i + 1]!,
        z = m.v[i + 2]!;
      let u: number;
      let v: number;
      if (ax >= ay && ax >= az) {
        u = n[0]! > 0 ? -z : z;
        v = y;
      } else if (ay >= az) {
        u = x;
        v = n[1]! > 0 ? -z : z;
      } else {
        u = n[2]! > 0 ? x : -x;
        v = y;
      }
      uv[c * 2] = u * scale + 0.5;
      uv[c * 2 + 1] = v * scale + 0.5;
    }
  }
  return { ...m, uv };
}

/* --------------------------------------------------------------- vector math */

export function sub(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}
export function cross(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}
export function norm(a: ArrayLike<number>): number[] {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!);
  return l < 1e-12 ? [NaN, NaN, NaN] : [a[0]! / l, a[1]! / l, a[2]! / l];
}
