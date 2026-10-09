/**
 * Catmull-Clark subdivision (the "Subdivision Surface" modifier): every level turns each
 * n-gon into n quads and smooths the shape. Open borders stay put (B-spline boundary
 * rules) and UVs are carried along per corner, so texture seams survive.
 */
import { edgeKey, edgeTable, faceOffsets, vertCount } from './mesh';
import type { MeshData } from './types';

export function catmullClark(m: MeshData, levels = 1): MeshData {
  let out = m;
  for (let l = 0; l < levels; l++) out = subdivideOnce(out);
  return out;
}

function subdivideOnce(m: MeshData): MeshData {
  const nv = vertCount(m);
  const nf = m.fs.length;
  const et = edgeTable(m);
  const ne = et.keys.length;
  const o = faceOffsets(m);
  const V = m.v;

  // Face points.
  const fp = new Float64Array(nf * 3);
  for (let fi = 0; fi < nf; fi++) {
    const n = m.fs[fi]!;
    for (let c = o[fi]!; c < o[fi + 1]!; c++) for (let k = 0; k < 3; k++) fp[fi * 3 + k]! += V[m.f[c]! * 3 + k]! / n;
  }
  // Edge points.
  const ep = new Float64Array(ne * 3);
  const boundary = new Uint8Array(ne);
  for (let ei = 0; ei < ne; ei++) {
    const k = et.keys[ei]!;
    const a = Math.floor(k / 2 ** 24);
    const b = k % 2 ** 24;
    const fs = et.faces[ei]!;
    if (fs.length === 2) {
      for (let c = 0; c < 3; c++) ep[ei * 3 + c] = (V[a * 3 + c]! + V[b * 3 + c]! + fp[fs[0]! * 3 + c]! + fp[fs[1]! * 3 + c]!) / 4;
    } else {
      boundary[ei] = 1;
      for (let c = 0; c < 3; c++) ep[ei * 3 + c] = (V[a * 3 + c]! + V[b * 3 + c]!) / 2;
    }
  }
  // Vertex points.
  const sumF = new Float64Array(nv * 3);
  const nFaces = new Uint32Array(nv);
  for (let fi = 0; fi < nf; fi++)
    for (let c = o[fi]!; c < o[fi + 1]!; c++) {
      const v = m.f[c]!;
      nFaces[v]!++;
      for (let k = 0; k < 3; k++) sumF[v * 3 + k]! += fp[fi * 3 + k]!;
    }
  const sumR = new Float64Array(nv * 3);
  const nEdges = new Uint32Array(nv);
  const bSum = new Float64Array(nv * 3);
  const nB = new Uint32Array(nv);
  for (let ei = 0; ei < ne; ei++) {
    const k = et.keys[ei]!;
    const a = Math.floor(k / 2 ** 24);
    const b = k % 2 ** 24;
    for (const [v, u] of [
      [a, b],
      [b, a],
    ] as const) {
      nEdges[v]!++;
      for (let c = 0; c < 3; c++) sumR[v * 3 + c]! += (V[v * 3 + c]! + V[u * 3 + c]!) / 2;
      if (boundary[ei]) {
        nB[v]!++;
        for (let c = 0; c < 3; c++) bSum[v * 3 + c]! += V[u * 3 + c]!;
      }
    }
  }
  const total = nv + ne + nf;
  const nvOut = new Float32Array(total * 3);
  for (let v = 0; v < nv; v++) {
    const n = nFaces[v]!;
    for (let c = 0; c < 3; c++) {
      const p = V[v * 3 + c]!;
      let r: number;
      if (nB[v] === 2) r = (6 * p + bSum[v * 3 + c]!) / 8;
      else if (nB[v]! > 0 || n === 0 || nEdges[v] !== n) r = p;
      else r = (sumF[v * 3 + c]! / n + (2 * sumR[v * 3 + c]!) / nEdges[v]! + (n - 3) * p) / n;
      nvOut[v * 3 + c] = r;
    }
  }
  nvOut.set(ep, nv * 3);
  nvOut.set(fp, (nv + ne) * 3);

  // New quads: [vertex, next edge point, face point, previous edge point].
  const corners = m.f.length;
  const f = new Uint32Array(corners * 4);
  const fs = new Uint32Array(corners).fill(4);
  const hasUv = !!m.uv;
  const uv = hasUv ? new Float32Array(corners * 8) : undefined;
  const mm = m.m ? new Uint16Array(corners) : undefined;
  let q = 0;
  for (let fi = 0; fi < nf; fi++) {
    const s = o[fi]!;
    const n = m.fs[fi]!;
    let cu = 0;
    let cv = 0;
    if (uv) for (let c = 0; c < n; c++) {
      cu += m.uv![(s + c) * 2]! / n;
      cv += m.uv![(s + c) * 2 + 1]! / n;
    }
    for (let c = 0; c < n; c++) {
      const cp = (c + n - 1) % n;
      const cn = (c + 1) % n;
      const v = m.f[s + c]!;
      const vPrev = m.f[s + cp]!;
      const vNext = m.f[s + cn]!;
      f[q * 4] = v;
      f[q * 4 + 1] = nv + et.index.get(edgeKey(v, vNext))!;
      f[q * 4 + 2] = nv + ne + fi;
      f[q * 4 + 3] = nv + et.index.get(edgeKey(vPrev, v))!;
      if (uv) {
        const U = m.uv!;
        const u0 = U[(s + c) * 2]!, v0 = U[(s + c) * 2 + 1]!;
        uv[q * 8] = u0;
        uv[q * 8 + 1] = v0;
        uv[q * 8 + 2] = (u0 + U[(s + cn) * 2]!) / 2;
        uv[q * 8 + 3] = (v0 + U[(s + cn) * 2 + 1]!) / 2;
        uv[q * 8 + 4] = cu;
        uv[q * 8 + 5] = cv;
        uv[q * 8 + 6] = (u0 + U[(s + cp) * 2]!) / 2;
        uv[q * 8 + 7] = (v0 + U[(s + cp) * 2 + 1]!) / 2;
      }
      if (mm) mm[q] = m.m![fi]!;
      q++;
    }
  }
  const res: MeshData = { v: nvOut, f, fs };
  if (uv) res.uv = uv;
  if (mm) res.m = mm;
  return res;
}
