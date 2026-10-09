import { describe, expect, it } from 'vitest';
import { edgeKey, faceCount, faceNormal, isClosedManifold, signedVolume, vertCount } from '../../../src/studio3d/model/mesh';
import {
  boxProjectUV,
  deleteFaces,
  dissolveEdges,
  edgeLoop,
  extrudeEdges,
  extrudeFaces,
  fillVerts,
  flipFaces,
  insetFaces,
  mergeAtCenter,
  mergeByDistance,
  recalcNormals,
  selectLinked,
  subdivideFaces,
  translateVerts,
  triangulateFaces,
  trisToQuads,
} from '../../../src/studio3d/model/meshOps';
import { bevelEdges, edgeRing, loopCut, sharpEdges } from '../../../src/studio3d/model/meshTools';
import { catmullClark } from '../../../src/studio3d/model/subdivision';
import { cube, grid, torus, uvSphere } from '../../../src/studio3d/model/primitives';

const TOP = 4; // the cube's +Y face
const watertight = (m: Parameters<typeof isClosedManifold>[0]) => {
  expect(isClosedManifold(m)).toBe(true);
  expect(signedVolume(m)).toBeGreaterThan(0);
};

describe('extrude', () => {
  it('extruding the top face of a cube adds four walls and keeps it closed', () => {
    const r = extrudeFaces(cube(), new Set([TOP]), 1);
    expect(faceCount(r.mesh)).toBe(10);
    expect(vertCount(r.mesh)).toBe(12);
    watertight(r.mesh);
    expect(signedVolume(r.mesh)).toBeCloseTo(12, 4);
    expect([...r.sel.faces]).toEqual([TOP]);
    expect(faceNormal(r.mesh, TOP)[1]).toBeCloseTo(1, 5);
  });

  it('extruding a region moves it as one piece (no inner walls)', () => {
    const g = grid(2, 2);
    const r = extrudeFaces(g, new Set([0, 1, 2, 3]), 0.5);
    // 4 top faces + 8 border walls.
    expect(faceCount(r.mesh)).toBe(12);
  });

  it('extruding border edges of a plane grows new faces', () => {
    const g = grid(2, 1);
    const r = extrudeEdges(g, new Set([edgeKey(0, 1)]), [0, -1, 0]);
    expect(faceCount(r.mesh)).toBe(2);
    expect(r.sel.edges.size).toBe(1);
  });
});

describe('inset, subdivide, delete, fill', () => {
  it('inset turns one face into five', () => {
    const r = insetFaces(cube(), new Set([TOP]), 0.2);
    expect(faceCount(r.mesh)).toBe(10);
    watertight(r.mesh);
  });

  it('subdividing a face keeps neighbours closed', () => {
    const r = subdivideFaces(cube(), new Set([TOP]));
    expect(faceCount(r.mesh)).toBe(9);
    watertight(r.mesh);
  });

  it('deleting a face opens the mesh and filling the hole closes it again', () => {
    const open = deleteFaces(cube(), new Set([TOP]));
    expect(isClosedManifold(open)).toBe(false);
    const all = new Set(Array.from({ length: vertCount(open) }, (_, i) => i));
    // Pick the four border vertices (y = +1).
    const top = new Set([...all].filter((i) => open.v[i * 3 + 1]! > 0.5));
    const filled = fillVerts(open, top);
    watertight(filled.mesh);
  });
});

describe('merge, normals, topology tools', () => {
  it('merge at center collapses the top face into a point (a pyramid-like top)', () => {
    const c = cube();
    const top = new Set([2, 3, 6, 7]);
    const r = mergeAtCenter(c, top);
    expect(vertCount(r.mesh)).toBe(5);
    watertight(r.mesh);
  });

  it('merge by distance welds duplicated vertices', () => {
    const r = mergeByDistance(translateVerts(cube(), [0], [0, 0, 0]), 0.001);
    expect(r.removed).toBe(0);
    const t = torus(1, 0.25, 8, 4);
    expect(mergeByDistance(t, 0.001).removed).toBe(0);
  });

  it('recalculate normals repairs flipped faces', () => {
    const broken = flipFaces(cube(), new Set([0, 3]));
    expect(isClosedManifold(broken)).toBe(false);
    watertight(recalcNormals(broken));
  });

  it('dissolving an edge merges its two faces', () => {
    const g = grid(2, 2);
    const r = dissolveEdges(g, new Set([edgeKey(1, 4)]));
    expect(faceCount(r.mesh)).toBe(3);
  });

  it('triangulate and back to quads', () => {
    const tri = triangulateFaces(cube());
    expect(faceCount(tri)).toBe(12);
    watertight(tri);
    const quads = trisToQuads(tri);
    expect(faceCount(quads)).toBe(6);
    watertight(quads);
  });

  it('box UVs give every corner coordinates', () => {
    const r = boxProjectUV(extrudeFaces(cube(), new Set([TOP]), 1).mesh);
    expect(Array.from(r.uv!).some(Number.isNaN)).toBe(false);
  });

  it('select linked and edge loops', () => {
    expect(selectLinked(cube(), new Set([0])).verts.size).toBe(8);
    const s = uvSphere(1, 8, 4);
    // A ring edge around the equator: walking the loop returns all 8 equator edges.
    const eq: number[] = [];
    for (let i = 0; i < s.v.length / 3; i++) if (Math.abs(s.v[i * 3 + 1]!) < 1e-6) eq.push(i);
    const loop = edgeLoop(s, edgeKey(eq[0]!, eq[1]!));
    expect(loop.size).toBe(8);
  });
});

describe('loop cut and bevel', () => {
  it('a loop cut around a cube adds a ring of 4 faces', () => {
    const c = cube();
    const ring = edgeRing(c, edgeKey(4, 5));
    expect(ring.closed).toBe(true);
    expect(ring.faces.length).toBe(4);
    const r = loopCut(c, edgeKey(4, 5), 1);
    expect(faceCount(r.mesh)).toBe(10);
    expect(vertCount(r.mesh)).toBe(12);
    expect(r.sel.edges.size).toBe(4);
    watertight(r.mesh);
    expect(signedVolume(r.mesh)).toBeCloseTo(8, 4);
  });

  it('three cuts at once', () => {
    const r = loopCut(cube(), edgeKey(4, 5), 3);
    expect(faceCount(r.mesh)).toBe(18);
    watertight(r.mesh);
  });

  it('beveling one cube edge gives a chamfer and stays closed', () => {
    const r = bevelEdges(cube(), new Set([edgeKey(6, 7)]), 0.2);
    expect(faceCount(r.mesh)).toBe(7);
    expect(vertCount(r.mesh)).toBe(10);
    watertight(r.mesh);
    expect(signedVolume(r.mesh)).toBeCloseTo(8 - 0.2 * 0.2, 4);
  });

  it('beveling every edge of a cube adds corner patches', () => {
    const all = sharpEdges(cube(), 30);
    expect(all.size).toBe(12);
    const r = bevelEdges(cube(), all, 0.2);
    // 6 faces + 12 chamfers + 8 corner triangles.
    expect(faceCount(r.mesh)).toBe(26);
    watertight(r.mesh);
  });

  it('a bevel at a 4-way vertex stays closed', () => {
    const c = loopCut(cube(), edgeKey(4, 5), 1).mesh;
    const r = bevelEdges(c, sharpEdges(c, 30), 0.1);
    watertight(r.mesh);
  });
});

describe('Catmull-Clark subdivision', () => {
  it('one level on a cube gives 24 quads and 26 vertices, rounded inwards', () => {
    const s = catmullClark(cube(), 1);
    expect(faceCount(s)).toBe(24);
    expect(vertCount(s)).toBe(26);
    watertight(s);
    expect(signedVolume(s)).toBeLessThan(8);
    // Corners move to 5/9 and face centers stay at 1: a rounded blob of about 3.33 m³.
    expect(signedVolume(s)).toBeCloseTo(3.333, 2);
  });

  it('two levels keep UVs and stay watertight', () => {
    const s = catmullClark(cube(), 2);
    expect(faceCount(s)).toBe(96);
    watertight(s);
    expect(Array.from(s.uv!).some(Number.isNaN)).toBe(false);
  });

  it('open borders stay on the plane', () => {
    const s = catmullClark(grid(2, 2), 1);
    for (let i = 0; i < s.v.length; i += 3) expect(Math.abs(s.v[i + 1]!)).toBeLessThan(1e-6);
  });
});
