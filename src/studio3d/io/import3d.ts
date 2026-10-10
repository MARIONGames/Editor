/**
 * Bringing files into a 3D scene: models (kept exactly as authored, rigs and animations
 * included, with a one-tap "make editable"), HDRI skies and texture images. Files are
 * stored in the shared media store, so scenes keep working offline.
 */
import {
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Mesh,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { registerBlob } from '../../engine/media/mediaStore';
import { busy, toast } from '../../state/store';
import * as db from '../../storage/db';
import { pickFiles } from '../../ui/components/filePicker';
import { uid } from '../../util/id';
import { loadModel, modelFormat, parseModel, primeModel } from '../engine/models';
import { makeMesh } from '../model/mesh';
import { mergeByDistance } from '../model/meshOps';
import { createMaterial } from '../model/materials';
import {
  addMaterial,
  addObjects,
  meshObject,
  modelObject,
  removeObjects,
  uniqueName,
  worldMatrix,
} from '../model/scene';
import type {
  Asset3D,
  ID,
  Material3D,
  MeshObj,
  ModelObj,
  Obj3D,
  Scene3D,
  TextureRef,
  TextureSlot,
} from '../model/types';
import { commit3d, setTexture, patchWorld } from '../state/actions3d';
import { scene3d, selection3d, time3d } from '../state/store3d';
import { emit } from '../../state/events';

export const ACCEPT_MODELS = '.glb,.gltf,.fbx,.obj,.stl,.ply,model/gltf-binary,model/gltf+json';
export const ACCEPT_HDRI = '.hdr,.exr';

async function store(file: Blob, name: string, kind: Asset3D['kind']): Promise<Asset3D> {
  const id = uid('a');
  registerBlob(id, file);
  try {
    await db.putMedia(id, file);
  } catch (err) {
    console.warn('putMedia failed', err);
    toast(
      "This file is in your scene, but it couldn't be saved to this device (storage full?).",
      'error',
    );
  }
  return { id, name, kind, mime: file.type || 'application/octet-stream', size: file.size };
}

/* ------------------------------------------------------------------ models */

export async function importModelsFlow(): Promise<void> {
  const files = await pickFiles({ accept: ACCEPT_MODELS, multiple: true });
  if (files.length) await importModelFiles(files);
}

export async function importModelFiles(files: File[]): Promise<ID[]> {
  const added: ID[] = [];
  const models = files.filter((f) => modelFormat(f.name));
  const skipped = files.length - models.length;
  if (skipped)
    toast(
      `${skipped} file${skipped === 1 ? '' : 's'} skipped: Kinora opens GLB, glTF, FBX, OBJ, STL and PLY.`,
      'info',
    );
  for (const [i, file] of models.entries()) {
    busy.value = {
      message: `Opening ${file.name}…`,
      progress: models.length > 1 ? i / models.length : null,
    };
    try {
      const data = await file.arrayBuffer();
      if (
        file.name.toLowerCase().endsWith('.gltf') &&
        /"uri"\s*:\s*"(?!data:)/.test(new TextDecoder().decode(data.slice(0, 2_000_000)))
      ) {
        throw new Error(
          `"${file.name}" uses separate texture/bin files. Export it as a single .glb file and import that instead.`,
        );
      }
      const parsed = await parseModel(data, file.name);
      const asset = await store(file, file.name, 'model');
      primeModel(asset.id, parsed);
      const name = file.name.replace(/\.[^.]+$/, '') || 'Model';
      const obj = modelObject(asset.id, name);
      // Imported models stand on the floor.
      const lift = floorOffset(parsed.object);
      obj.t = { ...obj.t, p: [0, lift, 0] };
      if (parsed.clips.length) obj.clip = { ...obj.clip, name: parsed.clips[0]!.name };
      commit3d(
        `Import ${name}`,
        (s) =>
          addObjects({ ...s, assets: { ...s.assets, [asset.id]: asset } }, [
            { ...obj, name: uniqueName(s, name) },
          ]),
        {
          sel: { ids: [obj.id], active: obj.id },
        },
      );
      // Make the timeline long enough to see the whole first animation.
      const longest = Math.max(0, ...parsed.clips.map((c) => c.duration));
      const s = scene3d.peek();
      if (s && longest > s.anim.end - s.anim.start)
        commit3d('Animation length', (sc) => ({
          ...sc,
          anim: { ...sc.anim, end: sc.anim.start + Math.min(600, longest) },
        }));
      added.push(obj.id);
      emit('3d:added', { kind: 'model' });
    } catch (err) {
      console.error(err);
      toast(
        err instanceof Error ? err.message : `Couldn't open ${file.name}.`,
        'error',
        undefined,
        7000,
      );
    }
  }
  busy.value = null;
  return added;
}

function floorOffset(o: Object3D): number {
  o.updateMatrixWorld(true);
  let minY = Infinity;
  const v = new Vector3();
  o.traverse((c) => {
    const m = c as Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 5000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      minY = Math.min(minY, v.y);
    }
  });
  return Number.isFinite(minY) ? -minY : 0;
}

/**
 * Turns an imported model into editable Kinora meshes (one object per part). Rigged
 * characters lose their skeleton, so this is offered for static models.
 */
export async function makeModelEditable(id: ID): Promise<void> {
  const s = scene3d.peek();
  const o = s?.objects[id];
  if (!s || !o || o.kind !== 'model') return;
  busy.value = { message: 'Converting to editable shapes…', progress: null };
  try {
    const loaded = await loadModel(o.assetId, s.assets[o.assetId]?.name ?? 'model.glb');
    if (!loaded) throw new Error('The model file is missing.');
    const root = loaded.object;
    root.updateMatrixWorld(true);
    const rootInv = new Matrix4().copy(root.matrixWorld).invert();
    const parts: {
      mesh: MeshObj;
      mats: Material3D[];
      textures: TextureRef[];
      assets: Asset3D[];
    }[] = [];
    const matCache = new Map<
      Material,
      { mat: Material3D; textures: TextureRef[]; assets: Asset3D[] }
    >();
    const meshes: Mesh[] = [];
    root.traverse((c) => {
      if ((c as Mesh).isMesh) meshes.push(c as Mesh);
    });
    for (const m of meshes) {
      const local = rootInv.clone().multiply(m.matrixWorld);
      const data = geometryToMesh(m.geometry, local);
      if (!data) continue;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const mats: Material3D[] = [];
      const textures: TextureRef[] = [];
      const assets: Asset3D[] = [];
      for (const mat of list) {
        let conv = matCache.get(mat);
        if (!conv) {
          conv = await convertMaterial(mat);
          matCache.set(mat, conv);
          textures.push(...conv.textures);
          assets.push(...conv.assets);
        }
        mats.push(conv.mat);
      }
      const obj = meshObject(
        m.name || o.name,
        data,
        mats.map((x) => x.id),
        { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
      );
      parts.push({ mesh: { ...obj, parent: null }, mats, textures, assets });
    }
    if (!parts.length) throw new Error('This model has no shapes to convert.');
    const world = worldMatrix(s, id, time3d.peek());
    commit3d('Make editable', (sc) => {
      let next: Scene3D = sc;
      const added: Obj3D[] = [];
      for (const p of parts) {
        for (const a of p.assets) next = { ...next, assets: { ...next.assets, [a.id]: a } };
        for (const t of p.textures) next = { ...next, textures: { ...next.textures, [t.id]: t } };
        for (const m of p.mats) if (!next.materials[m.id]) next = addMaterial(next, m);
        added.push({
          ...p.mesh,
          name: uniqueName(next, p.mesh.name),
          t: decompose(world),
          parent: o.parent,
        });
      }
      next = addObjects(next, added);
      return removeObjects(next, [id]);
    });
    const ids = scene3d.peek()!.order.slice(-parts.length);
    selection3d.value = { ids, active: ids[ids.length - 1] ?? null };
    toast(
      `Converted into ${parts.length} editable shape${parts.length === 1 ? '' : 's'}.`,
      'success',
    );
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not convert this model.', 'error');
  } finally {
    busy.value = null;
  }
}

function decompose(m: Matrix4): {
  p: [number, number, number];
  r: [number, number, number];
  s: [number, number, number];
} {
  const p = new Vector3();
  const sc = new Vector3();
  const q = new Quaternion();
  m.decompose(p, q, sc);
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  return { p: [p.x, p.y, p.z], r: [e.x, e.y, e.z], s: [sc.x, sc.y, sc.z] };
}

function geometryToMesh(g: BufferGeometry, m: Matrix4) {
  const pos = g.getAttribute('position');
  if (!pos || pos.count < 3) return null;
  const v: number[] = [];
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m);
    v.push(p.x, p.y, p.z);
  }
  const uvAttr = g.getAttribute('uv');
  const idx = g.getIndex();
  const count = idx ? idx.count : pos.count;
  const faces: number[][] = [];
  const uvs: (number[] | null)[] = [];
  const mats: number[] = [];
  const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
  const flip = m.determinant() < 0;
  for (const gr of groups) {
    for (let i = gr.start; i + 2 < gr.start + gr.count; i += 3) {
      const a = idx ? idx.getX(i) : i;
      const b = idx ? idx.getX(i + 1) : i + 1;
      const c = idx ? idx.getX(i + 2) : i + 2;
      if (a === b || b === c || a === c) continue;
      const tri = flip ? [a, c, b] : [a, b, c];
      faces.push(tri);
      uvs.push(uvAttr ? tri.flatMap((k) => [uvAttr.getX(k), uvAttr.getY(k)]) : null);
      mats.push(gr.materialIndex ?? 0);
    }
  }
  if (!faces.length) return null;
  // Triangle soups repeat vertices at UV seams: weld them so edges connect for editing.
  return mergeByDistance(makeMesh(v, faces, uvs, mats), 1e-5).mesh;
}

async function convertMaterial(
  src: Material,
): Promise<{ mat: Material3D; textures: TextureRef[]; assets: Asset3D[] }> {
  const m = src as MeshStandardMaterial & {
    transmission?: number;
    ior?: number;
    clearcoat?: number;
    clearcoatRoughness?: number;
    sheen?: number;
  };
  const mat = createMaterial({
    name: m.name || 'Material',
    color: m.color ? `#${m.color.getHexString()}` : '#c8c8cc',
    metalness: m.metalness ?? 0,
    roughness: m.roughness ?? 0.5,
    emissive: m.emissive ? `#${m.emissive.getHexString()}` : '#000000',
    emissiveIntensity: m.emissiveIntensity ?? 1,
    opacity: m.transparent ? (m.opacity ?? 1) : 1,
    transmission: m.transmission ?? 0,
    ior: m.ior ?? 1.5,
    clearcoat: m.clearcoat ?? 0,
    clearcoatRoughness: m.clearcoatRoughness ?? 0.1,
    sheen: typeof m.sheen === 'number' ? m.sheen : 0,
    doubleSided: m.side === 2,
  });
  const textures: TextureRef[] = [];
  const assets: Asset3D[] = [];
  const maps: [TextureSlot, Texture | null | undefined][] = [
    ['color', m.map],
    ['normal', m.normalMap],
    ['roughness', m.roughnessMap],
    ['metalness', m.metalnessMap],
    ['ao', m.aoMap],
    ['emissive', m.emissiveMap],
    ['opacity', m.alphaMap],
  ];
  const done = new Map<Texture, ID>();
  for (const [slot, tex] of maps) {
    if (!tex?.image) continue;
    let texId = done.get(tex);
    if (!texId) {
      const blob = await imageToBlob(
        tex.image as CanvasImageSource & { width: number; height: number },
        !tex.flipY,
      );
      if (!blob) continue;
      const asset = await store(blob, `${mat.name}-${slot}.png`, 'image');
      const ref: TextureRef = { id: uid('t'), name: asset.name, assetId: asset.id };
      textures.push(ref);
      assets.push(asset);
      texId = ref.id;
      done.set(tex, texId);
    }
    mat.maps[slot] = texId;
  }
  return { mat, textures, assets };
}

async function imageToBlob(
  img: CanvasImageSource & { width: number; height: number },
  flip: boolean,
): Promise<Blob | null> {
  try {
    const w = img.width;
    const h = img.height;
    if (!w || !h) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    // glTF textures are stored top-down (flipY = false): the editor expects the usual image orientation.
    if (flip) {
      ctx.translate(0, h);
      ctx.scale(1, -1);
    }
    ctx.drawImage(img, 0, 0);
    return await new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- HDRI */

export async function importHdriFlow(): Promise<void> {
  const files = await pickFiles({ accept: ACCEPT_HDRI });
  const f = files[0];
  if (!f) return;
  if (!/\.(hdr|exr)$/i.test(f.name)) {
    toast('Pick an .hdr or .exr panorama (free ones: polyhaven.com).', 'info');
    return;
  }
  const asset = await store(f, f.name, 'hdri');
  commit3d('Add sky (HDRI)', (s) => ({ ...s, assets: { ...s.assets, [asset.id]: asset } }));
  patchWorld({ env: 'hdri', hdri: asset.id, background: 'env' });
  toast('Sky added: it lights your scene and shows behind it.', 'success');
}

/* ---------------------------------------------------------------- textures */

export async function importTextureFlow(matId: ID, slot: TextureSlot): Promise<void> {
  const files = await pickFiles({ accept: 'image/*' });
  const f = files[0];
  if (!f) return;
  const asset = await store(f, f.name, 'image');
  const ref: TextureRef = { id: uid('t'), name: f.name, assetId: asset.id };
  commit3d('Add texture', (s) => ({
    ...s,
    assets: { ...s.assets, [asset.id]: asset },
    textures: { ...s.textures, [ref.id]: ref },
  }));
  setTexture(matId, slot, ref.id);
}

/** Objects that came from model files (for the outliner's "make editable"). */
export function isModel(o: Obj3D | undefined): o is ModelObj {
  return o?.kind === 'model';
}
