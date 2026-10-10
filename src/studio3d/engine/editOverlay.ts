/**
 * Edit-mode overlay: the cage of the mesh being edited (vertices, edges, selected
 * faces) and GPU picking. Picking draws every element in a unique color into a small
 * off-screen image around the cursor (or the selection box) and reads it back, so
 * clicking and box selection respect what is hidden behind the surface and stay fast
 * on dense meshes.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineSegments,
  Matrix4,
  Mesh,
  NoBlending,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type OrthographicCamera,
  type WebGLRenderer,
} from 'three';
import { buildDisplay } from '../model/display';
import { edgeEnds, edgeTable, faceOffsets } from '../model/mesh';
import type { MeshSelection, SelectMode } from '../model/meshOps';
import type { MeshData } from '../model/types';

const SELECTED = new Color('#ff9f1a');

const VERT = /* glsl */ `
  attribute float sel;
  attribute float pid;
  uniform float uSize;
  uniform float uBias;
  varying float vSel;
  varying vec3 vId;
  void main() {
    vSel = sel;
    float id = pid + 1.0;
    vId = vec3(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0)) / 255.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Pull overlays slightly towards the camera so they win against the surface they sit on.
    gl_Position.z -= uBias * gl_Position.w;
    gl_PointSize = uSize * (1.0 + sel * 0.35);
  }`;

const FRAG_DISPLAY = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSelColor;
  uniform float uAlpha;
  uniform float uSelAlpha;
  uniform float uRound;
  varying float vSel;
  void main() {
    if (uRound > 0.5) {
      vec2 c = gl_PointCoord - 0.5;
      if (dot(c, c) > 0.25) discard;
    }
    float a = mix(uAlpha, uSelAlpha, vSel);
    if (a <= 0.0) discard;
    gl_FragColor = vec4(mix(uColor, uSelColor, vSel), a);
  }`;

const FRAG_PICK = /* glsl */ `
  varying vec3 vId;
  void main() { gl_FragColor = vec4(vId, 1.0); }`;

function displayMaterial(o: {
  color: string;
  alpha: number;
  selAlpha: number;
  size?: number;
  bias: number;
  round?: boolean;
  depthTest?: boolean;
}): ShaderMaterial {
  const m = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG_DISPLAY,
    transparent: true,
    depthWrite: false,
    depthTest: o.depthTest ?? true,
    uniforms: {
      uColor: { value: new Color(o.color) },
      uSelColor: { value: SELECTED },
      uAlpha: { value: o.alpha },
      uSelAlpha: { value: o.selAlpha },
      uSize: { value: o.size ?? 1 },
      uBias: { value: o.bias },
      uRound: { value: o.round ? 1 : 0 },
    },
  });
  m.allowOverride = false;
  return m;
}

function pickMaterial(size: number, bias: number, colorWrite = true): ShaderMaterial {
  const m = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG_PICK,
    blending: NoBlending,
    colorWrite,
    uniforms: { uSize: { value: size }, uBias: { value: bias } },
  });
  m.allowOverride = false;
  return m;
}

export interface PickResult {
  /** Every element found in the region. */
  ids: Set<number>;
  /** The element closest to the region's center (click picking). */
  nearest: number | null;
}

export class EditOverlay {
  readonly group = new Group();
  private pickScene = new Scene();
  private pickGroup = new Group();
  private faces: Mesh;
  private edges: LineSegments;
  private points: Points;
  private pickFaces: Mesh;
  private pickEdges: LineSegments;
  private pickPoints: Points;
  private occluder: Mesh;
  private mesh: MeshData | null = null;
  private edgeKeys: number[] = [];
  private faceOfCorner: Float32Array = new Float32Array(0);
  private target = new WebGLRenderTarget(1, 1);
  private pixelRatio = 1;

  constructor() {
    this.group.name = 'kinora-edit-overlay';
    this.group.matrixAutoUpdate = false;
    this.group.userData.overlay = true;
    this.pickGroup.matrixAutoUpdate = false;
    this.pickScene.add(this.pickGroup);
    const geo = () => new BufferGeometry();
    this.faces = new Mesh(
      geo(),
      displayMaterial({ color: '#ff9f1a', alpha: 0, selAlpha: 0.28, bias: 0.00005 }),
    );
    this.edges = new LineSegments(
      geo(),
      displayMaterial({ color: '#0d0e12', alpha: 0.85, selAlpha: 1, bias: 0.0003 }),
    );
    this.points = new Points(
      geo(),
      displayMaterial({
        color: '#0d0e12',
        alpha: 1,
        selAlpha: 1,
        size: 5,
        bias: 0.0006,
        round: true,
      }),
    );
    for (const o of [this.faces, this.edges, this.points]) {
      o.frustumCulled = false;
      o.renderOrder = 10;
      o.raycast = () => {};
      this.group.add(o);
    }
    this.points.renderOrder = 11;
    this.occluder = new Mesh(this.faces.geometry, pickMaterial(1, 0, false));
    this.pickFaces = new Mesh(this.faces.geometry, pickMaterial(1, 0));
    this.pickEdges = new LineSegments(this.edges.geometry, pickMaterial(1, 0.0003));
    this.pickPoints = new Points(this.points.geometry, pickMaterial(14, 0.0006));
    for (const o of [this.occluder, this.pickFaces, this.pickEdges, this.pickPoints]) {
      o.frustumCulled = false;
      this.pickGroup.add(o);
    }
  }

  setPixelRatio(r: number): void {
    this.pixelRatio = r;
    (this.points.material as ShaderMaterial).uniforms.uSize!.value = 5 * r;
    (this.pickPoints.material as ShaderMaterial).uniforms.uSize!.value = 14 * r;
  }

  /** Shows the cage of `mesh` (null hides the overlay). */
  update(
    mesh: MeshData | null,
    world: Matrix4,
    sel: MeshSelection,
    mode: SelectMode,
    xray: boolean,
  ): void {
    this.group.visible = !!mesh;
    if (!mesh) {
      this.mesh = null;
      return;
    }
    this.group.matrix.copy(world);
    this.group.matrixWorldNeedsUpdate = true;
    this.pickGroup.matrix.copy(world);
    this.pickGroup.updateMatrixWorld(true);
    if (mesh !== this.mesh) this.rebuild(mesh);
    this.mesh = mesh;
    this.updateSelection(sel);
    this.points.visible = mode === 'vert';
    for (const m of [this.faces, this.edges, this.points])
      (m.material as ShaderMaterial).depthTest = !xray;
    (this.faces.material as ShaderMaterial).uniforms.uAlpha!.value = xray ? 0.06 : 0;
  }

  private rebuild(m: MeshData): void {
    const d = buildDisplay(m, 'flat');
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(d.position, 3));
    fg.setIndex(new BufferAttribute(d.index, 1));
    const corners = m.f.length;
    const o = faceOffsets(m);
    this.faceOfCorner = new Float32Array(corners);
    for (let fi = 0; fi < m.fs.length; fi++) this.faceOfCorner.fill(fi, o[fi]!, o[fi + 1]!);
    fg.setAttribute('pid', new BufferAttribute(this.faceOfCorner, 1));
    fg.setAttribute('sel', new BufferAttribute(new Float32Array(corners), 1));

    const keys = edgeTable(m).keys;
    this.edgeKeys = keys;
    const ep = new Float32Array(keys.length * 6);
    const eid = new Float32Array(keys.length * 2);
    keys.forEach((k, i) => {
      const [a, b] = edgeEnds(k);
      ep.set(m.v.subarray(a * 3, a * 3 + 3), i * 6);
      ep.set(m.v.subarray(b * 3, b * 3 + 3), i * 6 + 3);
      eid[i * 2] = eid[i * 2 + 1] = i;
    });
    const eg = new BufferGeometry();
    eg.setAttribute('position', new BufferAttribute(ep, 3));
    eg.setAttribute('pid', new BufferAttribute(eid, 1));
    eg.setAttribute('sel', new BufferAttribute(new Float32Array(keys.length * 2), 1));

    const nv = m.v.length / 3;
    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(m.v.slice(), 3));
    pg.setAttribute(
      'pid',
      new BufferAttribute(
        Float32Array.from({ length: nv }, (_, i) => i),
        1,
      ),
    );
    pg.setAttribute('sel', new BufferAttribute(new Float32Array(nv), 1));

    for (const [shown, picks, g] of [
      [this.faces, [this.occluder, this.pickFaces], fg],
      [this.edges, [this.pickEdges], eg],
      [this.points, [this.pickPoints], pg],
    ] as const) {
      shown.geometry.dispose();
      shown.geometry = g;
      for (const p of picks) p.geometry = g;
    }
  }

  private updateSelection(sel: MeshSelection): void {
    const fa = this.faces.geometry.getAttribute('sel') as BufferAttribute;
    const arr = fa.array as Float32Array;
    for (let c = 0; c < arr.length; c++) arr[c] = sel.faces.has(this.faceOfCorner[c]!) ? 1 : 0;
    fa.needsUpdate = true;
    const ea = this.edges.geometry.getAttribute('sel') as BufferAttribute;
    const earr = ea.array as Float32Array;
    this.edgeKeys.forEach((k, i) => (earr[i * 2] = earr[i * 2 + 1] = sel.edges.has(k) ? 1 : 0));
    ea.needsUpdate = true;
    const pa = this.points.geometry.getAttribute('sel') as BufferAttribute;
    const parr = pa.array as Float32Array;
    for (let i = 0; i < parr.length; i++) parr[i] = sel.verts.has(i) ? 1 : 0;
    pa.needsUpdate = true;
  }

  /** Edge index (as returned by pick) → edge key. */
  edgeKey(index: number): number {
    return this.edgeKeys[index]!;
  }

  /**
   * Finds elements inside a screen rectangle (CSS pixels, relative to the canvas).
   * `full` is the canvas size in CSS pixels.
   */
  pick(
    renderer: WebGLRenderer,
    camera: PerspectiveCamera | OrthographicCamera,
    full: { w: number; h: number },
    rect: { x: number; y: number; w: number; h: number },
    mode: SelectMode,
    xray: boolean,
  ): PickResult {
    const empty: PickResult = { ids: new Set(), nearest: null };
    if (!this.mesh) return empty;
    const r = this.pixelRatio;
    const W = Math.max(1, Math.round(full.w * r));
    const H = Math.max(1, Math.round(full.h * r));
    const x = Math.round(rect.x * r);
    const y = Math.round(rect.y * r);
    const w = Math.max(1, Math.round(rect.w * r));
    const h = Math.max(1, Math.round(rect.h * r));
    const cam = camera.clone();
    cam.setViewOffset(W, H, x, y, w, h);
    cam.updateProjectionMatrix();
    this.target.setSize(w, h);

    this.occluder.visible = !xray && mode !== 'face';
    this.pickFaces.visible = mode === 'face';
    this.pickEdges.visible = mode === 'edge';
    this.pickPoints.visible = mode === 'vert';
    for (const o of [this.pickFaces, this.pickEdges, this.pickPoints])
      (o.material as ShaderMaterial).depthTest = !xray || mode === 'face';

    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.render(this.pickScene, cam);
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(this.target, 0, 0, w, h, px);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;

    const ids = new Set<number>();
    let nearest: number | null = null;
    let best = Infinity;
    const cx = w / 2;
    const cy = h / 2;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 4;
        if (px[k + 3] === 0) continue;
        const id = px[k]! + px[k + 1]! * 256 + px[k + 2]! * 65536 - 1;
        if (id < 0) continue;
        ids.add(id);
        // Rows come bottom-up from WebGL; distance is symmetric so orientation doesn't matter.
        const d = (i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2;
        if (d < best) {
          best = d;
          nearest = id;
        }
      }
    }
    return { ids, nearest };
  }

  dispose(): void {
    for (const o of [this.faces, this.edges, this.points]) {
      o.geometry.dispose();
      (o.material as ShaderMaterial).dispose();
    }
    for (const o of [this.occluder, this.pickFaces, this.pickEdges, this.pickPoints])
      (o.material as ShaderMaterial).dispose();
    this.target.dispose();
  }
}
