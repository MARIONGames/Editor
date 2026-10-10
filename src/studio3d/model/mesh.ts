/**
 * Polygon mesh helpers: topology queries (cached by array identity, so they are free to
 * call repeatedly), normals, triangulation and an easy-to-edit working form.
 */
import type { MeshData } from './types';

export const vertCount = (m: MeshData): number => m.v.length / 3;
export const faceCount = (m: MeshData): number => m.fs.length;

/* ------------------------------------------------------------------ offsets */

const offsetCache = new WeakMap<Uint32Array, Uint32Array>();

/** Start of each face in `f` (length faceCount + 1). */
export function faceOffsets(m: MeshData): Uint32Array {
  let o = offsetCache.get(m.fs);
  if (!o) {
    o = new Uint32Array(m.fs.length + 1);
    for (let i = 0; i < m.fs.length; i++) o[i + 1] = o[i]! + m.fs[i]!;
    offsetCache.set(m.fs, o);
  }
  return o;
}

export function faceVerts(m: MeshData, face: number): number[] {
  const o = faceOffsets(m);
  return Array.from(m.f.subarray(o[face]!, o[face + 1]!));
}

/* ------------------------------------------------------------------- edges */

/** Unique key for the undirected edge a–b (works for meshes up to 16.7M vertices). */
export const EDGE_BASE = 2 ** 24;
export const edgeKey = (a: number, b: number): number =>
  a < b ? a * EDGE_BASE + b : b * EDGE_BASE + a;
export const edgeEnds = (key: number): [number, number] => [
  Math.floor(key / EDGE_BASE),
  key % EDGE_BASE,
];

export interface EdgeTable {
  /** Edge keys in first-seen order. */
  keys: number[];
  index: Map<number, number>;
  /** Faces using each edge. */
  faces: number[][];
}

const edgeCache = new WeakMap<Uint32Array, EdgeTable>();

export function edgeTable(m: MeshData): EdgeTable {
  let t = edgeCache.get(m.f);
  if (t) return t;
  const keys: number[] = [];
  const index = new Map<number, number>();
  const faces: number[][] = [];
  const o = faceOffsets(m);
  for (let fi = 0; fi < m.fs.length; fi++) {
    const s = o[fi]!;
    const n = m.fs[fi]!;
    for (let c = 0; c < n; c++) {
      const k = edgeKey(m.f[s + c]!, m.f[s + ((c + 1) % n)]!);
      let ei = index.get(k);
      if (ei === undefined) {
        ei = keys.length;
        index.set(k, ei);
        keys.push(k);
        faces.push([]);
      }
      faces[ei]!.push(fi);
    }
  }
  t = { keys, index, faces };
  edgeCache.set(m.f, t);
  return t;
}

/** Faces around each vertex (CSR layout). */
export interface VertexFaces {
  start: Uint32Array;
  faces: Uint32Array;
}

const vfCache = new WeakMap<Uint32Array, VertexFaces>();

export function vertexFaces(m: MeshData): VertexFaces {
  let r = vfCache.get(m.f);
  if (r) return r;
  const nv = vertCount(m);
  const count = new Uint32Array(nv + 1);
  for (let i = 0; i < m.f.length; i++) count[m.f[i]! + 1]!++;
  for (let i = 0; i < nv; i++) count[i + 1]! += count[i]!;
  const fill = count.slice(0, nv);
  const faces = new Uint32Array(m.f.length);
  const o = faceOffsets(m);
  for (let fi = 0; fi < m.fs.length; fi++) {
    for (let c = o[fi]!; c < o[fi + 1]!; c++) faces[fill[m.f[c]!]!++] = fi;
  }
  r = { start: count, faces };
  vfCache.set(m.f, r);
  return r;
}

/* ----------------------------------------------------------------- geometry */

/** Area-weighted face normal (Newell's method, not normalized). */
export function faceNormalRaw(m: MeshData, face: number, out: number[] = [0, 0, 0]): number[] {
  const o = faceOffsets(m);
  const s = o[face]!;
  const n = m.fs[face]!;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let c = 0; c < n; c++) {
    const a = m.f[s + c]! * 3;
    const b = m.f[s + ((c + 1) % n)]! * 3;
    const ax = m.v[a]!,
      ay = m.v[a + 1]!,
      az = m.v[a + 2]!;
    const bx = m.v[b]!,
      by = m.v[b + 1]!,
      bz = m.v[b + 2]!;
    x += (ay - by) * (az + bz);
    y += (az - bz) * (ax + bx);
    z += (ax - bx) * (ay + by);
  }
  out[0] = x / 2;
  out[1] = y / 2;
  out[2] = z / 2;
  return out;
}

export function faceNormal(m: MeshData, face: number, out: number[] = [0, 0, 0]): number[] {
  faceNormalRaw(m, face, out);
  const l = Math.hypot(out[0]!, out[1]!, out[2]!) || 1;
  out[0]! /= l;
  out[1]! /= l;
  out[2]! /= l;
  return out;
}

export function faceCenter(m: MeshData, face: number, out: number[] = [0, 0, 0]): number[] {
  const o = faceOffsets(m);
  const n = m.fs[face]!;
  out[0] = out[1] = out[2] = 0;
  for (let c = o[face]!; c < o[face + 1]!; c++) {
    const i = m.f[c]! * 3;
    out[0]! += m.v[i]!;
    out[1]! += m.v[i + 1]!;
    out[2]! += m.v[i + 2]!;
  }
  out[0]! /= n;
  out[1]! /= n;
  out[2]! /= n;
  return out;
}

export function bounds(m: MeshData): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const x = m.v[i + k]!;
      if (x < min[k]!) min[k] = x;
      if (x > max[k]!) max[k] = x;
    }
  }
  if (!m.v.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Signed volume (positive when faces point outwards). */
export function signedVolume(m: MeshData): number {
  const tri = triangulate(m);
  let vol = 0;
  for (let t = 0; t < tri.corners.length; t += 3) {
    const a = m.f[tri.corners[t]!]! * 3;
    const b = m.f[tri.corners[t + 1]!]! * 3;
    const c = m.f[tri.corners[t + 2]!]! * 3;
    const ax = m.v[a]!,
      ay = m.v[a + 1]!,
      az = m.v[a + 2]!;
    const bx = m.v[b]!,
      by = m.v[b + 1]!,
      bz = m.v[b + 2]!;
    const cx = m.v[c]!,
      cy = m.v[c + 1]!,
      cz = m.v[c + 2]!;
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return vol / 6;
}

/** Every edge is shared by exactly two faces that use it in opposite directions. */
export function isClosedManifold(m: MeshData): boolean {
  const dir = new Map<number, number>();
  const o = faceOffsets(m);
  for (let fi = 0; fi < m.fs.length; fi++) {
    const n = m.fs[fi]!;
    for (let c = 0; c < n; c++) {
      const a = m.f[o[fi]! + c]!;
      const b = m.f[o[fi]! + ((c + 1) % n)]!;
      if (a === b) return false;
      const k = edgeKey(a, b);
      const sign = a < b ? 1 : -1;
      const prev = dir.get(k) ?? 0;
      if (prev === sign || Math.abs(prev) > 1) return false;
      dir.set(k, prev === 0 ? sign : 2);
    }
  }
  for (const v of dir.values()) if (v !== 2) return false;
  return true;
}

/* ------------------------------------------------------------ triangulation */

export interface Triangulation {
  /** Three corner indices (into `f`) per triangle. */
  corners: Uint32Array;
  /** Source face of each triangle. */
  face: Uint32Array;
}

const triCache = new WeakMap<Uint32Array, WeakMap<Float32Array, Triangulation>>();

export function triangulate(m: MeshData): Triangulation {
  let byV = triCache.get(m.f);
  let t = byV?.get(m.v);
  if (t) return t;
  const o = faceOffsets(m);
  let total = 0;
  for (let i = 0; i < m.fs.length; i++) total += Math.max(0, m.fs[i]! - 2);
  const corners = new Uint32Array(total * 3);
  const face = new Uint32Array(total);
  let w = 0;
  const nrm = [0, 0, 0];
  for (let fi = 0; fi < m.fs.length; fi++) {
    const s = o[fi]!;
    const n = m.fs[fi]!;
    if (n < 3) continue;
    let tris: number[];
    if (n === 3) tris = [0, 1, 2];
    else {
      faceNormalRaw(m, fi, nrm);
      tris = triangulatePolygon(m.v, m.f.subarray(s, s + n), nrm);
    }
    for (let k = 0; k < tris.length; k += 3) {
      corners[w * 3] = s + tris[k]!;
      corners[w * 3 + 1] = s + tris[k + 1]!;
      corners[w * 3 + 2] = s + tris[k + 2]!;
      face[w] = fi;
      w++;
    }
  }
  t = { corners: corners.subarray(0, w * 3), face: face.subarray(0, w) };
  if (!byV) triCache.set(m.f, (byV = new WeakMap()));
  byV.set(m.v, t);
  return t;
}

/**
 * Ear clipping in the polygon's best-fit plane. Returns local corner indices (3 per
 * triangle). Quads use the shorter valid diagonal.
 */
export function triangulatePolygon(
  pos: ArrayLike<number>,
  idx: ArrayLike<number>,
  normal: number[],
): number[] {
  const n = idx.length;
  // Project to 2D by dropping the dominant normal axis.
  const ax = Math.abs(normal[0]!),
    ay = Math.abs(normal[1]!),
    az = Math.abs(normal[2]!);
  const drop = ax > ay && ax > az ? 0 : ay > az ? 1 : 2;
  const u = drop === 0 ? 1 : 0;
  const v = drop === 2 ? 1 : 2;
  const flip = (normal[drop] ?? 0) < 0;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = pos[idx[i]! * 3 + u]!;
    py[i] = pos[idx[i]! * 3 + v]! * (flip ? -1 : 1);
  }
  // Orientation of the projected polygon (CCW > 0) — keep winding consistent with `idx`.
  const cross = (a: number, b: number, c: number) =>
    (px[b]! - px[a]!) * (py[c]! - py[a]!) - (py[b]! - py[a]!) * (px[c]! - px[a]!);
  let area = 0;
  for (let i = 0; i < n; i++) area += px[i]! * py[(i + 1) % n]! - px[(i + 1) % n]! * py[i]!;
  const sgn = area >= 0 ? 1 : -1;
  if (n === 4) {
    const d02 = Math.hypot(px[0]! - px[2]!, py[0]! - py[2]!);
    const d13 = Math.hypot(px[1]! - px[3]!, py[1]! - py[3]!);
    const ok02 = cross(0, 1, 2) * sgn > 0 && cross(0, 2, 3) * sgn > 0;
    const ok13 = cross(1, 2, 3) * sgn > 0 && cross(1, 3, 0) * sgn > 0;
    if (ok02 && (!ok13 || d02 <= d13)) return [0, 1, 2, 0, 2, 3];
    if (ok13) return [1, 2, 3, 1, 3, 0];
    return [0, 1, 2, 0, 2, 3];
  }
  const rest: number[] = [];
  for (let i = 0; i < n; i++) rest.push(i);
  const out: number[] = [];
  let guard = n * n;
  while (rest.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[(i + rest.length - 1) % rest.length]!;
      const b = rest[i]!;
      const c = rest[(i + 1) % rest.length]!;
      if (cross(a, b, c) * sgn <= 1e-12) continue;
      let inside = false;
      for (const p of rest) {
        if (p === a || p === b || p === c) continue;
        if (cross(a, b, p) * sgn >= 0 && cross(b, c, p) * sgn >= 0 && cross(c, a, p) * sgn >= 0) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      out.push(a, b, c);
      rest.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate (self-intersecting or collinear): fall back to a fan.
      for (let i = 1; i < rest.length - 1; i++) out.push(rest[0]!, rest[i]!, rest[i + 1]!);
      return out;
    }
  }
  if (rest.length === 3) out.push(rest[0]!, rest[1]!, rest[2]!);
  return out;
}

/* ------------------------------------------------------------ working form */

/** Easy-to-edit mesh: plain arrays. Convert with `toWork` / `fromWork`. */
export interface Work {
  /** Positions, xyz per vertex. */
  v: number[];
  faces: number[][];
  /** Per-face corner UVs ([u0, v0, u1, v1, …]) or null when the face has none. */
  uvs: (number[] | null)[];
  mats: number[];
}

export function toWork(m: MeshData): Work {
  const o = faceOffsets(m);
  const faces: number[][] = [];
  const uvs: (number[] | null)[] = [];
  const mats: number[] = [];
  for (let fi = 0; fi < m.fs.length; fi++) {
    const s = o[fi]!;
    const e = o[fi + 1]!;
    faces.push(Array.from(m.f.subarray(s, e)));
    if (m.uv && !Number.isNaN(m.uv[s * 2]!)) uvs.push(Array.from(m.uv.subarray(s * 2, e * 2)));
    else uvs.push(null);
    mats.push(m.m ? m.m[fi]! : 0);
  }
  return { v: Array.from(m.v), faces, uvs, mats };
}

export function fromWork(w: Work, opts: { dropLoose?: boolean } = {}): MeshData {
  let v = w.v;
  let faces = w.faces;
  if (opts.dropLoose !== false) {
    const nv = v.length / 3;
    const used = new Uint8Array(nv);
    for (const f of faces) for (const i of f) used[i] = 1;
    let all = true;
    for (let i = 0; i < nv; i++) if (!used[i]) all = false;
    if (!all) {
      const remap = new Int32Array(nv).fill(-1);
      const nvv: number[] = [];
      for (let i = 0; i < nv; i++) {
        if (!used[i]) continue;
        remap[i] = nvv.length / 3;
        nvv.push(v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!);
      }
      v = nvv;
      faces = faces.map((f) => f.map((i) => remap[i]!));
    }
  }
  let total = 0;
  for (const f of faces) total += f.length;
  const f = new Uint32Array(total);
  const fs = new Uint32Array(faces.length);
  const hasUv = w.uvs.some((u) => !!u);
  const uv = hasUv ? new Float32Array(total * 2) : undefined;
  const hasMat = w.mats.some((x) => x !== 0);
  const mm = hasMat ? new Uint16Array(faces.length) : undefined;
  let c = 0;
  faces.forEach((face, fi) => {
    fs[fi] = face.length;
    const u = w.uvs[fi];
    for (let k = 0; k < face.length; k++) {
      f[c] = face[k]!;
      if (uv) {
        uv[c * 2] = u ? u[k * 2]! : NaN;
        uv[c * 2 + 1] = u ? u[k * 2 + 1]! : NaN;
      }
      c++;
    }
    if (mm) mm[fi] = w.mats[fi] ?? 0;
  });
  const out: MeshData = { v: new Float32Array(v), f, fs };
  if (uv) out.uv = uv;
  if (mm) out.m = mm;
  return out;
}

/** Builds a mesh from positions and faces (and optional corner UVs). */
export function makeMesh(
  v: number[],
  faces: number[][],
  uvs?: (number[] | null)[],
  mats?: number[],
): MeshData {
  return fromWork(
    { v, faces, uvs: uvs ?? faces.map(() => null), mats: mats ?? faces.map(() => 0) },
    { dropLoose: false },
  );
}

/** Copy of a mesh with only positions replaced (topology and UVs are shared). */
export function withPositions(m: MeshData, v: Float32Array): MeshData {
  return { ...m, v };
}
