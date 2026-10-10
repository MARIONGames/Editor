/**
 * One-tap helpers for beginners (and busy pros): studio lighting, turntables and a
 * game-ready report.
 */
import { toast } from '../state/store';
import { addObjects, emptyObject, lightObject, lookAtTransform, sceneBounds } from './model/scene';
import { faceOffsets, edgeTable, isClosedManifold } from './model/mesh';
import { evaluate } from './model/modifiers';
import { meshStats } from './model/display';
import type { MeshObj, Scene3D } from './model/types';
import { applyMotion, commit3d } from './state/actions3d';
import { scene3d, selection3d, time3d } from './state/store3d';
import { emit } from '../state/events';

/** Key, fill and rim area lights sized to the selection (or the whole scene). */
export function autoLight(): void {
  const s = scene3d.peek();
  if (!s) return;
  const ids = selection3d.peek().ids;
  const b = sceneBounds(s, ids.length ? ids : undefined, time3d.peek());
  const cx = b ? (b.min.x + b.max.x) / 2 : 0;
  const cy = b ? (b.min.y + b.max.y) / 2 : 1;
  const cz = b ? (b.min.z + b.max.z) / 2 : 0;
  const r = b ? Math.max(1, b.min.distanceTo(b.max) / 2) : 1.5;
  const c: [number, number, number] = [cx, cy, cz];
  const d = r * 2.6;
  const group = emptyObject('Studio lights', { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });
  const key = lightObject('area', lookAtTransform([cx + d * 0.8, cy + d * 0.7, cz + d * 0.7], c));
  const fill = lightObject('area', lookAtTransform([cx - d, cy + d * 0.3, cz + d * 0.5], c));
  const rim = lightObject('area', lookAtTransform([cx - d * 0.3, cy + d * 0.8, cz - d], c));
  const size = Math.max(1, r * 1.2);
  const power = (x: number) => x * Math.max(1, r * r * 0.6);
  commit3d('Studio lights', (sc) =>
    addObjects(sc, [
      group,
      {
        ...key,
        name: 'Key light',
        parent: group.id,
        light: { ...key.light, intensity: power(16), size: [size, size] },
      },
      {
        ...fill,
        name: 'Fill light',
        parent: group.id,
        light: {
          ...fill.light,
          intensity: power(5),
          size: [size * 1.4, size * 1.4],
          color: '#dfe8ff',
        },
      },
      {
        ...rim,
        name: 'Rim light',
        parent: group.id,
        light: {
          ...rim.light,
          intensity: power(14),
          size: [size * 0.8, size * 0.8],
          color: '#fff1dc',
        },
      },
    ]),
  );
  toast('Added a soft studio light setup. Switch the view to “Final” to see it.', 'success');
  emit('3d:added', { kind: 'studio-lights' });
}

export function turntable(): void {
  const s = scene3d.peek();
  if (!s) return;
  if (!selection3d.peek().ids.length) {
    toast('Select what should turn, then tap Turntable.', 'info');
    return;
  }
  applyMotion('turntable', Math.max(4, s.anim.end - time3d.peek()));
  toast('Press play (Space) to watch it turn.', 'success');
}

export interface GameCheckRow {
  name: string;
  tris: number;
  verts: number;
  ngons: number;
  issues: string[];
}

/** What a game engine would complain about, object by object. */
export function gameReadyReport(s: Scene3D): {
  rows: GameCheckRow[];
  totalTris: number;
  materials: number;
  textures: number;
} {
  const rows: GameCheckRow[] = [];
  let totalTris = 0;
  const usedMats = new Set<string>();
  for (const id of s.order) {
    const o = s.objects[id];
    if (!o || o.kind !== 'mesh') continue;
    const m = evaluate(o.mesh, o.modifiers);
    const st = meshStats(m);
    totalTris += st.tris;
    for (const mat of o.materials) if (mat) usedMats.add(mat);
    let ngons = 0;
    for (let f = 0; f < m.fs.length; f++) if (m.fs[f]! > 4) ngons++;
    const issues: string[] = [];
    if (ngons)
      issues.push(
        `${ngons} face${ngons === 1 ? ' has' : 's have'} more than 4 corners (n-gons) — engines triangulate them, sometimes badly`,
      );
    if (!hasUVs(o))
      issues.push('No UV map — textures will not line up (Edit shape → UV: box project)');
    const sc = o.t.s;
    if (Math.abs(sc[0] - 1) > 1e-4 || Math.abs(sc[1] - 1) > 1e-4 || Math.abs(sc[2] - 1) > 1e-4)
      issues.push(
        'Scale is not applied (Object → Apply size & rotation) — physics and lighting may look off',
      );
    if (sc[0] * sc[1] * sc[2] < 0)
      issues.push('Mirrored by negative scale — normals may face inward');
    if (!isClosedManifold(m) && o.modifiers.every((x) => x.kind !== 'solidify')) {
      const open = openEdges(m);
      if (open > 0)
        issues.push(
          `${open} open edge${open === 1 ? '' : 's'} (holes) — fine for planes, a problem for solid props`,
        );
    }
    if (o.materials.filter(Boolean).length > 3)
      issues.push(
        `${o.materials.length} materials = ${o.materials.length} draw calls; merge into one texture atlas if you can`,
      );
    if (o.modifiers.length)
      issues.push(
        'Effects are exported baked in (that is fine) — apply them if you want to keep editing the result',
      );
    rows.push({ name: o.name, tris: st.tris, verts: st.verts, ngons, issues });
  }
  return { rows, totalTris, materials: usedMats.size, textures: Object.keys(s.textures).length };
}

function hasUVs(o: MeshObj): boolean {
  const uv = o.mesh.uv;
  if (!uv) return false;
  const off = faceOffsets(o.mesh);
  for (let f = 0; f < o.mesh.fs.length; f++) if (Number.isNaN(uv[off[f]! * 2]!)) return false;
  return true;
}

function openEdges(m: ReturnType<typeof evaluate>): number {
  const t = edgeTable(m);
  let n = 0;
  for (const f of t.faces) if (f.length === 1) n++;
  return n;
}
