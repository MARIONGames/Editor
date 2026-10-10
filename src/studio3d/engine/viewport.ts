/**
 * The 3D viewport: one WebGL renderer that draws the scene on demand, orbit/pan/zoom
 * navigation, the view cube, the floor grid, click and box selection, the move/rotate/
 * scale gizmo, Blender-style G/R/S keys, the edit-mode cage, camera views and final
 * renders. The UI drives it with `setState` and hears back through `ViewportHost`.
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  HalfFloatType,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  NeutralToneMapping,
  NoToneMapping,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  ShadowMaterial,
  Timer,
  SRGBColorSpace,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Intersection,
  type ToneMapping,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { emptySelection, type MeshSelection, type SelectMode } from '../model/meshOps';
import { sceneBounds, transformOf, worldMatrix } from '../model/scene';
import type { ID, MeshObj, RenderSettings3D, Scene3D, Transform3 } from '../model/types';
import { EditOverlay } from './editOverlay';
import { Environments } from './environment';
import { FloorGrid } from './grid';
import { ModalTransform, type ModalKind, type SnapSettings } from './modal';
import { SelectionOutline } from './outline';
import { SceneSync } from './sync';
import {
  applyDelta,
  objectTargets,
  vertexTargets,
  type Orientation,
  type PivotMode,
  type TransformTargets,
} from './transform';

export type Mode3D = 'object' | 'edit';
export type Shading = 'solid' | 'material' | 'rendered';
export type Tool3D = 'select' | 'move' | 'rotate' | 'scale';
export type SelectHow = 'set' | 'add' | 'toggle' | 'remove';

export interface Overlays {
  grid: boolean;
  wire: boolean;
  xray: boolean;
  helpers: boolean;
}

export interface ViewState {
  scene: Scene3D;
  selected: readonly ID[];
  active: ID | null;
  mode: Mode3D;
  editSel: MeshSelection;
  selectMode: SelectMode;
  time: number;
  shading: Shading;
  overlays: Overlays;
  tool: Tool3D;
  snap: SnapSettings;
  orientation: Orientation;
  pivot: PivotMode;
  autoKey: boolean;
  lookThrough: boolean;
  light: boolean;
}

export interface ViewportHost {
  selectObjects(ids: ID[], how: SelectHow): void;
  /** Edit mode: vertex indices, edge keys or face indices depending on the select mode. */
  selectElements(ids: Set<number>, how: SelectHow): void;
  /** Shows an in-progress change (no undo step yet). */
  live(scene: Scene3D): void;
  /** Ends a gesture: one undo step from `before` to `after`. */
  finish(label: string, before: Scene3D, after: Scene3D): void;
  /** Header text while a modal transform runs (null = done). */
  status(text: string | null): void;
  doubleClick(id: ID | null): void;
  contextMenu(clientX: number, clientY: number): void;
  /** The view changed (camera frame overlay needs to follow). */
  viewChanged?(): void;
}

const TONE: Record<RenderSettings3D['tone'], ToneMapping> = {
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  neutral: NeutralToneMapping,
  none: NoToneMapping,
};

const CLICK_SLOP = 5;

interface Gesture {
  id: number;
  button: number;
  x: number;
  y: number;
  box: boolean;
  moved: boolean;
  shift: boolean;
  ctrl: boolean;
  viewHelper: boolean;
}

interface Modal {
  op: ModalTransform;
  before: Scene3D;
  base: Scene3D;
  label: string;
  current: Scene3D;
  /** On Esc: undo everything ('before') or keep the starting point ('base', e.g. a fresh copy). */
  cancelTo: 'before' | 'base';
  onCancel?: () => void;
}

export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private el: HTMLElement;
  private host: ViewportHost;
  private scene = new Scene();
  private sync = new SceneSync();
  private envs: Environments;
  private grid = new FloorGrid();
  private floor: Mesh<PlaneGeometry, ShadowMaterial>;
  private edit = new EditOverlay();
  private outline = new SelectionOutline();
  private persp = new PerspectiveCamera(40, 1, 0.05, 5000);
  private ortho = new OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  private camera: PerspectiveCamera | OrthographicCamera = this.persp;
  private orbit: OrbitControls;
  private viewHelper: ViewHelper;
  private gizmo: TransformControls;
  private proxy = new Object3D();
  private guide: Line;
  private solidMaterial = new MeshStandardMaterial({
    color: 0xbfc0c6,
    roughness: 0.62,
    metalness: 0,
  });
  private raycaster = new Raycaster();
  private timer = new Timer();
  private raf = 0;
  private dirty = true;
  private state: ViewState | null = null;
  private size = new Vector2(1, 1);
  private pixelRatio = 1;
  private gesture: Gesture | null = null;
  private boxEl: HTMLDivElement;
  private pointer = new Vector2(-1, -1);
  private pointerInside = false;
  private modal: Modal | null = null;
  private gizmoSession: {
    targets: TransformTargets;
    start: Matrix4;
    before: Scene3D;
    current: Scene3D;
  } | null = null;
  private lastClick = { time: 0, x: 0, y: 0 };
  private flight: {
    from: Vector3;
    to: Vector3;
    fromPos: Vector3;
    toPos: Vector3;
    t: number;
  } | null = null;
  private boxOnce = false;
  private ctrlHeld = false;
  private resizeObs: ResizeObserver;
  private disposed = false;
  /** A final render is running: the interactive view pauses. */
  private rendering = false;

  constructor(el: HTMLElement, host: ViewportHost) {
    this.el = el;
    this.host = host;
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'vp-canvas';
    this.canvas.style.touchAction = 'none';
    el.appendChild(this.canvas);
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'vp-box';
    this.boxEl.hidden = true;
    el.appendChild(this.boxEl);

    this.envs = new Environments(this.renderer);
    this.envs.onLoaded = () => this.requestRender();
    this.sync.onAsyncChange = () => {
      if (this.state) this.applyState(this.state);
    };

    this.persp.position.set(7, 5, 9);
    this.ortho.position.copy(this.persp.position);
    this.scene.add(this.sync.root);

    this.floor = new Mesh(
      new PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new ShadowMaterial({ opacity: 0.32, depthWrite: false }),
    );
    this.floor.material.allowOverride = false;
    this.floor.receiveShadow = true;
    this.floor.userData.overlay = true;
    this.floor.raycast = () => {};
    this.floor.renderOrder = -2;
    this.scene.add(this.floor, this.grid, this.edit.group);

    const guideGeo = new BufferGeometry();
    guideGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const guideMat = new LineBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      transparent: true,
    });
    guideMat.toneMapped = false;
    guideMat.allowOverride = false;
    this.guide = new Line(guideGeo, guideMat);
    this.guide.visible = false;
    this.guide.frustumCulled = false;
    this.guide.renderOrder = 20;
    this.scene.add(this.guide);

    this.orbit = new OrbitControls(this.persp, this.canvas);
    this.orbit.target.set(0, 1, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.zoomToCursor = true;
    this.orbit.mouseButtons = { LEFT: 0, MIDDLE: 0, RIGHT: 2 };
    this.orbit.addEventListener('change', () => {
      this.dirty = true;
      this.host.viewChanged?.();
    });
    this.persp.lookAt(this.orbit.target);

    this.viewHelper = this.makeViewHelper();

    this.gizmo = new TransformControls(this.persp, this.canvas);
    this.scene.add(this.proxy);
    const helper = this.gizmo.getHelper();
    helper.traverse((o) => {
      const m = (o as Mesh).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.allowOverride = false;
    });
    this.scene.add(helper);
    this.gizmo.addEventListener('change', () => (this.dirty = true));
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
    });
    this.gizmo.addEventListener('mouseDown', () => this.gizmoStart());
    this.gizmo.addEventListener('objectChange', () => this.gizmoMove());
    this.gizmo.addEventListener('mouseUp', () => this.gizmoEnd());

    el.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerenter', () => (this.pointerInside = true));
    el.addEventListener('pointerleave', () => (this.pointerInside = false));
    window.addEventListener('pointerup', this.onPointerUp, { capture: true });
    window.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(el);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  private makeViewHelper(): ViewHelper {
    const vh = new ViewHelper(this.camera, this.canvas);
    vh.location.top = 12;
    vh.location.right = 12;
    vh.center = this.orbit.target;
    vh.setLabels('X', 'Y', 'Z');
    return vh;
  }

  /* ----------------------------------------------------------------- state */

  setState(s: ViewState): void {
    this.state = s;
    this.applyState(s);
  }

  private applyState(s: ViewState): void {
    if (this.rendering) return;
    const scene = s.scene;
    const selected = new Set(s.selected);
    this.sync.update(scene, {
      time: s.time,
      helpers: s.overlays.helpers && !s.lookThrough,
      wire: s.overlays.wire,
      selected,
      active: s.active,
    });
    this.renderer.toneMapping = TONE[scene.render.tone];
    this.renderer.toneMappingExposure = scene.render.exposure;
    this.applyWorld(s, false);
    this.grid.visible = s.overlays.grid && !s.lookThrough;
    this.floor.visible = scene.world.floorShadow && s.shading !== 'solid';
    this.scene.overrideMaterial = s.shading === 'solid' ? this.solidMaterial : null;

    // Edit-mode cage.
    const activeObj = s.active ? scene.objects[s.active] : undefined;
    const editing = s.mode === 'edit' && activeObj?.kind === 'mesh';
    this.edit.update(
      editing ? (activeObj as MeshObj).mesh : null,
      editing ? worldMatrix(scene, activeObj.id, s.time) : new Matrix4(),
      s.editSel,
      s.selectMode,
      s.overlays.xray,
    );

    this.updateGizmo(s);
    this.dirty = true;
  }

  private applyWorld(s: ViewState, final: boolean): void {
    const w = s.scene.world;
    const rot = (w.envRotation * Math.PI) / 180;
    const sc = this.scene;
    if (s.shading === 'rendered' || final) {
      const env = this.envs.get(w);
      sc.environment = env;
      sc.environmentIntensity = w.envIntensity;
      sc.environmentRotation.set(0, rot, 0);
      if (final && s.scene.render.transparent) sc.background = null;
      else if (w.background === 'color' || !env) sc.background = new Color(w.color);
      else {
        sc.background = env;
        sc.backgroundBlurriness = w.background === 'blur' ? 0.55 : 0;
        sc.backgroundIntensity = w.envIntensity;
        sc.backgroundRotation.set(0, rot, 0);
      }
    } else {
      sc.environment = this.envs.get({ ...w, env: 'studio' });
      sc.environmentIntensity = 1;
      sc.environmentRotation.set(0, 0, 0);
      sc.background = new Color(s.light ? '#c9ccd4' : '#3a3c43');
    }
  }

  /* ----------------------------------------------------------------- gizmo */

  private currentTargets(s: ViewState): TransformTargets | null {
    if (s.mode === 'edit') {
      if (!s.active || !s.editSel.verts.size) return null;
      return vertexTargets(s.scene, s.active, s.editSel.verts, s.time);
    }
    return objectTargets(s.scene, s.selected, s.active, s.time, s.autoKey, s.pivot);
  }

  private updateGizmo(s: ViewState): void {
    if (this.gizmoSession) return;
    const g = this.gizmo;
    const show = s.tool !== 'select' && !this.modal && !s.lookThrough;
    const t = show ? this.currentTargets(s) : null;
    if (!t) {
      if (g.object) g.detach();
      return;
    }
    this.proxy.position.copy(t.pivot);
    this.proxy.quaternion.copy(t.orient);
    this.proxy.scale.set(1, 1, 1);
    this.proxy.updateMatrixWorld(true);
    g.setMode(s.tool === 'move' ? 'translate' : s.tool === 'rotate' ? 'rotate' : 'scale');
    g.setSpace(s.orientation === 'local' ? 'local' : 'world');
    this.applyGizmoSnap();
    g.size = matchMedia('(pointer: coarse)').matches ? 1.25 : 0.95;
    if (g.object !== this.proxy) g.attach(this.proxy);
  }

  private applyGizmoSnap(): void {
    const s = this.state;
    if (!s) return;
    const on = s.snap.on !== this.ctrlHeld;
    this.gizmo.setTranslationSnap(on ? s.snap.move : null);
    this.gizmo.setRotationSnap(on ? (s.snap.rotate * Math.PI) / 180 : null);
    this.gizmo.setScaleSnap(on ? s.snap.scale : null);
  }

  private gizmoStart(): void {
    const s = this.state;
    if (!s) return;
    const targets = this.currentTargets(s);
    if (!targets) return;
    this.proxy.updateMatrixWorld(true);
    this.gizmoSession = {
      targets,
      start: this.proxy.matrixWorld.clone(),
      before: s.scene,
      current: s.scene,
    };
  }

  private gizmoMove(): void {
    const g = this.gizmoSession;
    if (!g) return;
    this.proxy.updateMatrixWorld(true);
    const delta = this.proxy.matrixWorld.clone().multiply(g.start.clone().invert());
    g.current = applyDelta(g.targets, delta);
    this.host.live(g.current);
  }

  private gizmoEnd(): void {
    const g = this.gizmoSession;
    this.gizmoSession = null;
    if (!g) return;
    const mode = this.gizmo.mode;
    if (g.current !== g.before)
      this.host.finish(
        mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale',
        g.before,
        g.current,
      );
    if (this.state) this.updateGizmo(this.state);
  }

  /* ----------------------------------------------------------- modal keys */

  /** Starts a G/R/S transform that follows the mouse. Returns false if nothing can move. */
  startModal(
    kind: ModalKind,
    opts: {
      before?: Scene3D;
      base?: Scene3D;
      label?: string;
      axis?: Vector3;
      axisName?: string;
      cancelTo?: 'before' | 'base';
      onCancel?: () => void;
    } = {},
  ): boolean {
    const s = this.state;
    if (!s || this.modal || this.gizmoSession) return false;
    const base = opts.base ?? s.scene;
    const targets = this.currentTargets({ ...s, scene: base });
    if (!targets) return false;
    const mouse = this.pointerInside
      ? this.pointer.clone()
      : new Vector2(this.size.x * 0.65, this.size.y * 0.5);
    const op = new ModalTransform(kind, targets, this.camera, this.size, mouse, s.snap, {
      axis: opts.axis,
      axisName: opts.axisName,
    });
    const label = opts.label ?? (kind === 'move' ? 'Move' : kind === 'rotate' ? 'Rotate' : 'Scale');
    this.modal = {
      op,
      before: opts.before ?? s.scene,
      base,
      label,
      current: base,
      cancelTo: opts.cancelTo ?? 'before',
      onCancel: opts.onCancel,
    };
    this.orbit.enabled = false;
    if (this.gizmo.object) this.gizmo.detach();
    this.el.classList.add('vp-modal');
    this.modalUpdate(op.preview());
    return true;
  }

  get modalActive(): boolean {
    return !!this.modal;
  }

  private modalUpdate(next: Scene3D): void {
    const m = this.modal!;
    m.current = next;
    this.host.live(next);
    this.host.status(m.op.status());
    const g = m.op.guide();
    this.guide.visible = !!g;
    if (g) {
      const a = g.origin.clone().addScaledVector(g.dir, -1000);
      const b = g.origin.clone().addScaledVector(g.dir, 1000);
      const pos = this.guide.geometry.getAttribute('position') as BufferAttribute;
      pos.setXYZ(0, a.x, a.y, a.z);
      pos.setXYZ(1, b.x, b.y, b.z);
      pos.needsUpdate = true;
      (this.guide.material as LineBasicMaterial).color.set(g.color);
    }
    this.dirty = true;
  }

  private endModal(confirm: boolean): void {
    const m = this.modal;
    if (!m) return;
    this.modal = null;
    this.guide.visible = false;
    this.orbit.enabled = true;
    this.el.classList.remove('vp-modal');
    this.host.status(null);
    if (confirm && m.current !== m.before) this.host.finish(m.label, m.before, m.current);
    else if (!confirm && m.cancelTo === 'base' && m.base !== m.before)
      this.host.finish(m.label, m.before, m.base);
    else {
      this.host.live(m.before);
      m.onCancel?.();
    }
    if (this.state) this.updateGizmo(this.state);
  }

  /** One-shot box selection (B key). */
  armBoxSelect(): void {
    this.boxOnce = true;
    this.el.classList.add('vp-boxing');
  }

  /* --------------------------------------------------------------- pointer */

  private local(e: PointerEvent | MouseEvent): Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new Vector2(e.clientX - r.left, e.clientY - r.top);
  }

  private inViewHelper(p: Vector2): boolean {
    if (this.state?.lookThrough) return false;
    const x0 = this.size.x - 128 - 12;
    return p.x >= x0 && p.x <= x0 + 128 && p.y >= 12 && p.y <= 140;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointer.copy(p);
    if (this.modal) {
      e.stopPropagation();
      e.preventDefault();
      this.endModal(e.button === 0);
      return;
    }
    if (this.gesture) return;
    const s = this.state;
    if (!s) return;
    if (e.button === 0 && this.inViewHelper(p)) {
      e.stopPropagation();
      this.gesture = {
        id: e.pointerId,
        button: 0,
        x: p.x,
        y: p.y,
        box: false,
        moved: false,
        shift: false,
        ctrl: false,
        viewHelper: true,
      };
      return;
    }
    if (this.gizmo.object && this.gizmo.enabled && e.button === 0) {
      // Let the gizmo claim the press (touch has no hover, so test it here).
      const tc = this.gizmo as unknown as {
        pointerHover(p: unknown): void;
        _getPointer(e: PointerEvent): unknown;
        axis: string | null;
      };
      tc.pointerHover(tc._getPointer(e));
      if (tc.axis) {
        this.orbit.enabled = false;
        return;
      }
    }
    const isMouse = e.pointerType === 'mouse';
    const wantBox =
      e.button === 0 &&
      !e.altKey &&
      (this.boxOnce ||
        s.tool === 'select' ||
        (s.mode === 'edit' && isMouse) ||
        (isMouse && (e.ctrlKey || e.metaKey)));
    if (wantBox) {
      e.stopPropagation();
      this.canvas.setPointerCapture?.(e.pointerId);
    }
    if (e.button === 1) {
      // Blender: middle mouse orbits, Shift+middle pans.
      this.orbit.mouseButtons.MIDDLE = e.shiftKey ? 2 : 0;
    }
    if (e.button === 0) this.orbit.mouseButtons.LEFT = 0;
    this.gesture = {
      id: e.pointerId,
      button: e.button,
      x: p.x,
      y: p.y,
      box: wantBox,
      moved: false,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      viewHelper: false,
    };
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointer.copy(p);
    if (this.modal) {
      this.modalUpdate(this.modal.op.pointer(p.x, p.y, e.ctrlKey || e.metaKey, e.shiftKey));
      return;
    }
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) > CLICK_SLOP) g.moved = true;
    if (g.box && g.moved) {
      const b = this.boxEl;
      b.hidden = false;
      b.style.left = `${Math.min(g.x, p.x)}px`;
      b.style.top = `${Math.min(g.y, p.y)}px`;
      b.style.width = `${Math.abs(p.x - g.x)}px`;
      b.style.height = `${Math.abs(p.y - g.y)}px`;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.modal) {
      // Touch-started modals still end with a tap; mouse ones end on pointerdown above.
      return;
    }
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) {
      if (!this.gizmoSession) this.orbit.enabled = true;
      return;
    }
    this.gesture = null;
    this.boxEl.hidden = true;
    if (!this.gizmoSession) this.orbit.enabled = true;
    const p = this.local(e);
    const how: SelectHow = g.shift ? (g.box ? 'add' : 'toggle') : g.ctrl ? 'remove' : 'set';
    if (g.viewHelper) {
      if (!g.moved && this.viewHelper.handleClick(e)) this.dirty = true;
      return;
    }
    if (g.box && g.moved) {
      this.boxOnce = false;
      this.el.classList.remove('vp-boxing');
      this.boxSelect(g.x, g.y, p.x, p.y, how);
      return;
    }
    if (g.moved) return;
    if (g.button === 2) {
      this.host.contextMenu(e.clientX, e.clientY);
      return;
    }
    if (g.button !== 0) return;
    if (this.boxOnce) {
      this.boxOnce = false;
      this.el.classList.remove('vp-boxing');
    }
    const now = performance.now();
    const dbl =
      now - this.lastClick.time < 350 &&
      Math.hypot(p.x - this.lastClick.x, p.y - this.lastClick.y) < 8;
    this.lastClick = { time: dbl ? 0 : now, x: p.x, y: p.y };
    this.clickSelect(p, how, dbl);
  };

  private onPointerCancel = (): void => {
    this.gesture = null;
    this.boxEl.hidden = true;
    if (!this.gizmoSession) this.orbit.enabled = true;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Control' || e.key === 'Meta') {
      this.ctrlHeld = true;
      this.applyGizmoSnap();
    }
    if (!this.modal) return;
    e.preventDefault();
    e.stopPropagation();
    const r = this.modal.op.key(e);
    if (r === 'confirm') this.endModal(true);
    else if (r === 'cancel') this.endModal(false);
    else if (r === 'update') this.modalUpdate(this.modal.op.preview());
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Control' || e.key === 'Meta') {
      this.ctrlHeld = false;
      this.applyGizmoSnap();
      if (this.modal && this.modal.op.keyUp(e)) this.modalUpdate(this.modal.op.preview());
    }
  };

  /* ------------------------------------------------------------- picking */

  private ndc(p: Vector2): Vector2 {
    return new Vector2((p.x / this.size.x) * 2 - 1, -(p.y / this.size.y) * 2 + 1);
  }

  /** The object under a canvas point (CSS px), if any. */
  objectAt(p: Vector2): ID | null {
    this.raycaster.setFromCamera(this.ndc(p), this.camera);
    const hits: Intersection[] = this.raycaster.intersectObject(this.sync.root, true);
    for (const h of hits) {
      const o = h.object;
      if (!(o as Mesh).isMesh || o.userData.overlay || !shown(o)) continue;
      for (let c: Object3D | null = o; c; c = c.parent) {
        const id = c.userData.objId as ID | undefined;
        if (id) {
          const obj = this.state?.scene.objects[id];
          if (obj && !obj.locked) return id;
          break;
        }
      }
    }
    return null;
  }

  /** The point on a surface (or the floor) under a canvas point: where new things go. */
  surfacePoint(p: Vector2): Vector3 {
    this.raycaster.setFromCamera(this.ndc(p), this.camera);
    const hits = this.raycaster
      .intersectObject(this.sync.root, true)
      .filter((h) => (h.object as Mesh).isMesh && !h.object.userData.pickOnly && shown(h.object));
    if (hits[0]) return hits[0].point.clone();
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) > 1e-4) {
      const t = -ray.origin.y / ray.direction.y;
      if (t > 0 && t < 500) return ray.at(t, new Vector3());
    }
    return this.orbit.target.clone().setY(0);
  }

  private clickSelect(p: Vector2, how: SelectHow, dbl: boolean): void {
    const s = this.state;
    if (!s) return;
    if (s.mode === 'edit') {
      const r = 10;
      const res = this.edit.pick(
        this.renderer,
        this.camera,
        { w: this.size.x, h: this.size.y },
        { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 },
        s.selectMode,
        s.overlays.xray,
      );
      if (res.nearest === null) {
        if (dbl) this.host.doubleClick(null);
        else if (how === 'set') this.host.selectElements(new Set(), 'set');
        return;
      }
      const id = s.selectMode === 'edge' ? this.edit.edgeKey(res.nearest) : res.nearest;
      this.host.selectElements(new Set([id]), how);
      if (dbl) this.host.doubleClick(s.active);
      return;
    }
    const id = this.objectAt(p);
    if (dbl) {
      this.host.doubleClick(id);
      return;
    }
    if (id) this.host.selectObjects([id], how);
    else if (how === 'set') this.host.selectObjects([], 'set');
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, how: SelectHow): void {
    const s = this.state;
    if (!s) return;
    const rect = {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0),
      h: Math.abs(y1 - y0),
    };
    if (s.mode === 'edit') {
      const res = this.edit.pick(
        this.renderer,
        this.camera,
        { w: this.size.x, h: this.size.y },
        rect,
        s.selectMode,
        s.overlays.xray,
      );
      const ids =
        s.selectMode === 'edge' ? new Set([...res.ids].map((i) => this.edit.edgeKey(i))) : res.ids;
      this.host.selectElements(ids, how);
      return;
    }
    const found: ID[] = [];
    const v = new Vector3();
    for (const id of s.scene.order) {
      const o = s.scene.objects[id]!;
      if (!o.visible || o.locked) continue;
      const b = sceneBounds(s.scene, [id], s.time);
      if (b) v.copy(b.min).add(b.max).multiplyScalar(0.5);
      else v.setFromMatrixPosition(worldMatrix(s.scene, id, s.time));
      const q = this.toScreen(v);
      if (q && q.x >= rect.x && q.x <= rect.x + rect.w && q.y >= rect.y && q.y <= rect.y + rect.h)
        found.push(id);
    }
    this.host.selectObjects(found, how);
  }

  /** Canvas position (CSS px) of a world point, or null when it's behind the camera. */
  toScreen(v: Vector3): Vector2 | null {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    return new Vector2(((p.x + 1) / 2) * this.size.x, ((1 - p.y) / 2) * this.size.y);
  }

  /* ------------------------------------------------------------ camera */

  /** Smoothly frames the given objects (or the whole scene). F / numpad period. */
  frame(ids?: readonly ID[]): void {
    const s = this.state;
    if (!s) return;
    let center: Vector3;
    let radius: number;
    if (s.mode === 'edit' && s.active && s.editSel.verts.size && !ids) {
      const t = vertexTargets(s.scene, s.active, s.editSel.verts, s.time);
      center = t?.pivot ?? new Vector3();
      radius = 1;
    } else {
      const b = sceneBounds(s.scene, ids && ids.length ? [...ids] : undefined, s.time);
      if (!b) return;
      center = b.min.clone().add(b.max).multiplyScalar(0.5);
      radius = Math.max(0.25, b.min.distanceTo(b.max) / 2);
    }
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    const dist = (radius / Math.sin((this.persp.fov * Math.PI) / 360)) * 1.15;
    this.flight = {
      from: this.orbit.target.clone(),
      to: center,
      fromPos: this.camera.position.clone(),
      toPos: center.clone().addScaledVector(dir, dist),
      t: 0,
    };
    if (this.camera === this.ortho) this.fitOrtho(radius * 1.3);
  }

  /** Looks along an axis (numpad 1/3/7 and Ctrl for the opposite side). */
  viewAxis(axis: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'): void {
    const d = this.camera.position.distanceTo(this.orbit.target);
    const dir = {
      front: new Vector3(0, 0, 1),
      back: new Vector3(0, 0, -1),
      right: new Vector3(1, 0, 0),
      left: new Vector3(-1, 0, 0),
      top: new Vector3(0, 1, 0.0001),
      bottom: new Vector3(0, -1, 0.0001),
    }[axis].normalize();
    this.flight = {
      from: this.orbit.target.clone(),
      to: this.orbit.target.clone(),
      fromPos: this.camera.position.clone(),
      toPos: this.orbit.target.clone().addScaledVector(dir, d),
      t: 0,
    };
  }

  /** Toggles orthographic (no perspective) view (numpad 5). */
  setOrtho(on: boolean): void {
    if (on === (this.camera === this.ortho)) return;
    const from = this.camera;
    const to = on ? this.ortho : this.persp;
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    if (on)
      this.fitOrtho(
        this.persp.position.distanceTo(this.orbit.target) *
          Math.tan((this.persp.fov * Math.PI) / 360),
      );
    this.camera = to;
    this.orbit.object = to;
    this.gizmo.camera = to;
    this.viewHelper.dispose();
    this.viewHelper = this.makeViewHelper();
    this.resize();
    this.orbit.update();
    this.dirty = true;
  }

  get isOrtho(): boolean {
    return this.camera === this.ortho;
  }

  private fitOrtho(halfHeight: number): void {
    const aspect = this.size.x / this.size.y;
    this.ortho.zoom = 1;
    this.ortho.top = halfHeight;
    this.ortho.bottom = -halfHeight;
    this.ortho.left = -halfHeight * aspect;
    this.ortho.right = halfHeight * aspect;
    this.ortho.updateProjectionMatrix();
  }

  /** The editor view as an object transform (for "camera to view"). */
  viewTransform(): Transform3 {
    this.camera.updateMatrixWorld();
    return transformOf(this.camera.matrixWorld);
  }

  viewTarget(): Vector3 {
    return this.orbit.target.clone();
  }

  /** Where the render frame sits on screen while looking through the camera (CSS px). */
  cameraFrame(): { x: number; y: number; w: number; h: number } | null {
    const s = this.state;
    if (!s?.lookThrough) return null;
    const aspect = s.scene.render.width / s.scene.render.height;
    const va = this.size.x / this.size.y;
    let w: number;
    let h: number;
    if (va > aspect) {
      h = this.size.y * FRAME_MARGIN;
      w = h * aspect;
    } else {
      w = this.size.x * FRAME_MARGIN;
      h = w / aspect;
    }
    return { x: (this.size.x - w) / 2, y: (this.size.y - h) / 2, w, h };
  }

  /** The camera used for drawing: the scene camera when looking through it. */
  private viewCamera(s: ViewState): PerspectiveCamera | OrthographicCamera {
    if (!s.lookThrough) return this.camera;
    const cam = this.renderCamera(s.scene);
    if (!cam) return this.camera;
    const c = cam.clone();
    const aspect = s.scene.render.width / s.scene.render.height;
    const va = this.size.x / this.size.y;
    // Fit the render frame inside the viewport with a margin (the passepartout shows outside).
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360) / FRAME_MARGIN;
    const fitTan = va > aspect ? tanHalf : (tanHalf * aspect) / va;
    c.fov = (Math.atan(fitTan) * 360) / Math.PI;
    c.aspect = va;
    c.updateProjectionMatrix();
    c.matrixWorld.copy(cam.matrixWorld);
    c.matrixWorldInverse.copy(cam.matrixWorld).invert();
    c.matrixAutoUpdate = false;
    c.matrixWorldAutoUpdate = false;
    return c;
  }

  private renderCamera(scene: Scene3D): PerspectiveCamera | null {
    const id =
      scene.render.camera && scene.objects[scene.render.camera]
        ? scene.render.camera
        : scene.order.find((i) => scene.objects[i]!.kind === 'camera');
    if (!id) return null;
    const root = this.sync.objectFor(id);
    let cam: PerspectiveCamera | null = null;
    root?.traverse((o) => {
      if (!cam && (o as PerspectiveCamera).isPerspectiveCamera) cam = o as PerspectiveCamera;
    });
    if (cam) (cam as PerspectiveCamera).updateMatrixWorld(true);
    return cam;
  }

  /* ------------------------------------------------------------- render */

  requestRender(): void {
    this.dirty = true;
  }

  private resize(): void {
    const r = this.el.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    this.size.set(w, h);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const halfH = (this.ortho.top - this.ortho.bottom) / 2;
    this.fitOrtho(halfH || 5);
    this.outline.setSize(w, h, this.pixelRatio);
    this.edit.setPixelRatio(this.pixelRatio);
    this.dirty = true;
    this.host.viewChanged?.();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / 0.28);
      const k = 1 - (1 - f.t) ** 3;
      this.orbit.target.lerpVectors(f.from, f.to, k);
      this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
      this.camera.lookAt(this.orbit.target);
      if (f.t >= 1) this.flight = null;
      this.dirty = true;
      this.host.viewChanged?.();
    }
    if (this.viewHelper.animating) {
      this.viewHelper.update(dt);
      this.dirty = true;
    }
    if (this.orbit.enabled && !this.flight && this.orbit.update(dt)) this.dirty = true;
    if (this.dirty && !this.rendering) {
      this.dirty = false;
      this.draw();
    }
  };

  private draw(): void {
    const s = this.state;
    const r = this.renderer;
    const cam = s ? this.viewCamera(s) : this.camera;
    this.grid.follow(cam, !!s?.light && s.shading !== 'rendered');
    const helper = this.gizmo.getHelper();
    helper.visible = false;
    r.autoClear = true;
    r.render(this.scene, cam);
    r.autoClear = false;
    if (s && s.mode === 'object' && !s.lookThrough) {
      const sel: Mesh[] = [];
      const act: Mesh[] = [];
      for (const id of s.selected) {
        const list = this.sync.meshesOf(id).filter((m) => !m.userData.pickOnly) as Mesh[];
        (id === s.active ? act : sel).push(...list);
      }
      this.outline.render(r, cam, sel, act);
    }
    if (this.gizmo.object) {
      helper.visible = true;
      r.clearDepth();
      r.render(helper, cam);
    }
    if (!s?.lookThrough) this.viewHelper.render(r);
    r.autoClear = true;
  }

  /**
   * Starts final-quality rendering through the scene camera (or the current view): no
   * grid, helpers or overlays, with tone mapping. Buffers are reused for every frame, so
   * a whole animation renders without allocations. Call `end()` when done.
   */
  beginRender(opts: {
    width: number;
    height: number;
    view?: boolean;
    samples?: number;
  }): RenderSession | null {
    const s = this.state;
    if (!s || this.rendering) return null;
    this.rendering = true;
    const W = Math.max(1, Math.round(opts.width));
    const H = Math.max(1, Math.round(opts.height));
    const hide = [this.grid, this.edit.group, this.guide, this.gizmo.getHelper()];
    const was = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const override = this.scene.overrideMaterial;
    this.scene.overrideMaterial = null;
    this.floor.visible = s.scene.world.floorShadow;
    this.applyWorld(s, true);
    const r = this.renderer;
    const prevRatio = r.getPixelRatio();
    const prevClear = r.getClearColor(new Color());
    const prevAlpha = r.getClearAlpha();
    const maxSamples = (r.capabilities as { maxSamples?: number }).maxSamples ?? 4;
    const hdr = new WebGLRenderTarget(W, H, {
      type: HalfFloatType,
      samples: Math.min(opts.samples ?? 8, maxSamples),
    });
    const out = new WebGLRenderTarget(W, H);
    const output = new OutputPass();
    const px = new Uint8Array(W * H * 4);
    const scene = s.scene;
    const camFor = (): PerspectiveCamera | OrthographicCamera => {
      const renderCam = opts.view ? null : this.renderCamera(scene);
      if (renderCam) {
        const c = renderCam.clone();
        c.aspect = W / H;
        c.updateProjectionMatrix();
        c.matrixWorld.copy(renderCam.matrixWorld);
        c.matrixWorldInverse.copy(renderCam.matrixWorld).invert();
        c.matrixAutoUpdate = false;
        c.matrixWorldAutoUpdate = false;
        return c;
      }
      if (this.camera === this.persp) {
        const c = this.persp.clone();
        c.aspect = W / H;
        c.updateProjectionMatrix();
        return c;
      }
      return this.ortho;
    };
    const frame = (time: number): ImageData => {
      this.sync.update(scene, { time, helpers: false, wire: false });
      const cam = camFor();
      r.setPixelRatio(1);
      r.setClearColor(0x000000, 0);
      r.autoClear = true;
      r.setRenderTarget(hdr);
      r.render(this.scene, cam);
      output.render(r, out, hdr, 0, false);
      r.readRenderTargetPixels(out, 0, 0, W, H, px);
      r.setRenderTarget(null);
      // WebGL rows run bottom-up.
      const img = new ImageData(W, H);
      const row = W * 4;
      for (let y = 0; y < H; y++)
        img.data.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
      return img;
    };
    const end = () => {
      hdr.dispose();
      out.dispose();
      output.dispose();
      r.setPixelRatio(prevRatio);
      r.setClearColor(prevClear, prevAlpha);
      hide.forEach((o, i) => (o.visible = was[i]!));
      this.scene.overrideMaterial = override;
      this.rendering = false;
      if (this.state) this.applyState(this.state);
    };
    return { width: W, height: H, frame, end };
  }

  /** One final-quality picture. */
  renderImage(opts: {
    width: number;
    height: number;
    view?: boolean;
    time?: number;
    samples?: number;
  }): ImageData | null {
    const session = this.beginRender(opts);
    if (!session) return null;
    try {
      return session.frame(opts.time ?? this.state!.time);
    } finally {
      session.end();
    }
  }

  /** A small picture of the current view (project cards on the home screen). */
  async cover(): Promise<Blob | null> {
    const img = this.renderImage({ width: 480, height: 300, view: true, samples: 4 });
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.82));
  }

  /** Animation clips of an imported model (once it has loaded). */
  clipNames(id: ID): string[] {
    return this.sync.clipsOf(id).map((c) => c.name);
  }

  /** World matrix → screen for UI overlays (e.g. labels). */
  project(v: Vector3): Vector2 | null {
    return this.toScreen(v);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.el.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.el.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp, { capture: true });
    window.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.viewHelper.dispose();
    this.sync.dispose();
    this.envs.dispose();
    this.edit.dispose();
    this.outline.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.boxEl.remove();
  }
}

const FRAME_MARGIN = 0.86;

export interface RenderSession {
  width: number;
  height: number;
  /** Renders the scene at `time` (seconds). */
  frame(time: number): ImageData;
  end(): void;
}

function shown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Re-exported so the UI can build selections without importing model internals. */
export { emptySelection, Quaternion };
