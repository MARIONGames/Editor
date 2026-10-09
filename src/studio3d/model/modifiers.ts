/**
 * Non-destructive modifier stack. `evaluate` runs the enabled modifiers top to bottom
 * and caches the result by input identity, so redrawing an unchanged object is free.
 */
import { uid } from '../../util/id';
import { bounds, faceNormalRaw, faceOffsets, fromWork, toWork, vertCount, type Work } from './mesh';
import { mergeByDistance, triangulateFaces } from './meshOps';
import { bevelEdges, sharpEdges } from './meshTools';
import { catmullClark } from './subdivision';
import type { MeshData, Modifier, ModifierKind } from './types';

export const MODIFIER_INFO: Record<ModifierKind, { name: string; plain: string; hint: string }> = {
  mirror: { name: 'Mirror', plain: 'Mirror', hint: 'Model one half, get the other half for free (great for characters and cars)' },
  array: { name: 'Array', plain: 'Repeat', hint: 'Copies the object in a row — stairs, fences, chains' },
  solidify: { name: 'Solidify', plain: 'Thickness', hint: 'Gives flat surfaces a real thickness' },
  subdivision: { name: 'Subdivision Surface', plain: 'Smooth', hint: 'Rounds everything off for smooth, organic shapes' },
  bevel: { name: 'Bevel', plain: 'Rounded edges', hint: 'Softens sharp edges so they catch the light like real objects' },
  decimate: { name: 'Decimate', plain: 'Fewer polygons', hint: 'Reduces the polygon count for games and the web' },
  triangulate: { name: 'Triangulate', plain: 'Triangles', hint: 'Turns every face into triangles, the way game engines draw them' },
  weld: { name: 'Weld', plain: 'Weld', hint: 'Joins vertices that sit on top of each other' },
  displace: { name: 'Displace', plain: 'Bumpy', hint: 'Pushes the surface in and out — rocks, terrain, organic detail' },
};

export function createModifier(kind: ModifierKind): Modifier {
  const base = { id: uid('mod'), enabled: true };
  switch (kind) {
    case 'mirror':
      return { ...base, kind, axes: [true, false, false], merge: 0.001 };
    case 'array':
      return { ...base, kind, count: 3, relative: [1.1, 0, 0], constant: [0, 0, 0] };
    case 'solidify':
      return { ...base, kind, thickness: 0.1 };
    case 'subdivision':
      return { ...base, kind, levels: 2 };
    case 'bevel':
      return { ...base, kind, width: 0.08, angle: 30 };
    case 'decimate':
      return { ...base, kind, ratio: 0.5 };
    case 'triangulate':
      return { ...base, kind };
    case 'weld':
      return { ...base, kind, distance: 0.001 };
    case 'displace':
      return { ...base, kind, strength: 0.15, scale: 0.5, seed: 1 };
  }
}

/** Keeps subdivision from freezing the app on heavy meshes. */
export const MAX_FACES = 600_000;

const cache = new WeakMap<MeshData, { key: string; out: MeshData }>();

export function evaluate(mesh: MeshData, modifiers: readonly Modifier[]): MeshData {
  const active = modifiers.filter((m) => m.enabled);
  if (!active.length) return mesh;
  const key = JSON.stringify(active);
  const hit = cache.get(mesh);
  if (hit && hit.key === key) return hit.out;
  let out = mesh;
  for (const mod of active) out = apply(out, mod);
  cache.set(mesh, { key, out });
  return out;
}

export function apply(m: MeshData, mod: Modifier): MeshData {
  switch (mod.kind) {
    case 'mirror':
      return mirror(m, mod.axes, mod.merge);
    case 'array':
      return array(m, mod.count, mod.relative, mod.constant);
    case 'solidify':
      return solidify(m, mod.thickness);
    case 'subdivision': {
      let levels = Math.max(0, Math.min(4, Math.round(mod.levels)));
      while (levels > 0 && m.f.length * 4 ** levels > MAX_FACES * 4) levels--;
      return catmullClark(m, levels);
    }
    case 'bevel':
      return bevelEdges(m, sharpEdges(m, mod.angle), mod.width).mesh;
    case 'decimate':
      return decimate(m, mod.ratio);
    case 'triangulate':
      return triangulateFaces(m);
    case 'weld':
      return mergeByDistance(m, mod.distance).mesh;
    case 'displace':
      return displace(m, mod.strength, mod.scale, mod.seed);
  }
}

/* ------------------------------------------------------------------- mirror */

function mirror(m: MeshData, axes: [boolean, boolean, boolean], merge: number): MeshData {
  let out = m;
  axes.forEach((on, axis) => {
    if (on) out = mirrorAxis(out, axis, merge);
  });
  return out;
}

function mirrorAxis(m: MeshData, axis: number, merge: number): MeshData {
  const w = toWork(m);
  const n = vertCount(m);
  const map = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = w.v[i * 3 + axis]!;
    if (Math.abs(c) <= merge) {
      // On the mirror plane: shared by both halves (snap exactly onto it).
      w.v[i * 3 + axis] = 0;
      map[i] = i;
    } else {
      map[i] = w.v.length / 3;
      w.v.push(w.v[i * 3]!, w.v[i * 3 + 1]!, w.v[i * 3 + 2]!);
      w.v[w.v.length - 3 + axis] = -c;
    }
  }
  const count = w.faces.length;
  for (let fi = 0; fi < count; fi++) {
    const f = w.faces[fi]!;
    // Mirroring flips orientation: reverse the corner order.
    w.faces.push(f.map((i) => map[i]!).reverse());
    const uv = w.uvs[fi];
    if (uv) {
      const r: number[] = [];
      for (let c = f.length - 1; c >= 0; c--) r.push(uv[c * 2]!, uv[c * 2 + 1]!);
      w.uvs.push(r);
    } else w.uvs.push(null);
    w.mats.push(w.mats[fi]!);
  }
  // Faces that lay exactly on the plane would now be doubled: drop the copies.
  return fromWork(dropDuplicateFaces(w));
}

function dropDuplicateFaces(w: Work): Work {
  const seen = new Set<string>();
  const out: Work = { v: w.v, faces: [], uvs: [], mats: [] };
  w.faces.forEach((f, i) => {
    const k = f.slice().sort((a, b) => a - b).join(',');
    if (seen.has(k)) return;
    seen.add(k);
    out.faces.push(f);
    out.uvs.push(w.uvs[i]!);
    out.mats.push(w.mats[i]!);
  });
  return out;
}

/* -------------------------------------------------------------------- array */

function array(m: MeshData, count: number, relative: [number, number, number], constant: [number, number, number]): MeshData {
  const n = Math.max(1, Math.min(200, Math.round(count)));
  if (n === 1) return m;
  const b = bounds(m);
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const step = [0, 1, 2].map((k) => relative[k]! * size[k]! + constant[k]!);
  const nv = vertCount(m);
  const v = new Float32Array(m.v.length * n);
  const f = new Uint32Array(m.f.length * n);
  const fs = new Uint32Array(m.fs.length * n);
  const uv = m.uv ? new Float32Array(m.uv.length * n) : undefined;
  const mm = m.m ? new Uint16Array(m.m.length * n) : undefined;
  for (let c = 0; c < n; c++) {
    for (let i = 0; i < m.v.length; i++) v[c * m.v.length + i] = m.v[i]! + step[i % 3]! * c;
    for (let i = 0; i < m.f.length; i++) f[c * m.f.length + i] = m.f[i]! + nv * c;
    fs.set(m.fs, c * m.fs.length);
    if (uv) uv.set(m.uv!, c * m.uv!.length);
    if (mm) mm.set(m.m!, c * m.m!.length);
  }
  const out: MeshData = { v, f, fs };
  if (uv) out.uv = uv;
  if (mm) out.m = mm;
  return out;
}

/* ----------------------------------------------------------------- solidify */

export function vertexNormals(m: MeshData): Float32Array {
  const n = new Float32Array(m.v.length);
  const o = faceOffsets(m);
  const fn = [0, 0, 0];
  for (let fi = 0; fi < m.fs.length; fi++) {
    faceNormalRaw(m, fi, fn);
    for (let c = o[fi]!; c < o[fi + 1]!; c++) {
      const i = m.f[c]! * 3;
      n[i]! += fn[0]!;
      n[i + 1]! += fn[1]!;
      n[i + 2]! += fn[2]!;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    n[i]! /= l;
    n[i + 1]! /= l;
    n[i + 2]! /= l;
  }
  return n;
}

function solidify(m: MeshData, thickness: number): MeshData {
  if (!thickness) return m;
  const w = toWork(m);
  const nv = vertCount(m);
  const vn = vertexNormals(m);
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) w.v.push(m.v[i * 3 + k]! - vn[i * 3 + k]! * thickness);
  const count = w.faces.length;
  const uses = new Map<string, number>();
  for (let fi = 0; fi < count; fi++) {
    const f = w.faces[fi]!;
    for (let c = 0; c < f.length; c++) {
      const a = f[c]!;
      const b = f[(c + 1) % f.length]!;
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  for (let fi = 0; fi < count; fi++) {
    const f = w.faces[fi]!;
    w.faces.push(f.map((i) => i + nv).reverse());
    const uv = w.uvs[fi];
    if (uv) {
      const r: number[] = [];
      for (let c = f.length - 1; c >= 0; c--) r.push(uv[c * 2]!, uv[c * 2 + 1]!);
      w.uvs.push(r);
    } else w.uvs.push(null);
    w.mats.push(w.mats[fi]!);
    // Rim along open borders.
    for (let c = 0; c < f.length; c++) {
      const a = f[c]!;
      const b = f[(c + 1) % f.length]!;
      if (uses.get(a < b ? `${a},${b}` : `${b},${a}`) !== 1) continue;
      w.faces.push([b, a, a + nv, b + nv]);
      w.uvs.push(null);
      w.mats.push(w.mats[fi]!);
    }
  }
  return fromWork(w, { dropLoose: false });
}

/* ----------------------------------------------------------------- decimate */

/**
 * Quadric-error edge collapse on the triangulated mesh. Keeps the silhouette and stays
 * fast enough to run interactively on game-sized meshes.
 */
export function decimate(m: MeshData, ratio: number): MeshData {
  const tri = triangulateFaces(m);
  const r = Math.max(0.01, Math.min(1, ratio));
  if (r >= 0.999) return tri;
  const nv = vertCount(tri);
  const pos = Float64Array.from(tri.v);
  const faces: number[][] = [];
  const fuv: (number[] | null)[] = [];
  const fm: number[] = [];
  const w = toWork(tri);
  w.faces.forEach((f, i) => {
    faces.push(f.slice());
    fuv.push(w.uvs[i] ? w.uvs[i]!.slice() : null);
    fm.push(w.mats[i]!);
  });
  // Quadrics per vertex.
  const Q = new Float64Array(nv * 10);
  const addPlane = (i: number, a: number, b: number, c: number, d: number, wgt: number) => {
    const q = i * 10;
    Q[q]! += a * a * wgt; Q[q + 1]! += a * b * wgt; Q[q + 2]! += a * c * wgt; Q[q + 3]! += a * d * wgt;
    Q[q + 4]! += b * b * wgt; Q[q + 5]! += b * c * wgt; Q[q + 6]! += b * d * wgt;
    Q[q + 7]! += c * c * wgt; Q[q + 8]! += c * d * wgt; Q[q + 9]! += d * d * wgt;
  };
  const triPlane = (f: number[]) => {
    const [i, j, k] = f as [number, number, number];
    const ax = pos[j * 3]! - pos[i * 3]!, ay = pos[j * 3 + 1]! - pos[i * 3 + 1]!, az = pos[j * 3 + 2]! - pos[i * 3 + 2]!;
    const bx = pos[k * 3]! - pos[i * 3]!, by = pos[k * 3 + 1]! - pos[i * 3 + 1]!, bz = pos[k * 3 + 2]! - pos[i * 3 + 2]!;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const area = Math.hypot(nx, ny, nz);
    if (area < 1e-20) return null;
    nx /= area; ny /= area; nz /= area;
    return [nx, ny, nz, -(nx * pos[i * 3]! + ny * pos[i * 3 + 1]! + nz * pos[i * 3 + 2]!), area / 2] as const;
  };
  for (const f of faces) {
    const p = triPlane(f);
    if (p) for (const i of f) addPlane(i, p[0], p[1], p[2], p[3], p[4]);
  }
  // Border edges get a strong perpendicular plane so open edges don't shrink.
  const edgeUse = new Map<string, number>();
  for (const f of faces) for (let c = 0; c < 3; c++) {
    const a = f[c]!, b = f[(c + 1) % 3]!;
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
  }
  for (const f of faces) {
    const p = triPlane(f);
    if (!p) continue;
    for (let c = 0; c < 3; c++) {
      const a = f[c]!, b = f[(c + 1) % 3]!;
      if (edgeUse.get(a < b ? `${a},${b}` : `${b},${a}`) !== 1) continue;
      const ex = pos[b * 3]! - pos[a * 3]!, ey = pos[b * 3 + 1]! - pos[a * 3 + 1]!, ez = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
      let nx = ey * p[2] - ez * p[1], ny = ez * p[0] - ex * p[2], nz = ex * p[1] - ey * p[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const d = -(nx * pos[a * 3]! + ny * pos[a * 3 + 1]! + nz * pos[a * 3 + 2]!);
      addPlane(a, nx, ny, nz, d, 1000);
      addPlane(b, nx, ny, nz, d, 1000);
    }
  }
  const err = (q: Float64Array, x: number, y: number, z: number) =>
    q[0]! * x * x + 2 * q[1]! * x * y + 2 * q[2]! * x * z + 2 * q[3]! * x + q[4]! * y * y + 2 * q[5]! * y * z + 2 * q[6]! * y + q[7]! * z * z + 2 * q[8]! * z + q[9]!;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const alive = new Uint8Array(faces.length).fill(1);
  let liveTris = faces.length;
  const target = Math.max(4, Math.floor(faces.length * r));
  const vfaces: number[][] = Array.from({ length: nv }, () => []);
  faces.forEach((f, fi) => f.forEach((i) => vfaces[i]!.push(fi)));
  // Repeated passes: collapse the cheapest edges first.
  for (let pass = 0; pass < 12 && liveTris > target; pass++) {
    const cands: { a: number; b: number; cost: number; x: number; y: number; z: number }[] = [];
    const q = new Float64Array(10);
    const seenE = new Set<string>();
    for (let fi = 0; fi < faces.length; fi++) {
      if (!alive[fi]) continue;
      const f = faces[fi]!;
      for (let c = 0; c < 3; c++) {
        const a = find(f[c]!), b = find(f[(c + 1) % 3]!);
        if (a === b) continue;
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        if (seenE.has(k)) continue;
        seenE.add(k);
        for (let t = 0; t < 10; t++) q[t] = Q[a * 10 + t]! + Q[b * 10 + t]!;
        const mx = (pos[a * 3]! + pos[b * 3]!) / 2, my = (pos[a * 3 + 1]! + pos[b * 3 + 1]!) / 2, mz = (pos[a * 3 + 2]! + pos[b * 3 + 2]!) / 2;
        const opts = [
          [pos[a * 3]!, pos[a * 3 + 1]!, pos[a * 3 + 2]!],
          [pos[b * 3]!, pos[b * 3 + 1]!, pos[b * 3 + 2]!],
          [mx, my, mz],
        ];
        let best = opts[2]!;
        let bc = Infinity;
        for (const o of opts) {
          const e = err(q, o[0]!, o[1]!, o[2]!);
          if (e < bc) {
            bc = e;
            best = o;
          }
        }
        cands.push({ a, b, cost: bc, x: best[0]!, y: best[1]!, z: best[2]! });
      }
    }
    if (!cands.length) break;
    cands.sort((p, q2) => p.cost - q2.cost);
    const touched = new Uint8Array(nv);
    const budget = Math.max(1, Math.floor((liveTris - target) / 2));
    let done = 0;
    for (const c of cands) {
      if (done >= budget) break;
      const a = find(c.a), b = find(c.b);
      if (a === b || touched[a] || touched[b]) continue;
      // Don't flip any surrounding triangle.
      let flips = false;
      for (const v of [a, b]) {
        for (const fi of vfaces[v]!) {
          if (!alive[fi]) continue;
          const f = faces[fi]!.map(find);
          if (f.includes(a) && f.includes(b)) continue;
          const before = triNormal(pos, f);
          const moved = f.map((i) => (i === a || i === b ? -1 : i));
          const pts = moved.map((i, k) => (i === -1 ? [c.x, c.y, c.z] : [pos[f[k]! * 3]!, pos[f[k]! * 3 + 1]!, pos[f[k]! * 3 + 2]!]));
          const after = triNormalPts(pts);
          if (before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0.2) flips = true;
        }
        if (flips) break;
      }
      if (flips) continue;
      parent[b] = a;
      pos[a * 3] = c.x;
      pos[a * 3 + 1] = c.y;
      pos[a * 3 + 2] = c.z;
      for (let t = 0; t < 10; t++) Q[a * 10 + t]! += Q[b * 10 + t]!;
      for (const fi of vfaces[b]!) vfaces[a]!.push(fi);
      touched[a] = touched[b] = 1;
      for (const fi of vfaces[a]!) {
        if (!alive[fi]) continue;
        const f = faces[fi]!.map(find);
        if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) {
          alive[fi] = 0;
          liveTris--;
        }
      }
      done++;
    }
    if (!done) break;
  }
  const out: Work = { v: Array.from(pos), faces: [], uvs: [], mats: [] };
  faces.forEach((f, fi) => {
    if (!alive[fi]) return;
    out.faces.push(f.map(find));
    out.uvs.push(fuv[fi]!);
    out.mats.push(fm[fi]!);
  });
  return fromWork(out);
}

function triNormal(pos: Float64Array, f: number[]): [number, number, number] {
  return triNormalPts(f.map((i) => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!]));
}

function triNormalPts(p: number[][]): [number, number, number] {
  const [a, b, c] = p as [number[], number[], number[]];
  const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/* ----------------------------------------------------------------- displace */

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Smooth 3D value noise in [-1, 1]. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  let r = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const h = hash3(xi + dx, yi + dy, zi + dz, seed);
        r += h * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
      }
  return r * 2 - 1;
}

function displace(m: MeshData, strength: number, scale: number, seed: number): MeshData {
  const vn = vertexNormals(m);
  const v = m.v.slice();
  const k = 1 / Math.max(0.01, scale);
  for (let i = 0; i < v.length; i += 3) {
    const x = m.v[i]! * k, y = m.v[i + 1]! * k, z = m.v[i + 2]! * k;
    // Two octaves for natural-looking bumps.
    const d = (noise3(x, y, z, seed) * 0.7 + noise3(x * 2.1, y * 2.1, z * 2.1, seed + 7) * 0.3) * strength;
    v[i] = m.v[i]! + vn[i]! * d;
    v[i + 1] = m.v[i + 1]! + vn[i + 1]! * d;
    v[i + 2] = m.v[i + 2]! + vn[i + 2]! * d;
  }
  return { ...m, v };
}

/** Faces whose vertices all have finite positions (sanity filter for imported data). */
export function isFinite3(m: MeshData): boolean {
  for (let i = 0; i < m.v.length; i++) if (!Number.isFinite(m.v[i]!)) return false;
  return true;
}

