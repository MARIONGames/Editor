import { describe, expect, it } from 'vitest';
import { faceCount, isClosedManifold, signedVolume, triangulate, vertCount } from '../../../src/studio3d/model/mesh';
import { capsule, cone, cube, cylinder, grid, icoSphere, pyramid, torus, uvSphere } from '../../../src/studio3d/model/primitives';

describe('primitives', () => {
  it('cube is a closed 8-vertex, 6-quad box of volume 8', () => {
    const m = cube();
    expect(vertCount(m)).toBe(8);
    expect(faceCount(m)).toBe(6);
    expect(isClosedManifold(m)).toBe(true);
    expect(signedVolume(m)).toBeCloseTo(8, 5);
  });

  it.each([
    ['uv sphere', uvSphere(), (4 / 3) * Math.PI],
    ['ico sphere', icoSphere(1, 3), (4 / 3) * Math.PI],
    ['cylinder', cylinder(), 2 * Math.PI],
    ['cone', cone(), (2 * Math.PI) / 3],
    ['torus', torus(1, 0.25), 2 * Math.PI * Math.PI * 1 * 0.0625],
    ['capsule', capsule(0.5, 2), Math.PI * 0.25 * 1 + (4 / 3) * Math.PI * 0.125],
    ['pyramid', pyramid(), 4 * 2 / 3],
  ])('%s is watertight, faces point outwards and the volume is right', (_name, m, volume) => {
    expect(isClosedManifold(m)).toBe(true);
    const vol = signedVolume(m);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeGreaterThan(volume * 0.93);
    expect(vol).toBeLessThan(volume * 1.01);
  });

  it('grid is open, faces up and triangulates to two triangles per quad', () => {
    const m = grid(2, 4);
    expect(faceCount(m)).toBe(16);
    expect(isClosedManifold(m)).toBe(false);
    expect(triangulate(m).face.length).toBe(32);
  });

  it('every face has UVs', () => {
    for (const m of [cube(), uvSphere(), cylinder(), torus(), icoSphere()]) {
      expect(m.uv).toBeDefined();
      expect(Array.from(m.uv!).some((x) => Number.isNaN(x))).toBe(false);
    }
  });
});
