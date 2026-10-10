/**
 * Loads imported model files (glTF/GLB, FBX, OBJ, STL, PLY) from the media store.
 * Each file is parsed once; every object using it gets its own clone (skeletons included),
 * so rigged characters can be posed independently.
 */
import { Group, Mesh, MeshPhysicalMaterial, type AnimationClip, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getBlob } from '../../engine/media/mediaStore';
import type { ID } from '../model/types';

export interface LoadedModel {
  object: Object3D;
  clips: AnimationClip[];
  /** Bones by name (for pose mode). */
  bones: Map<string, Object3D>;
}

interface Parsed {
  object: Object3D;
  clips: AnimationClip[];
}

const parsed = new Map<ID, Promise<Parsed | null>>();

export function modelFormat(name: string): 'gltf' | 'fbx' | 'obj' | 'stl' | 'ply' | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'glb' || ext === 'gltf') return 'gltf';
  if (ext === 'fbx') return 'fbx';
  if (ext === 'obj') return 'obj';
  if (ext === 'stl') return 'stl';
  if (ext === 'ply') return 'ply';
  return null;
}

/** Parses a model file (shared by import and by loading saved scenes). */
export async function parseModel(data: ArrayBuffer, name: string): Promise<Parsed> {
  const fmt = modelFormat(name);
  switch (fmt) {
    case 'gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(data, '');
      return { object: gltf.scene, clips: gltf.animations };
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      const obj = new FBXLoader().parse(data, '');
      // FBX files are usually in centimeters.
      if (boxSize(obj) > 50) obj.scale.multiplyScalar(0.01);
      return { object: obj, clips: obj.animations };
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      const obj = new OBJLoader().parse(new TextDecoder().decode(data));
      return { object: withPbr(obj), clips: [] };
    }
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geo = new STLLoader().parse(data);
      geo.computeVertexNormals();
      const g = new Group();
      g.add(new Mesh(geo, new MeshPhysicalMaterial({ color: 0xc8c8cc, roughness: 0.5 })));
      return { object: g, clips: [] };
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      const geo = new PLYLoader().parse(data);
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      const g = new Group();
      g.add(
        new Mesh(
          geo,
          new MeshPhysicalMaterial({
            color: 0xc8c8cc,
            roughness: 0.5,
            vertexColors: !!geo.getAttribute('color'),
          }),
        ),
      );
      return { object: g, clips: [] };
    }
    default:
      throw new Error(
        `"${name}" is not a 3D model Kinora can open (use GLB, glTF, FBX, OBJ, STL or PLY).`,
      );
  }
}

function boxSize(o: Object3D): number {
  let max = 0;
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    const m = c as Mesh;
    if (m.isMesh) {
      m.geometry.computeBoundingSphere();
      max = Math.max(max, m.geometry.boundingSphere!.radius * 2);
    }
  });
  return max;
}

/** OBJ files come with old-style materials: switch them to physically based ones. */
function withPbr(o: Object3D): Object3D {
  o.traverse((c) => {
    const m = c as Mesh;
    if (!m.isMesh) return;
    const old = Array.isArray(m.material) ? m.material : [m.material];
    const next = old.map((x) => {
      const src = x as unknown as { color?: { getHex(): number }; map?: unknown; name?: string };
      return new MeshPhysicalMaterial({
        color: src.color?.getHex() ?? 0xc8c8cc,
        roughness: 0.6,
        name: src.name ?? '',
      });
    });
    m.material = Array.isArray(m.material) ? next : next[0]!;
  });
  return o;
}

/** An independent copy of a model asset (loaded from storage on first use). */
export async function loadModel(assetId: ID, name: string): Promise<LoadedModel | null> {
  let p = parsed.get(assetId);
  if (!p) {
    p = (async () => {
      const blob = await getBlob(assetId);
      if (!blob) return null;
      try {
        return await parseModel(await blob.arrayBuffer(), name);
      } catch (err) {
        console.error('Model failed to load', err);
        return null;
      }
    })();
    parsed.set(assetId, p);
  }
  const src = await p;
  if (!src) return null;
  markShared(src.object);
  const object = cloneSkinned(src.object);
  const bones = new Map<string, Object3D>();
  object.traverse((o) => {
    if ((o as { isBone?: boolean }).isBone && o.name) bones.set(o.name, o);
  });
  return { object, clips: src.clips, bones };
}

/** Clones share the source's materials and textures: they must never be disposed with a clone. */
function markShared(o: Object3D): void {
  o.traverse((c) => {
    const m = (c as Mesh).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) x.userData.shared = true;
  });
}

/** Registers an already-parsed model (right after import) so it isn't parsed twice. */
export function primeModel(assetId: ID, p: Parsed): void {
  parsed.set(assetId, Promise.resolve(p));
}
