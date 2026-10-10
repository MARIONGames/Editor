/**
 * Mirrors a Scene3D into three.js objects, touching only what changed (objects,
 * meshes and materials are compared by identity, like a tiny virtual DOM).
 */
import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Euler,
  FrontSide,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NoColorSpace,
  Object3D,
  PerspectiveCamera,
  PointLight,
  RectAreaLight,
  RepeatWrapping,
  Sphere,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  Texture,
  Vector3,
  type Material,
  type AnimationClip,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { getBlob, onMediaReady } from '../../engine/media/mediaStore';
import { scalarAt, transformAt } from '../model/animation';
import { buildDisplay } from '../model/display';
import { edgeEnds, edgeTable } from '../model/mesh';
import { evaluate } from '../model/modifiers';
import type {
  ID,
  LightObj,
  Material3D,
  MeshData,
  Obj3D,
  Scene3D,
  TextureSlot,
} from '../model/types';
import { loadModel, type LoadedModel } from './models';

RectAreaLightUniformsLib.init();

interface Node {
  obj: Obj3D;
  root: Object3D;
  /** The drawable (mesh, light, camera…) inside root. */
  body: Object3D | null;
  helper: Object3D | null;
  meshKey?: string;
  meshRef?: MeshData;
  /** Evaluated mesh (modifiers applied) currently on screen. */
  evaluated?: MeshData;
  /** Polygon edges shown by the wireframe overlay. */
  wire?: LineSegments;
  model?: { assetId: ID; loaded: LoadedModel | null; mixer: AnimationMixer | null };
}

const DEFAULT_MATERIAL = new MeshPhysicalMaterial({ color: 0xc8c8cc, roughness: 0.5 });
DEFAULT_MATERIAL.userData.shared = true;

export interface SyncOptions {
  time: number;
  /** Show lights/cameras/empties as editor helpers. */
  helpers: boolean;
  /** Draw every mesh's polygon edges on top. */
  wire: boolean;
  /** Selected objects (their helpers turn orange). */
  selected?: ReadonlySet<ID>;
  active?: ID | null;
}

export class SceneSync {
  readonly root = new Group();
  private nodes = new Map<ID, Node>();
  private materials = new Map<ID, { src: Material3D; mat: MeshPhysicalMaterial }>();
  private textures = new Map<ID, Texture | null>();
  private scene: Scene3D | null = null;
  private opts: SyncOptions = { time: 0, helpers: true, wire: false };
  /** Called when something loads in the background (textures, models). */
  onAsyncChange: (() => void) | null = null;

  constructor() {
    this.root.name = 'kinora-scene';
    onMediaReady(() => this.onAsyncChange?.());
  }

  /** The three.js object for a scene object. */
  objectFor(id: ID): Object3D | null {
    return this.nodes.get(id)?.root ?? null;
  }

  /** Drawable meshes of an object (for selection outlines and picking). */
  meshesOf(id: ID): Object3D[] {
    const n = this.nodes.get(id);
    if (!n?.body) return [];
    const out: Object3D[] = [];
    n.body.traverse((o) => {
      if ((o as Mesh).isMesh) out.push(o);
    });
    return out;
  }

  helperOf(id: ID): Object3D | null {
    return this.nodes.get(id)?.helper ?? null;
  }

  update(scene: Scene3D, opts: SyncOptions): void {
    this.scene = scene;
    this.opts = opts;
    this.syncMaterials(scene);
    const live = new Set(scene.order);
    for (const [id, n] of this.nodes) {
      if (!live.has(id)) {
        n.root.removeFromParent();
        dispose(n.root);
        this.nodes.delete(id);
      }
    }
    for (const id of scene.order) {
      const obj = scene.objects[id];
      if (obj) this.syncObject(obj);
    }
    // Parenting (after every node exists).
    for (const id of scene.order) {
      const obj = scene.objects[id]!;
      const n = this.nodes.get(id)!;
      const parent = (obj.parent && this.nodes.get(obj.parent)?.root) || this.root;
      if (n.root.parent !== parent) parent.add(n.root);
    }
    for (const n of this.nodes.values()) {
      if (n.body instanceof DirectionalLight && n.body.castShadow) fitSunShadow(n.body, this.root);
    }
  }

  /* ---------------------------------------------------------- objects */

  private syncObject(obj: Obj3D): void {
    let n = this.nodes.get(obj.id);
    if (n && n.obj.kind !== obj.kind) {
      n.root.removeFromParent();
      dispose(n.root);
      this.nodes.delete(obj.id);
      n = undefined;
    }
    if (!n) {
      const root = new Group();
      root.userData.objId = obj.id;
      n = { obj, root, body: null, helper: null };
      this.nodes.set(obj.id, n);
      this.root.add(root);
    }
    const t = transformAt(obj, this.opts.time);
    n.root.position.set(...t.p);
    n.root.rotation.set(t.r[0], t.r[1], t.r[2], 'XYZ');
    n.root.scale.set(...t.s);
    n.root.visible = obj.visible;
    n.root.name = obj.name;
    switch (obj.kind) {
      case 'mesh':
        this.syncMesh(n, obj);
        break;
      case 'light':
        this.syncLight(n, obj);
        break;
      case 'camera':
        this.syncCamera(n, obj);
        break;
      case 'empty':
        this.syncEmpty(n, obj.size);
        break;
      case 'model':
        this.syncModel(n, obj);
        break;
    }
    if (n.helper) {
      n.helper.visible = this.opts.helpers;
      const color =
        obj.id === this.opts.active
          ? ACTIVE_COLOR
          : this.opts.selected?.has(obj.id)
            ? SELECTED_COLOR
            : HELPER_COLOR;
      n.helper.traverse((h) => {
        const mat = (h as Line).material as LineBasicMaterial | undefined;
        if ((h as Line).isLine && mat) {
          mat.color.setHex(color);
          mat.opacity = color === HELPER_COLOR ? 0.75 : 1;
        }
      });
    }
    n.obj = obj;
  }

  private syncMesh(n: Node, obj: Extract<Obj3D, { kind: 'mesh' }>): void {
    const key = `${JSON.stringify(obj.modifiers)}|${obj.shade}|${obj.smoothAngle}`;
    let mesh = n.body as Mesh | null;
    if (!mesh) {
      mesh = new Mesh(new BufferGeometry(), DEFAULT_MATERIAL);
      mesh.userData.objId = obj.id;
      n.body = mesh;
      n.root.add(mesh);
    }
    if (n.meshRef !== obj.mesh || n.meshKey !== key) {
      const evaluated = evaluate(obj.mesh, obj.modifiers);
      const d = buildDisplay(evaluated, obj.shade, obj.smoothAngle);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(d.position, 3));
      g.setAttribute('normal', new BufferAttribute(d.normal, 3));
      g.setAttribute('uv', new BufferAttribute(d.uv, 2));
      g.setIndex(new BufferAttribute(d.index, 1));
      for (const gr of d.groups) g.addGroup(gr.start, gr.count, gr.slot);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      g.userData.triFace = d.triFace;
      mesh.geometry.dispose();
      mesh.geometry = g;
      n.meshRef = obj.mesh;
      n.meshKey = key;
      n.evaluated = evaluated;
      if (n.wire) {
        n.wire.removeFromParent();
        n.wire.geometry.dispose();
        n.wire = undefined;
      }
    }
    if (this.opts.wire && !n.wire && n.evaluated) {
      n.wire = new LineSegments(edgeGeometry(n.evaluated), WIRE_MATERIAL);
      n.wire.userData.overlay = true;
      n.wire.raycast = () => {};
      mesh.add(n.wire);
    }
    if (n.wire) n.wire.visible = this.opts.wire;
    const slots = obj.materials.length ? obj.materials : [''];
    const mats = slots.map((id) => this.materials.get(id)?.mat ?? DEFAULT_MATERIAL);
    const nextMat: Material | Material[] = mats.length === 1 ? mats[0]! : mats;
    if (!sameMaterials(mesh.material, nextMat)) mesh.material = nextMat;
    mesh.castShadow = obj.castShadow;
    mesh.receiveShadow = obj.receiveShadow;
  }

  private syncLight(n: Node, obj: LightObj): void {
    const L = obj.light;
    const intensity = scalarAt(obj, 'light.intensity', L.intensity, this.opts.time);
    let body = n.body as (DirectionalLight | PointLight | SpotLight | RectAreaLight) | null;
    const wanted = {
      sun: 'DirectionalLight',
      point: 'PointLight',
      spot: 'SpotLight',
      area: 'RectAreaLight',
    }[L.type];
    if (!body || body.type !== wanted) {
      if (body) {
        body.removeFromParent();
        body.dispose();
      }
      if (n.helper) {
        n.helper.removeFromParent();
        dispose(n.helper);
      }
      body =
        L.type === 'sun'
          ? new DirectionalLight()
          : L.type === 'point'
            ? new PointLight()
            : L.type === 'spot'
              ? new SpotLight()
              : new RectAreaLight();
      if (body instanceof DirectionalLight || body instanceof SpotLight) {
        // Lights shine down their local -Z axis, like cameras.
        body.target.position.set(0, 0, -1);
        body.add(body.target);
        body.shadow.mapSize.set(2048, 2048);
        body.shadow.bias = -0.0004;
        body.shadow.normalBias = 0.02;
        body.shadow.radius = 3;
      }
      if (body instanceof PointLight) {
        body.shadow.mapSize.set(1024, 1024);
        body.shadow.bias = -0.001;
      }
      n.body = body;
      n.root.add(body);
      n.helper = lightHelper(L.type, obj.id);
      n.root.add(n.helper);
    }
    body.color.set(L.color);
    body.intensity = intensity;
    if (body instanceof PointLight || body instanceof SpotLight) {
      body.distance = L.range;
      body.decay = 2;
    }
    if (body instanceof SpotLight) {
      body.angle = (Math.min(170, Math.max(1, L.angle)) * Math.PI) / 360;
      body.penumbra = L.softness;
    }
    if (body instanceof RectAreaLight) {
      body.width = L.size[0];
      body.height = L.size[1];
    }
    if (!(body instanceof RectAreaLight)) body.castShadow = L.shadow;
  }

  private syncCamera(n: Node, obj: Extract<Obj3D, { kind: 'camera' }>): void {
    let cam = n.body as PerspectiveCamera | null;
    if (!cam) {
      cam = new PerspectiveCamera();
      n.body = cam;
      n.root.add(cam);
      n.helper = cameraHelper(obj.id);
      n.root.add(n.helper);
    }
    cam.fov = scalarAt(obj, 'camera.fov', obj.camera.fov, this.opts.time);
    cam.near = obj.camera.near;
    cam.far = obj.camera.far;
    const r = this.scene ? this.scene.render.width / this.scene.render.height : 16 / 9;
    cam.aspect = r;
    cam.updateProjectionMatrix();
    const h = n.helper!;
    h.scale.set(Math.tan((cam.fov * Math.PI) / 360) * r, Math.tan((cam.fov * Math.PI) / 360), 1);
  }

  private syncEmpty(n: Node, size: number): void {
    if (!n.helper) {
      n.helper = emptyHelper(n.root.userData.objId as ID);
      n.root.add(n.helper);
    }
    n.helper.scale.setScalar(size);
  }

  private syncModel(n: Node, obj: Extract<Obj3D, { kind: 'model' }>): void {
    if (!n.model || n.model.assetId !== obj.assetId) {
      if (n.body) n.body.removeFromParent();
      n.body = null;
      n.model = { assetId: obj.assetId, loaded: null, mixer: null };
      const placeholder = new Mesh(
        new BoxGeometry(1, 1, 1),
        new MeshBasicMaterial({ color: 0x7c5cff, wireframe: true }),
      );
      placeholder.userData.objId = obj.id;
      n.body = placeholder;
      n.root.add(placeholder);
      const asset = this.scene?.assets[obj.assetId];
      void loadModel(obj.assetId, asset?.name ?? 'model.glb').then((loaded) => {
        if (!loaded || this.nodes.get(obj.id) !== n || n.model?.assetId !== obj.assetId) return;
        placeholder.removeFromParent();
        dispose(placeholder);
        loaded.object.traverse((o) => {
          o.userData.objId = obj.id;
          if ((o as Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        n.body = loaded.object;
        n.root.add(loaded.object);
        n.model!.loaded = loaded;
        n.model!.mixer = loaded.clips.length ? new AnimationMixer(loaded.object) : null;
        this.applyModelPose(n, n.obj as Extract<Obj3D, { kind: 'model' }>);
        this.onAsyncChange?.();
      });
    }
    this.applyModelPose(n, obj);
  }

  private applyModelPose(n: Node, obj: Extract<Obj3D, { kind: 'model' }>): void {
    const m = n.model;
    if (!m?.loaded) return;
    if (m.mixer) {
      m.mixer.stopAllAction();
      const clip: AnimationClip | undefined =
        m.loaded.clips.find((c) => c.name === obj.clip.name) ??
        (obj.clip.name === null ? undefined : m.loaded.clips[0]);
      if (clip) {
        const action = m.mixer.clipAction(clip);
        action.play();
        let t = (this.opts.time - obj.clip.offset) * obj.clip.speed;
        if (obj.clip.loop) t = ((t % clip.duration) + clip.duration) % clip.duration;
        else t = Math.max(0, Math.min(clip.duration, t));
        m.mixer.setTime(t);
      }
    }
    // Pose-mode bone keys on top of the clip.
    if (obj.anim) {
      for (const [ch, keys] of Object.entries(obj.anim)) {
        const mm = /^bone:(.+):r$/.exec(ch);
        if (!mm || !keys.length) continue;
        const bone = m.loaded.bones.get(mm[1]!);
        const v = sampleKeys(keys, this.opts.time);
        if (bone && v) bone.rotation.copy(new Euler(v[0], v[1], v[2], 'XYZ'));
      }
    }
  }

  /** Bones of a loaded model (pose mode). */
  bonesOf(id: ID): Map<string, Object3D> | null {
    return this.nodes.get(id)?.model?.loaded?.bones ?? null;
  }

  clipsOf(id: ID): AnimationClip[] {
    return this.nodes.get(id)?.model?.loaded?.clips ?? [];
  }

  /* -------------------------------------------------------- materials */

  private syncMaterials(scene: Scene3D): void {
    for (const [id, entry] of this.materials) {
      if (!scene.materials[id]) {
        entry.mat.dispose();
        this.materials.delete(id);
      }
    }
    for (const m of Object.values(scene.materials)) {
      const entry = this.materials.get(m.id);
      if (entry && entry.src === m) continue;
      const mat = entry?.mat ?? new MeshPhysicalMaterial();
      mat.userData.shared = true;
      applyMaterial(mat, m, (slot, texId) =>
        this.texture(texId, slot === 'color' || slot === 'emissive'),
      );
      this.materials.set(m.id, { src: m, mat });
    }
  }

  private texture(id: ID, color: boolean): Texture | null {
    if (this.textures.has(id)) return this.textures.get(id)!;
    this.textures.set(id, null);
    const ref = this.scene?.textures[id];
    if (!ref) return null;
    void getBlob(ref.assetId).then(async (blob) => {
      if (!blob) return;
      const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' });
      const tex = new Texture(bmp);
      tex.flipY = false;
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.colorSpace = color ? SRGBColorSpace : NoColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      this.textures.set(id, tex);
      // Re-apply materials that use it.
      for (const entry of this.materials.values()) {
        if (Object.values(entry.src.maps).includes(id))
          applyMaterial(entry.mat, entry.src, (_slot, texId) => this.textures.get(texId) ?? null);
      }
      this.onAsyncChange?.();
    });
    return null;
  }

  /** The three.js material for a scene material (thumbnails, previews). */
  materialFor(id: ID): MeshPhysicalMaterial | null {
    return this.materials.get(id)?.mat ?? null;
  }

  dispose(): void {
    dispose(this.root);
    for (const e of this.materials.values()) e.mat.dispose();
    for (const t of this.textures.values()) t?.dispose();
    this.nodes.clear();
  }
}

/* ------------------------------------------------------------------ helpers */

function sampleKeys(keys: { t: number; v: number[] }[], t: number): number[] | null {
  // Linear sampling is enough for bone poses between keys.
  if (!keys.length) return null;
  if (t <= keys[0]!.t) return keys[0]!.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t <= b.t) {
      const k = (t - a.t) / Math.max(1e-9, b.t - a.t);
      const s = k * k * (3 - 2 * k);
      return a.v.map((x, j) => x + (b.v[j]! - x) * s);
    }
  }
  return keys[keys.length - 1]!.v;
}

export function applyMaterial(
  mat: MeshPhysicalMaterial,
  m: Material3D,
  tex: (slot: TextureSlot, id: ID) => Texture | null,
): void {
  mat.name = m.name;
  mat.color.set(m.color);
  mat.metalness = m.metalness;
  mat.roughness = m.roughness;
  mat.emissive.set(m.emissive);
  mat.emissiveIntensity = m.emissiveIntensity;
  mat.opacity = m.opacity;
  mat.transparent = m.opacity < 0.999;
  mat.depthWrite = m.opacity >= 0.999;
  mat.transmission = m.transmission;
  mat.ior = m.ior;
  mat.thickness = m.transmission > 0 ? 0.5 : 0;
  mat.clearcoat = m.clearcoat;
  mat.clearcoatRoughness = m.clearcoatRoughness;
  mat.sheen = m.sheen;
  mat.sheenColor = new Color(m.color).lerp(new Color('#ffffff'), 0.5);
  mat.sheenRoughness = 0.6;
  mat.side = m.doubleSided || m.opacity < 0.999 ? DoubleSide : FrontSide;
  const set = (slot: TextureSlot) => {
    const id = m.maps[slot];
    const t = id ? tex(slot, id) : null;
    if (t) t.repeat.set(m.uvScale[0], m.uvScale[1]);
    return t;
  };
  mat.map = set('color');
  mat.normalMap = set('normal');
  mat.normalScale.set(m.normalStrength, m.normalStrength);
  mat.roughnessMap = set('roughness');
  mat.metalnessMap = set('metalness');
  mat.aoMap = set('ao');
  mat.emissiveMap = set('emissive');
  mat.alphaMap = set('opacity');
  if (mat.alphaMap) mat.transparent = true;
  mat.needsUpdate = true;
}

/** Line geometry of a polygon mesh's edges (quads stay quads, unlike a triangle wireframe). */
export function edgeGeometry(m: MeshData): BufferGeometry {
  const keys = edgeTable(m).keys;
  const pos = new Float32Array(keys.length * 6);
  keys.forEach((k, i) => {
    const [a, b] = edgeEnds(k);
    pos.set(m.v.subarray(a * 3, a * 3 + 3), i * 6);
    pos.set(m.v.subarray(b * 3, b * 3 + 3), i * 6 + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  return g;
}

const WIRE_MATERIAL = new LineBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});
WIRE_MATERIAL.userData.shared = true;
WIRE_MATERIAL.allowOverride = false;

function sameMaterials(a: Material | Material[], b: Material | Material[]): boolean {
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (!Array.isArray(a)) return a === b;
  const bb = b as Material[];
  return a.length === bb.length && a.every((m, i) => m === bb[i]);
}

const HELPER_COLOR = 0x111111;
const SELECTED_COLOR = 0xff9f1a;
const ACTIVE_COLOR = 0xffc861;
const lineMat = () => {
  const m = new LineBasicMaterial({
    color: HELPER_COLOR,
    depthTest: true,
    transparent: true,
    opacity: 0.75,
  });
  m.allowOverride = false;
  return m;
};

function pickTarget(id: ID, radius: number): Mesh {
  const mat = new MeshBasicMaterial({ visible: false });
  mat.allowOverride = false;
  const m = new Mesh(new SphereGeometry(radius, 8, 6), mat);
  m.userData.objId = id;
  m.userData.pickOnly = true;
  return m;
}

function circle(r: number, segments = 32, y = 0): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
  }
  return new Float32Array(pts);
}

function lightHelper(type: LightObj['light']['type'], id: ID): Object3D {
  const g = new Group();
  g.userData.helper = true;
  const ring = new BufferGeometry();
  ring.setAttribute('position', new BufferAttribute(circle(0.25), 3));
  const ringLine = new Line(ring, lineMat());
  ringLine.rotation.x = Math.PI / 2;
  g.add(ringLine);
  if (type !== 'point') {
    const dir = new BufferGeometry();
    const len = type === 'sun' ? 1.6 : 1.1;
    const pts = [0, 0, 0, 0, 0, -len];
    if (type === 'spot')
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        pts.push(0, 0, 0, Math.cos(a) * 0.45, Math.sin(a) * 0.45, -len);
      }
    if (type === 'area')
      pts.push(
        -0.5,
        -0.5,
        0,
        0.5,
        -0.5,
        0,
        0.5,
        -0.5,
        0,
        0.5,
        0.5,
        0,
        0.5,
        0.5,
        0,
        -0.5,
        0.5,
        0,
        -0.5,
        0.5,
        0,
        -0.5,
        -0.5,
        0,
      );
    dir.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    g.add(new LineSegments(dir, lineMat()));
  }
  g.add(pickTarget(id, 0.35));
  return g;
}

function cameraHelper(id: ID): Object3D {
  const g = new Group();
  g.userData.helper = true;
  // Unit frustum (scaled by fov/aspect in sync): apex at the origin, looking down -Z.
  const d = 1;
  const p = [
    [0, 0, 0],
    [-1, -1, -d],
    [0, 0, 0],
    [1, -1, -d],
    [0, 0, 0],
    [1, 1, -d],
    [0, 0, 0],
    [-1, 1, -d],
    [-1, -1, -d],
    [1, -1, -d],
    [1, -1, -d],
    [1, 1, -d],
    [1, 1, -d],
    [-1, 1, -d],
    [-1, 1, -d],
    [-1, -1, -d],
    // "Up" triangle.
    [-0.5, 1.1, -d],
    [0, 1.5, -d],
    [0, 1.5, -d],
    [0.5, 1.1, -d],
    [0.5, 1.1, -d],
    [-0.5, 1.1, -d],
  ].flat();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  const lines = new LineSegments(geo, lineMat());
  lines.scale.setScalar(0.8);
  g.add(lines);
  const t = pickTarget(id, 0.4);
  t.position.z = -0.4;
  g.add(t);
  return g;
}

function emptyHelper(id: ID): Object3D {
  const g = new Group();
  g.userData.helper = true;
  const geo = new BufferGeometry();
  geo.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1]),
      3,
    ),
  );
  g.add(new LineSegments(geo, lineMat()));
  g.add(pickTarget(id, 0.3));
  return g;
}

/** Keeps the sun's shadow map tight around the whole scene (sharper shadows). */
function fitSunShadow(light: DirectionalLight, root: Object3D): void {
  root.updateMatrixWorld(true);
  const box = new Box3();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || o.userData.pickOnly || o.userData.overlay || !isShown(o)) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(_box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
  });
  if (box.isEmpty()) box.setFromCenterAndSize(new Vector3(), new Vector3(10, 10, 10));
  const sphere = box.getBoundingSphere(new Sphere());
  const r = Math.min(Math.max(sphere.radius, 1) * 1.05, 400);
  // The shadow camera sits at the light and looks at its target: fit the scene's
  // bounding sphere in that camera's space.
  const eye = new Vector3().setFromMatrixPosition(light.matrixWorld);
  const target = new Vector3().setFromMatrixPosition(light.target.matrixWorld);
  // Same construction three.js uses for the shadow camera.
  const view = new Matrix4().lookAt(eye, target, new Vector3(0, 1, 0));
  view.setPosition(eye);
  const c = sphere.center.clone().applyMatrix4(view.invert());
  const cam = light.shadow.camera;
  cam.left = c.x - r;
  cam.right = c.x + r;
  cam.bottom = c.y - r;
  cam.top = c.y + r;
  cam.near = -c.z - r;
  cam.far = -c.z + r;
  cam.updateProjectionMatrix();
}

const _box = new Box3();

function isShown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export function dispose(o: Object3D): void {
  o.traverse((c) => {
    const m = c as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as Material | Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : [])
      if (!x.userData.shared) x.dispose();
  });
}
