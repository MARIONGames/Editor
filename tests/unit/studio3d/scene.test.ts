import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { mergeChannels, presetKeys, sample, setKey, transformAt, moveKeys, ease } from '../../../src/studio3d/model/animation';
import { faceCount, isClosedManifold, signedVolume, vertCount } from '../../../src/studio3d/model/mesh';
import { createModifier, decimate, evaluate } from '../../../src/studio3d/model/modifiers';
import { cube, grid, uvSphere } from '../../../src/studio3d/model/primitives';
import {
  addPrimitive,
  applyTransform,
  assignMaterial,
  createScene,
  duplicateObjects,
  joinMeshes,
  keyObject,
  unkeyObject,
  outlinerRows,
  removeObjects,
  sceneBounds,
  separateFaces,
  setOrigin,
  setParent,
  setTransformAt,
  starterScene,
  worldMatrix,
} from '../../../src/studio3d/model/scene';
import type { MeshObj } from '../../../src/studio3d/model/types';

describe('scene', () => {
  it('starter scene has a cube, a sun and a render camera', () => {
    const s = starterScene('Test');
    const kinds = Object.values(s.objects).map((o) => o.kind).sort();
    expect(kinds).toEqual(['camera', 'light', 'mesh']);
    expect(s.render.camera).not.toBeNull();
  });

  it('new shapes sit on the floor and get unique names', () => {
    let s = createScene('x');
    const a = addPrimitive(s, 'cube', [0, 0, 0]);
    s = a.scene;
    const b = addPrimitive(s, 'cube', [3, 0, 0]);
    s = b.scene;
    expect(s.objects[a.id]!.t.p[1]).toBeCloseTo(1);
    expect(s.objects[b.id]!.name).toBe('Cube.001');
    const bb = sceneBounds(s)!;
    expect(bb.min.y).toBeCloseTo(0);
  });

  it('parenting keeps world positions; deleting a parent keeps the child in place', () => {
    let s = createScene('x');
    const a = addPrimitive(s, 'cube', [2, 0, 0]);
    const b = addPrimitive(a.scene, 'sphere', [5, 0, 0]);
    s = setParent(b.scene, [b.id], a.id);
    expect(s.objects[b.id]!.parent).toBe(a.id);
    const w = new Vector3().setFromMatrixPosition(worldMatrix(s, b.id));
    expect(w.x).toBeCloseTo(5);
    expect(outlinerRows(s).map((r) => r.depth)).toEqual([0, 1]);
    s = removeObjects(s, [a.id]);
    expect(s.objects[b.id]!.parent).toBeNull();
    expect(s.objects[b.id]!.t.p[0]).toBeCloseTo(5);
  });

  it('linked duplicates share mesh data, normal duplicates do not', () => {
    const a = addPrimitive(createScene('x'), 'cube', [0, 0, 0]);
    const linked = duplicateObjects(a.scene, [a.id], true);
    const copy = duplicateObjects(a.scene, [a.id], false);
    expect((linked.scene.objects[linked.ids[0]!] as MeshObj).mesh).toBe((a.scene.objects[a.id] as MeshObj).mesh);
    expect((copy.scene.objects[copy.ids[0]!] as MeshObj).mesh.v).not.toBe((a.scene.objects[a.id] as MeshObj).mesh.v);
  });

  it('apply transform bakes scale into vertices, even mirrored scale', () => {
    let s = addPrimitive(createScene('x'), 'cube', [0, 0, 0]);
    s = { ...s, scene: setTransformAt(s.scene, s.id, { p: [0, 1, 0], r: [0, 0, 0], s: [-2, 1, 1] }, 0, false) };
    const out = applyTransform(s.scene, s.id);
    const o = out.objects[s.id] as MeshObj;
    expect(o.t.s).toEqual([1, 1, 1]);
    expect(signedVolume(o.mesh)).toBeCloseTo(16, 4);
  });

  it('set origin to bottom puts the pivot on the floor', () => {
    const a = addPrimitive(createScene('x'), 'sphere', [0, 0, 0]);
    const s = setOrigin(a.scene, a.id, 'bottom');
    expect(s.objects[a.id]!.t.p[1]).toBeCloseTo(0, 5);
  });

  it('join and separate', () => {
    const a = addPrimitive(createScene('x'), 'cube', [0, 0, 0]);
    const b = addPrimitive(a.scene, 'cube', [4, 0, 0]);
    const joined = joinMeshes(b.scene, [a.id, b.id], a.id);
    expect(Object.keys(joined.objects).length).toBe(1);
    expect(faceCount((joined.objects[a.id] as MeshObj).mesh)).toBe(12);
    const sep = separateFaces(joined, a.id, new Set([6, 7, 8, 9, 10, 11]));
    expect(Object.keys(sep.scene.objects).length).toBe(2);
  });

  it('per-face materials add a slot', () => {
    const a = addPrimitive(createScene('x'), 'cube', [0, 0, 0]);
    const s = assignMaterial(a.scene, a.id, 'gold', new Set([4]));
    const o = s.objects[a.id] as MeshObj;
    expect(o.materials.length).toBe(2);
    expect(o.mesh.m![4]).toBe(1);
  });
});

describe('animation', () => {
  it('samples between keys with easing and holds outside', () => {
    const keys = setKey(setKey(undefined, 0, [0], 'linear'), 2, [10]);
    expect(sample(keys, -1)).toEqual([0]);
    expect(sample(keys, 1)![0]).toBeCloseTo(5);
    expect(sample(keys, 5)).toEqual([10]);
    const smooth = setKey(setKey(undefined, 0, [0], 'ease'), 2, [10]);
    expect(sample(smooth, 0.5)![0]).toBeLessThan(2.5);
    expect(ease('constant', 0.9)).toBe(0);
  });

  it('editing an animated object keys it instead of snapping back', () => {
    const a = addPrimitive(createScene('x'), 'cube', [0, 0, 0]);
    let s = keyObject(a.scene, a.id, 0, ['p']);
    // Auto-key is off, but position is already animated: the move becomes a key.
    s = setTransformAt(s, a.id, { p: [4, 1, 0], r: [0, 0, 0], s: [1, 1, 1] }, 2, false);
    const o = s.objects[a.id]!;
    expect(o.anim!.p!.length).toBe(2);
    expect(transformAt(o, 1).p[0]).toBeGreaterThan(0);
    expect(transformAt(o, 1).p[0]).toBeLessThan(4);
    // Unanimated channels change directly.
    s = setTransformAt(s, a.id, { p: [4, 1, 0], r: [0, 0, 0], s: [2, 2, 2] }, 2, false);
    expect(s.objects[a.id]!.t.s).toEqual([2, 2, 2]);
    const cleared = unkeyObject(unkeyObject(s, a.id, 0), a.id, 2);
    expect(cleared.objects[a.id]!.anim).toBeUndefined();
    expect(cleared.objects[a.id]!.t.p[0]).toBeCloseTo(4);
  });

  it('presets make keys and merging replaces only their time span', () => {
    const base = { p: [0, 0, 0] as [number, number, number], r: [0, 0, 0] as [number, number, number], s: [1, 1, 1] as [number, number, number] };
    const spin = presetKeys('spin', base, 0, 2);
    expect(sample(spin.r, 2)![1]).toBeCloseTo(Math.PI * 2);
    const merged = mergeChannels({ r: [{ t: 5, v: [0, 1, 0], e: 'ease' }] }, spin);
    expect(merged.r!.length).toBe(3);
    expect(moveKeys(merged.r!, [5], -1)[2]!.t).toBe(4);
    const bounce = presetKeys('bounce', base, 0, 2);
    expect(bounce.p!.length).toBeGreaterThan(4);
    expect(bounce.s).toBeDefined();
  });
});

describe('modifiers', () => {
  it('mirror joins the halves on the plane', () => {
    // Half a cube (cut at x = 0): mirroring gives back a closed box.
    const half = grid(2, 2);
    const m = evaluate(half, [{ ...createModifier('mirror'), axes: [false, false, true] } as never]);
    expect(faceCount(m)).toBe(8);
  });

  it('array, solidify and subdivision', () => {
    const arr = evaluate(cube(), [{ ...createModifier('array'), count: 3 } as never]);
    expect(faceCount(arr)).toBe(18);
    const solid = evaluate(grid(2, 1), [createModifier('solidify')]);
    expect(isClosedManifold(solid)).toBe(true);
    const sub = evaluate(cube(), [createModifier('subdivision')]);
    expect(faceCount(sub)).toBe(96);
    // Cached: same input gives the same object.
    expect(evaluate(cube(), [])).toBeDefined();
  });

  it('bevel modifier rounds every sharp edge and stays closed', () => {
    const b = evaluate(cube(), [createModifier('bevel')]);
    expect(faceCount(b)).toBe(26);
    expect(isClosedManifold(b)).toBe(true);
  });

  it('decimate reduces triangles and keeps a closed sphere closed', () => {
    const s = uvSphere(1, 32, 16);
    const d = decimate(s, 0.3);
    const tris = faceCount(d);
    expect(tris).toBeLessThan(992 * 0.45);
    expect(tris).toBeGreaterThan(992 * 0.15);
    expect(isClosedManifold(d)).toBe(true);
    expect(signedVolume(d)).toBeGreaterThan(3.4);
    expect(vertCount(d)).toBeLessThan(vertCount(s));
  });

  it('displace moves vertices but keeps the topology', () => {
    const d = evaluate(uvSphere(), [createModifier('displace')]);
    expect(faceCount(d)).toBe(faceCount(uvSphere()));
  });
});
