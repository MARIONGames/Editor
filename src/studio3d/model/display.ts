/**
 * Turns a polygon mesh into GPU-ready triangle buffers: one vertex per face corner, so
 * flat, smooth and auto-smooth (by angle) shading and UV seams all work.
 */
import { faceNormal, faceOffsets, triangulate, vertexFaces } from './mesh';
import type { MeshData, ShadeMode } from './types';

export interface DisplayData {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  /** Index ranges per material slot (for multi-material meshes). */
  groups: { start: number; count: number; slot: number }[];
  /** Source face of each triangle (for picking). */
  triFace: Uint32Array;
}

export function buildDisplay(m: MeshData, shade: ShadeMode = 'smooth', angleDeg = 30): DisplayData {
  const corners = m.f.length;
  const nf = m.fs.length;
  const o = faceOffsets(m);
  const position = new Float32Array(corners * 3);
  const normal = new Float32Array(corners * 3);
  const uv = new Float32Array(corners * 2);
  const fn = new Float32Array(nf * 3);
  const t = [0, 0, 0];
  for (let fi = 0; fi < nf; fi++) {
    faceNormal(m, fi, t);
    fn[fi * 3] = t[0]!;
    fn[fi * 3 + 1] = t[1]!;
    fn[fi * 3 + 2] = t[2]!;
  }
  // Area-weighted vertex normals for smooth shading.
  let vn: Float32Array | null = null;
  if (shade !== 'flat') {
    vn = new Float32Array(m.v.length);
    for (let fi = 0; fi < nf; fi++) {
      const area = faceArea(m, fi);
      for (let c = o[fi]!; c < o[fi + 1]!; c++) {
        const v = m.f[c]! * 3;
        vn[v]! += fn[fi * 3]! * area;
        vn[v + 1]! += fn[fi * 3 + 1]! * area;
        vn[v + 2]! += fn[fi * 3 + 2]! * area;
      }
    }
  }
  const vf = shade === 'auto' ? vertexFaces(m) : null;
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
  for (let fi = 0; fi < nf; fi++) {
    const hasUv = !!m.uv && !Number.isNaN(m.uv[o[fi]! * 2]!);
    const nx = fn[fi * 3]!,
      ny = fn[fi * 3 + 1]!,
      nz = fn[fi * 3 + 2]!;
    for (let c = o[fi]!; c < o[fi + 1]!; c++) {
      const v = m.f[c]!;
      position[c * 3] = m.v[v * 3]!;
      position[c * 3 + 1] = m.v[v * 3 + 1]!;
      position[c * 3 + 2] = m.v[v * 3 + 2]!;
      let x = nx,
        y = ny,
        z = nz;
      if (shade === 'smooth' && vn) {
        x = vn[v * 3]!;
        y = vn[v * 3 + 1]!;
        z = vn[v * 3 + 2]!;
      } else if (shade === 'auto' && vf) {
        // Average only the neighbouring faces that are within the smoothing angle.
        x = y = z = 0;
        for (let k = vf.start[v]!; k < vf.start[v + 1]!; k++) {
          const g = vf.faces[k]!;
          const gx = fn[g * 3]!,
            gy = fn[g * 3 + 1]!,
            gz = fn[g * 3 + 2]!;
          if (gx * nx + gy * ny + gz * nz >= cosLimit - 1e-6) {
            const a = faceArea(m, g);
            x += gx * a;
            y += gy * a;
            z += gz * a;
          }
        }
      }
      const l = Math.hypot(x, y, z) || 1;
      normal[c * 3] = x / l;
      normal[c * 3 + 1] = y / l;
      normal[c * 3 + 2] = z / l;
      if (hasUv) {
        uv[c * 2] = m.uv![c * 2]!;
        uv[c * 2 + 1] = m.uv![c * 2 + 1]!;
      } else {
        // Faces without UVs get a box projection so textures still show.
        const ax = Math.abs(nx),
          ay = Math.abs(ny),
          az = Math.abs(nz);
        const px = position[c * 3]!,
          py = position[c * 3 + 1]!,
          pz = position[c * 3 + 2]!;
        if (ax >= ay && ax >= az) {
          uv[c * 2] = nx > 0 ? -pz : pz;
          uv[c * 2 + 1] = py;
        } else if (ay >= az) {
          uv[c * 2] = px;
          uv[c * 2 + 1] = ny > 0 ? -pz : pz;
        } else {
          uv[c * 2] = nz > 0 ? px : -px;
          uv[c * 2 + 1] = py;
        }
      }
    }
  }
  // Triangles sorted by material slot.
  const tri = triangulate(m);
  const nt = tri.face.length;
  const slotOf = (fi: number) => (m.m ? m.m[fi]! : 0);
  const order = Array.from({ length: nt }, (_, i) => i);
  if (m.m) order.sort((a, b) => slotOf(tri.face[a]!) - slotOf(tri.face[b]!));
  const index = new Uint32Array(nt * 3);
  const triFace = new Uint32Array(nt);
  const groups: DisplayData['groups'] = [];
  order.forEach((ti, i) => {
    index[i * 3] = tri.corners[ti * 3]!;
    index[i * 3 + 1] = tri.corners[ti * 3 + 1]!;
    index[i * 3 + 2] = tri.corners[ti * 3 + 2]!;
    triFace[i] = tri.face[ti]!;
    const slot = slotOf(tri.face[ti]!);
    const g = groups[groups.length - 1];
    if (g && g.slot === slot) g.count += 3;
    else groups.push({ start: i * 3, count: 3, slot });
  });
  return { position, normal, uv, index, groups, triFace };
}

function faceArea(m: MeshData, fi: number): number {
  // Newell normal length is twice the area; only relative weights matter.
  const o = faceOffsets(m);
  const n = m.fs[fi]!;
  let x = 0,
    y = 0,
    z = 0;
  for (let c = 0; c < n; c++) {
    const a = m.f[o[fi]! + c]! * 3;
    const b = m.f[o[fi]! + ((c + 1) % n)]! * 3;
    x += (m.v[a + 1]! - m.v[b + 1]!) * (m.v[a + 2]! + m.v[b + 2]!);
    y += (m.v[a + 2]! - m.v[b + 2]!) * (m.v[a]! + m.v[b]!);
    z += (m.v[a]! - m.v[b]!) * (m.v[a + 1]! + m.v[b + 1]!);
  }
  return Math.hypot(x, y, z) / 2 || 1e-12;
}

/** Polygon / triangle / vertex counts (what game artists budget against). */
export function meshStats(m: MeshData): { verts: number; faces: number; tris: number } {
  let tris = 0;
  for (let i = 0; i < m.fs.length; i++) tris += Math.max(0, m.fs[i]! - 2);
  return { verts: m.v.length / 3, faces: m.fs.length, tris };
}
