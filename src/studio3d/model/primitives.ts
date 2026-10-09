/**
 * Built-in shapes. Quads wherever possible (they subdivide and edit nicely), faces wound
 * counter-clockwise from outside, UVs on every face. Sizes match Blender's defaults
 * (a 2 m cube) so muscle memory and tutorials carry over.
 */
import { makeMesh } from './mesh';
import type { MeshData } from './types';

export type PrimitiveKind = 'cube' | 'sphere' | 'icosphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'grid' | 'capsule' | 'pyramid';

export function cube(size = 2): MeshData {
  const h = size / 2;
  const v = [-h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h, -h, -h, h, h, -h, h, h, h, h, -h, h, h];
  const faces = [
    [4, 5, 6, 7], // +Z
    [1, 0, 3, 2], // -Z
    [5, 1, 2, 6], // +X
    [0, 4, 7, 3], // -X
    [7, 6, 2, 3], // +Y
    [0, 1, 5, 4], // -Y
  ];
  const quadUv = [0, 0, 1, 0, 1, 1, 0, 1];
  return makeMesh(v, faces, faces.map(() => quadUv.slice()));
}

export function grid(size = 2, cuts = 1): MeshData {
  const n = Math.max(1, Math.round(cuts));
  const v: number[] = [];
  const faces: number[][] = [];
  const uvs: number[][] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) v.push(-size / 2 + (size * i) / n, 0, size / 2 - (size * j) / n);
  }
  const id = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
      uvs.push([i / n, j / n, (i + 1) / n, j / n, (i + 1) / n, (j + 1) / n, i / n, (j + 1) / n]);
    }
  }
  return makeMesh(v, faces, uvs);
}

export const plane = (size = 2): MeshData => grid(size, 1);

/**
 * Spins a profile (radius, height) pairs — listed top to bottom — around the Y axis.
 * Points with radius 0 become poles; open ends can be closed with n-gon caps.
 */
export function lathe(profile: [number, number][], segments: number, capTop = false, capBottom = false): MeshData {
  const S = Math.max(3, Math.round(segments));
  const v: number[] = [];
  const faces: number[][] = [];
  const uvs: number[][] = [];
  const rows: number[][] = [];
  const K = profile.length;
  for (const [r, y] of profile) {
    if (r <= 1e-9) {
      rows.push([v.length / 3]);
      v.push(0, y, 0);
    } else {
      const row: number[] = [];
      for (let j = 0; j < S; j++) {
        const a = (2 * Math.PI * j) / S;
        row.push(v.length / 3);
        v.push(r * Math.cos(a), y, -r * Math.sin(a));
      }
      rows.push(row);
    }
  }
  const vv = (k: number) => 1 - k / (K - 1);
  for (let k = 0; k < K - 1; k++) {
    const top = rows[k]!;
    const bot = rows[k + 1]!;
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S;
      const u0 = j / S;
      const u1 = (j + 1) / S;
      const um = (j + 0.5) / S;
      if (top.length === 1 && bot.length === 1) continue;
      if (top.length === 1) {
        faces.push([top[0]!, bot[j]!, bot[j1]!]);
        uvs.push([um, vv(k), u0, vv(k + 1), u1, vv(k + 1)]);
      } else if (bot.length === 1) {
        faces.push([top[j]!, bot[0]!, top[j1]!]);
        uvs.push([u0, vv(k), um, vv(k + 1), u1, vv(k)]);
      } else {
        faces.push([top[j]!, bot[j]!, bot[j1]!, top[j1]!]);
        uvs.push([u0, vv(k), u0, vv(k + 1), u1, vv(k + 1), u1, vv(k)]);
      }
    }
  }
  const capUv = (row: number[], r: number, reverse: boolean) => {
    const order = reverse ? row.slice().reverse() : row;
    const uv: number[] = [];
    for (const i of order) uv.push(0.5 + v[i * 3]! / (2 * r), 0.5 - v[i * 3 + 2]! / (2 * r) * (reverse ? -1 : 1));
    return { order, uv };
  };
  if (capTop && rows[0]!.length > 1) {
    const { order, uv } = capUv(rows[0]!, profile[0]![0], false);
    faces.push(order);
    uvs.push(uv);
  }
  if (capBottom && rows[K - 1]!.length > 1) {
    const { order, uv } = capUv(rows[K - 1]!, profile[K - 1]![0], true);
    faces.push(order);
    uvs.push(uv);
  }
  return makeMesh(v, faces, uvs);
}

export function uvSphere(radius = 1, segments = 32, rings = 16): MeshData {
  const R = Math.max(3, Math.round(rings));
  const profile: [number, number][] = [];
  for (let i = 0; i <= R; i++) {
    const t = (Math.PI * i) / R;
    profile.push([i === 0 || i === R ? 0 : radius * Math.sin(t), radius * Math.cos(t)]);
  }
  return lathe(profile, segments);
}

export function cylinder(radius = 1, depth = 2, segments = 32): MeshData {
  return lathe(
    [
      [radius, depth / 2],
      [radius, -depth / 2],
    ],
    segments,
    true,
    true,
  );
}

export function cone(radius = 1, depth = 2, segments = 32, topRadius = 0): MeshData {
  return lathe(
    [
      [topRadius, depth / 2],
      [radius, -depth / 2],
    ],
    segments,
    topRadius > 0,
    true,
  );
}

export const pyramid = (size = 2): MeshData => cone(size / Math.SQRT2, size, 4);

export function capsule(radius = 0.5, length = 2, segments = 32, ringsPerCap = 8): MeshData {
  const half = Math.max(0, length / 2 - radius);
  const profile: [number, number][] = [];
  for (let i = 0; i <= ringsPerCap; i++) {
    const t = ((Math.PI / 2) * i) / ringsPerCap;
    profile.push([i === 0 ? 0 : radius * Math.sin(t), half + radius * Math.cos(t)]);
  }
  for (let i = 0; i <= ringsPerCap; i++) {
    const t = Math.PI / 2 + ((Math.PI / 2) * i) / ringsPerCap;
    profile.push([i === ringsPerCap ? 0 : radius * Math.sin(t), -half + radius * Math.cos(t)]);
  }
  return lathe(profile, segments);
}

export function torus(major = 1, minor = 0.25, majorSegments = 48, minorSegments = 12): MeshData {
  const M = Math.max(3, Math.round(majorSegments));
  const N = Math.max(3, Math.round(minorSegments));
  const v: number[] = [];
  for (let i = 0; i < M; i++) {
    const p = (2 * Math.PI * i) / M;
    const rx = Math.cos(p);
    const rz = -Math.sin(p);
    for (let j = 0; j < N; j++) {
      const t = (2 * Math.PI * j) / N;
      const r = major + minor * Math.cos(t);
      v.push(r * rx, minor * Math.sin(t), r * rz);
    }
  }
  const id = (i: number, j: number) => (i % M) * N + (j % N);
  const faces: number[][] = [];
  const uvs: number[][] = [];
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < N; j++) {
      faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
      uvs.push([i / M, j / N, (i + 1) / M, j / N, (i + 1) / M, (j + 1) / N, i / M, (j + 1) / N]);
    }
  }
  return makeMesh(v, faces, uvs);
}

export function icoSphere(radius = 1, detail = 2): MeshData {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: number[] = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let d = 0; d < Math.min(5, Math.max(0, Math.round(detail))); d++) {
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number) => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      let m = mid.get(k);
      if (m === undefined) {
        m = v.length / 3;
        v.push((v[a * 3]! + v[b * 3]!) / 2, (v[a * 3 + 1]! + v[b * 3 + 1]!) / 2, (v[a * 3 + 2]! + v[b * 3 + 2]!) / 2);
        mid.set(k, m);
      }
      return m;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces as [number, number, number][]) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const out: number[] = [];
  for (let i = 0; i < v.length; i += 3) {
    const l = Math.hypot(v[i]!, v[i + 1]!, v[i + 2]!);
    out.push((v[i]! / l) * radius, (v[i + 1]! / l) * radius, (v[i + 2]! / l) * radius);
  }
  v = out;
  // Spherical UVs per corner (wrapped faces get u shifted so they don't smear across the seam).
  const uvs = faces.map((f) => {
    const us = f.map((i) => 0.5 + Math.atan2(-v[i * 3 + 2]!, v[i * 3]!) / (2 * Math.PI));
    const max = Math.max(...us);
    const uv: number[] = [];
    f.forEach((i, k) => {
      let u = us[k]!;
      if (max - u > 0.5) u += 1;
      uv.push(u, 0.5 + Math.asin(Math.max(-1, Math.min(1, v[i * 3 + 1]! / radius))) / Math.PI);
    });
    return uv;
  });
  return makeMesh(v, faces, uvs);
}

/** Creates a primitive with its default settings. */
export function primitive(kind: PrimitiveKind): MeshData {
  switch (kind) {
    case 'cube':
      return cube();
    case 'sphere':
      return uvSphere();
    case 'icosphere':
      return icoSphere();
    case 'cylinder':
      return cylinder();
    case 'cone':
      return cone();
    case 'torus':
      return torus();
    case 'plane':
      return plane();
    case 'grid':
      return grid(2, 10);
    case 'capsule':
      return capsule();
    case 'pyramid':
      return pyramid();
  }
}
