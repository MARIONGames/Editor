/**
 * Loop cut (Ctrl+R) and bevel (Ctrl+B): the two tools hard-surface and game artists
 * reach for most. Both keep the mesh watertight and keep face winding consistent.
 */
import { edgeEnds, edgeKey, edgeTable, faceNormal, fromWork, toWork, type Work } from './mesh';
import { cross, dot, emptySelection, norm, selectionFromEdges, selectionFromFaces, sub, type OpResult } from './meshOps';
import type { MeshData } from './types';

interface Oriented {
  from: number;
  to: number;
}

export interface EdgeRing {
  /** Ring edges in order; face j lies between edges j and j+1. */
  edges: Oriented[];
  faces: number[];
  closed: boolean;
}

/** The ring of quads crossing `start` (what a loop cut slices through). */
export function edgeRing(m: MeshData, start: number): EdgeRing {
  const w = toWork(m);
  const et = edgeTable(m);
  const ei = et.index.get(start);
  const [a, b] = edgeEnds(start);
  const e0: Oriented = { from: a, to: b };
  if (ei === undefined) return { edges: [e0], faces: [], closed: false };
  const around = et.faces[ei]!;
  const walk = (first: number | undefined) => {
    const faces: number[] = [];
    const edges: Oriented[] = [];
    let face = first;
    let e = e0;
    const seen = new Set<number>();
    while (face !== undefined && w.faces[face]!.length === 4 && !seen.has(face)) {
      seen.add(face);
      const f = w.faces[face]!;
      let i = 0;
      while (i < 4 && !((f[i] === e.from && f[(i + 1) % 4] === e.to) || (f[i] === e.to && f[(i + 1) % 4] === e.from))) i++;
      if (i === 4) break;
      const A = f[i]!;
      const C = f[(i + 2) % 4]!;
      const D = f[(i + 3) % 4]!;
      const next: Oriented = A === e.from ? { from: D, to: C } : { from: C, to: D };
      faces.push(face);
      edges.push(next);
      const k = edgeKey(next.from, next.to);
      if (k === start) return { faces, edges, closed: true };
      const others = et.faces[et.index.get(k)!]!.filter((g) => g !== face);
      face = others.length === 1 ? others[0] : undefined;
      e = next;
    }
    return { faces, edges, closed: false };
  };
  const fwd = walk(around[0]);
  if (fwd.closed) return { edges: [e0, ...fwd.edges], faces: fwd.faces, closed: true };
  const back = around.length === 2 ? walk(around[1]) : { faces: [], edges: [], closed: false };
  return {
    edges: [...back.edges.slice().reverse(), e0, ...fwd.edges],
    faces: [...back.faces.slice().reverse(), ...fwd.faces],
    closed: false,
  };
}

/**
 * Slices the quad ring through `start` with `cuts` parallel edge loops. With one cut,
 * `slide` (−1…1) moves it towards either side.
 */
export function loopCut(m: MeshData, start: number, cuts = 1, slide = 0): OpResult {
  const ring = edgeRing(m, start);
  if (!ring.faces.length) return { mesh: m, sel: emptySelection() };
  const n = Math.max(1, Math.round(cuts));
  const params = n === 1 ? [Math.min(0.98, Math.max(0.02, 0.5 + slide * 0.5))] : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
  const w = toWork(m);
  // New vertices on every ring edge, ordered from its `from` end.
  const cut = new Map<number, { from: number; to: number; verts: number[] }>();
  for (const e of ring.edges) {
    const k = edgeKey(e.from, e.to);
    if (cut.has(k)) continue;
    const verts = params.map((t) => {
      const i = w.v.length / 3;
      for (let c = 0; c < 3; c++) w.v.push(w.v[e.from * 3 + c]! + (w.v[e.to * 3 + c]! - w.v[e.from * 3 + c]!) * t);
      return i;
    });
    cut.set(k, { from: e.from, to: e.to, verts });
  }
  const along = (x: number, y: number): { verts: number[]; ts: number[] } | null => {
    const c = cut.get(edgeKey(x, y));
    if (!c) return null;
    return c.from === x ? { verts: c.verts, ts: params } : { verts: c.verts.slice().reverse(), ts: params.map((t) => 1 - t).reverse() };
  };
  const lerpUv = (uv: number[], i: number, j: number, t: number) => [uv[i * 2]! + (uv[j * 2]! - uv[i * 2]!) * t, uv[i * 2 + 1]! + (uv[j * 2 + 1]! - uv[i * 2 + 1]!) * t];
  const ringSet = new Set(ring.faces);
  const out: Work = { v: w.v, faces: [], uvs: [], mats: [] };
  const newEdges: number[] = [];
  ring.faces.forEach((fi, j) => {
    const f = w.faces[fi]!;
    const e = ring.edges[j]!;
    let i = 0;
    while (!((f[i] === e.from && f[(i + 1) % 4] === e.to) || (f[i] === e.to && f[(i + 1) % 4] === e.from))) i++;
    const ia = i, ib = (i + 1) % 4, ic = (i + 2) % 4, id = (i + 3) % 4;
    const A = f[ia]!, B = f[ib]!, C = f[ic]!, D = f[id]!;
    const L = along(A, B)!;
    const M = along(D, C)!;
    const uv = w.uvs[fi];
    const lu = uv ? L.ts.map((t) => lerpUv(uv, ia, ib, t)) : [];
    const mu = uv ? M.ts.map((t) => lerpUv(uv, id, ic, t)) : [];
    const cornerUv = (k: number) => (uv ? [uv[k * 2]!, uv[k * 2 + 1]!] : [0, 0]);
    const strip = [A, ...L.verts, B];
    const stripD = [D, ...M.verts, C];
    const stripUv = [cornerUv(ia), ...lu, cornerUv(ib)];
    const stripDUv = [cornerUv(id), ...mu, cornerUv(ic)];
    for (let k = 0; k < strip.length - 1; k++) {
      out.faces.push([strip[k]!, strip[k + 1]!, stripD[k + 1]!, stripD[k]!]);
      out.uvs.push(uv ? [...stripUv[k]!, ...stripUv[k + 1]!, ...stripDUv[k + 1]!, ...stripDUv[k]!] : null);
      out.mats.push(w.mats[fi]!);
    }
    for (let k = 0; k < L.verts.length; k++) newEdges.push(edgeKey(L.verts[k]!, M.verts[k]!));
  });
  // Other faces touching a cut edge get the new vertices too (no cracks).
  w.faces.forEach((f, fi) => {
    if (ringSet.has(fi)) return;
    const uv = w.uvs[fi];
    const nf: number[] = [];
    const nuv: number[] = [];
    for (let c = 0; c < f.length; c++) {
      const c1 = (c + 1) % f.length;
      nf.push(f[c]!);
      if (uv) nuv.push(uv[c * 2]!, uv[c * 2 + 1]!);
      const s = along(f[c]!, f[c1]!);
      if (s) {
        nf.push(...s.verts);
        if (uv) for (const t of s.ts) nuv.push(...lerpUv(uv, c, c1, t));
      }
    }
    out.faces.push(nf);
    out.uvs.push(uv ? nuv : null);
    out.mats.push(w.mats[fi]!);
  });
  const mesh = fromWork(out, { dropLoose: false });
  return { mesh, sel: selectionFromEdges(mesh, new Set(newEdges)) };
}

/* -------------------------------------------------------------------- bevel */

/** Edges whose faces meet at more than `angleDeg` (used by the Bevel modifier). */
export function sharpEdges(m: MeshData, angleDeg: number): Set<number> {
  const et = edgeTable(m);
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  const out = new Set<number>();
  const n1 = [0, 0, 0];
  const n2 = [0, 0, 0];
  et.keys.forEach((k, ei) => {
    const fs = et.faces[ei]!;
    if (fs.length !== 2) return;
    faceNormal(m, fs[0]!, n1);
    faceNormal(m, fs[1]!, n2);
    if (dot(n1, n2) < cos) out.add(k);
  });
  return out;
}

/**
 * Chamfers the given edges by `width` (one segment). Corners where several beveled
 * edges meet are closed with a patch face.
 */
export function bevelEdges(m: MeshData, edgeKeys: Set<number>, width: number): OpResult {
  const et = edgeTable(m);
  const bev = new Set<number>();
  for (const k of edgeKeys) {
    const ei = et.index.get(k);
    if (ei !== undefined && et.faces[ei]!.length === 2) bev.add(k);
  }
  if (!bev.size || width <= 0) return { mesh: m, sel: emptySelection() };
  const w = toWork(m);
  const P = (i: number) => [w.v[i * 3]!, w.v[i * 3 + 1]!, w.v[i * 3 + 2]!];
  const addV = (p: number[]) => {
    const i = w.v.length / 3;
    w.v.push(p[0]!, p[1]!, p[2]!);
    return i;
  };
  const touched = new Set<number>();
  const inset = new Map<string, number>(); // `${face}:${corner}` → vertex
  const slides = new Map<string, number>(); // `${edgeKey}@${vertex}` → vertex
  const nrm = [0, 0, 0];
  // Pass 1: create the moved corner points.
  w.faces.forEach((f, fi) => {
    faceNormal(m, fi, nrm);
    const n = f.length;
    for (let c = 0; c < n; c++) {
      const v = f[c]!;
      const p = f[(c + n - 1) % n]!;
      const nx = f[(c + 1) % n]!;
      const b1 = bev.has(edgeKey(p, v));
      const b2 = bev.has(edgeKey(v, nx));
      if (!b1 && !b2) continue;
      touched.add(v);
      const pv = P(v);
      const e1 = norm(sub(pv, P(p)));
      const e2 = norm(sub(P(nx), pv));
      const in1 = norm(cross(nrm, e1));
      const in2 = norm(cross(nrm, e2));
      if (b1 && b2) {
        let bis = norm([in1[0]! + in2[0]!, in1[1]! + in2[1]!, in1[2]! + in2[2]!]);
        if (!Number.isFinite(bis[0]!)) bis = in1;
        const d = width / Math.max(0.2, dot(bis, in1));
        inset.set(`${fi}:${c}`, addV([pv[0]! + bis[0]! * d, pv[1]! + bis[1]! * d, pv[2]! + bis[2]! * d]));
      } else {
        // Slide along the non-beveled edge until it meets the offset beveled edge.
        const target = b1 ? nx : p;
        const key = `${edgeKey(v, target)}@${v}`;
        if (slides.has(key)) continue;
        const dirv = norm(sub(P(target), pv));
        const len = Math.hypot(...sub(P(target), pv));
        const t = Math.min(len * 0.95, width / Math.max(0.2, Math.abs(dot(dirv, b1 ? in1 : in2))));
        slides.set(key, addV([pv[0]! + dirv[0]! * t, pv[1]! + dirv[1]! * t, pv[2]! + dirv[2]! * t]));
      }
    }
  });
  const slide = (v: number, other: number) => slides.get(`${edgeKey(v, other)}@${v}`);
  const replacement = (fi: number, c: number): number[] => {
    const f = w.faces[fi]!;
    const n = f.length;
    const v = f[c]!;
    const p = f[(c + n - 1) % n]!;
    const nx = f[(c + 1) % n]!;
    const b1 = bev.has(edgeKey(p, v));
    const b2 = bev.has(edgeKey(v, nx));
    if (b1 && b2) return [inset.get(`${fi}:${c}`)!];
    if (b1) return [slide(v, nx)!];
    if (b2) return [slide(v, p)!];
    const sp = slide(v, p);
    const sn = slide(v, nx);
    if (sp !== undefined && sn !== undefined) return [sp, sn];
    if (sp !== undefined) return [sp, v];
    if (sn !== undefined) return [v, sn];
    return [v];
  };
  const out: Work = { v: w.v, faces: [], uvs: [], mats: [] };
  const cornerAt = new Map<string, number>(); // `${face}:${vertex}` → replacement (single point)
  w.faces.forEach((f, fi) => {
    const nf: number[] = [];
    const uv = w.uvs[fi];
    const nuv: number[] = [];
    f.forEach((v, c) => {
      const r = replacement(fi, c);
      if (r.length === 1) cornerAt.set(`${fi}:${v}`, r[0]!);
      for (const x of r) {
        nf.push(x);
        if (uv) nuv.push(uv[c * 2]!, uv[c * 2 + 1]!);
      }
    });
    out.faces.push(nf);
    out.uvs.push(uv ? nuv : null);
    out.mats.push(w.mats[fi]!);
  });
  const chamfers: number[] = [];
  for (const k of bev) {
    const [a, b] = edgeEnds(k);
    const [f1, f2] = et.faces[et.index.get(k)!]! as [number, number];
    // F1 must be the face that walks a→b.
    const walks = (fi: number) => {
      const f = w.faces[fi]!;
      return f.some((x, c) => x === a && f[(c + 1) % f.length] === b);
    };
    const [F1, F2] = walks(f1) ? [f1, f2] : [f2, f1];
    const a1 = cornerAt.get(`${F1}:${a}`);
    const b1 = cornerAt.get(`${F1}:${b}`);
    const a2 = cornerAt.get(`${F2}:${a}`);
    const b2 = cornerAt.get(`${F2}:${b}`);
    if (a1 === undefined || b1 === undefined || a2 === undefined || b2 === undefined) continue;
    chamfers.push(out.faces.length);
    out.faces.push([b1, a1, a2, b2]);
    out.uvs.push(null);
    out.mats.push(w.mats[F1]!);
  }
  // Close the holes left around beveled corners.
  const newVerts = new Set<number>([...inset.values(), ...slides.values(), ...touched]);
  const directed = new Set<string>();
  for (const f of out.faces) for (let c = 0; c < f.length; c++) directed.add(`${f[c]},${f[(c + 1) % f.length]}`);
  const next = new Map<number, number>();
  for (const f of out.faces)
    for (let c = 0; c < f.length; c++) {
      const a = f[c]!;
      const b = f[(c + 1) % f.length]!;
      if (!directed.has(`${b},${a}`) && newVerts.has(a) && newVerts.has(b)) next.set(b, a);
    }
  const visited = new Set<number>();
  for (const s of next.keys()) {
    if (visited.has(s)) continue;
    const loop: number[] = [];
    let v: number | undefined = s;
    while (v !== undefined && !visited.has(v)) {
      visited.add(v);
      loop.push(v);
      v = next.get(v);
    }
    if (v === s && loop.length >= 3) {
      chamfers.push(out.faces.length);
      out.faces.push(loop);
      out.uvs.push(null);
      out.mats.push(0);
    }
  }
  const mesh = fromWork(out);
  // Indices of new faces are stable (loose vertices don't renumber faces).
  return { mesh, sel: selectionFromFaces(mesh, new Set(chamfers)) };
}
