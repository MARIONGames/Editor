/**
 * Blender-style modal transforms: press G (move), R (rotate) or S (scale), move the
 * mouse, optionally press X/Y/Z to lock an axis (twice = the object's own axis, Shift =
 * everything except that axis), type an exact number, hold Ctrl to snap and Shift for
 * fine control, then click or Enter to finish, right-click or Esc to cancel.
 */
import { Plane, Quaternion, Raycaster, Vector2, Vector3, type Camera } from 'three';
import { applyDelta, moveDelta, rotateDelta, scaleDelta, type TransformTargets } from './transform';
import type { Scene3D } from '../model/types';

export type ModalKind = 'move' | 'rotate' | 'scale';

export interface SnapSettings {
  on: boolean;
  move: number;
  /** Degrees. */
  rotate: number;
  scale: number;
}

interface Constraint {
  /** 0 = X, 1 = Y, 2 = Z, -1 = custom direction. */
  index: number;
  local: boolean;
  /** Lock everything except this axis (a plane). */
  plane: boolean;
  custom?: Vector3;
  name?: string;
}

const AXIS_NAMES = ['X', 'Y', 'Z'];
export const AXIS_COLORS = ['#e2475c', '#5bc24f', '#3d8bff'];
const UNIT = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];

export class ModalTransform {
  readonly kind: ModalKind;
  readonly targets: TransformTargets;
  private camera: Camera;
  private size: Vector2;
  private snap: SnapSettings;
  private start: Vector2;
  /** Mouse position with Shift slow-down applied. */
  private virtual: Vector2;
  private last: Vector2;
  private constraint: Constraint | null = null;
  private numeric = '';
  private angle = 0;
  private lastAngle = 0;
  private snapHeld = false;
  private value = { move: new Vector3(), angle: 0, scale: 1 };

  constructor(
    kind: ModalKind,
    targets: TransformTargets,
    camera: Camera,
    size: Vector2,
    mouse: Vector2,
    snap: SnapSettings,
    opts: { axis?: Vector3; axisName?: string } = {},
  ) {
    this.kind = kind;
    this.targets = targets;
    this.camera = camera;
    this.size = size.clone();
    this.snap = snap;
    this.start = mouse.clone();
    this.virtual = mouse.clone();
    this.last = mouse.clone();
    if (opts.axis)
      this.constraint = {
        index: -1,
        local: false,
        plane: false,
        custom: opts.axis.clone().normalize(),
        name: opts.axisName ?? 'normal',
      };
    const s = this.toScreen(targets.pivot);
    this.lastAngle = Math.atan2(mouse.y - s.y, mouse.x - s.x);
  }

  /* ------------------------------------------------------------- input */

  pointer(x: number, y: number, ctrl: boolean, shift: boolean): Scene3D {
    const p = new Vector2(x, y);
    const step = p
      .clone()
      .sub(this.last)
      .multiplyScalar(shift ? 0.1 : 1);
    this.last = p;
    this.virtual.add(step);
    this.snapHeld = ctrl;
    if (this.kind === 'rotate') {
      const s = this.toScreen(this.targets.pivot);
      const a = Math.atan2(this.virtual.y - s.y, this.virtual.x - s.x);
      let d = a - this.lastAngle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.angle += d;
      this.lastAngle = a;
    }
    return this.preview();
  }

  /** Handles a key; returns what the viewport should do next. */
  key(e: KeyboardEvent): 'confirm' | 'cancel' | 'update' | null {
    const k = e.key;
    if (k === 'Enter' || k === ' ') return 'confirm';
    if (k === 'Escape') return 'cancel';
    const lower = k.toLowerCase();
    if (lower === 'x' || lower === 'y' || lower === 'z') {
      this.setAxis('xyz'.indexOf(lower), e.shiftKey);
      return 'update';
    }
    if (/^[0-9.]$/.test(k)) {
      this.numeric += k;
      return 'update';
    }
    if (k === '-') {
      this.numeric = this.numeric.startsWith('-') ? this.numeric.slice(1) : `-${this.numeric}`;
      return 'update';
    }
    if (k === 'Backspace') {
      this.numeric = this.numeric.slice(0, -1);
      return 'update';
    }
    if (k === 'Control' || k === 'Meta') {
      this.snapHeld = true;
      return 'update';
    }
    return null;
  }

  keyUp(e: KeyboardEvent): boolean {
    if (e.key === 'Control' || e.key === 'Meta') {
      this.snapHeld = false;
      return true;
    }
    return false;
  }

  private setAxis(index: number, plane: boolean): void {
    const c = this.constraint;
    if (!c || c.index !== index || c.plane !== plane)
      this.constraint = { index, local: false, plane };
    else if (!c.local) this.constraint = { index, local: true, plane };
    else this.constraint = null;
  }

  /* ------------------------------------------------------------ result */

  preview(): Scene3D {
    return applyDelta(this.targets, this.delta());
  }

  private snapping(): boolean {
    return this.snap.on !== this.snapHeld;
  }

  private numericValue(): number | null {
    if (!this.numeric || this.numeric === '-' || this.numeric === '.') return null;
    const v = Number.parseFloat(this.numeric);
    return Number.isFinite(v) ? v : null;
  }

  private axisVector(c: Constraint): Vector3 {
    if (c.custom) return c.custom.clone();
    const v = UNIT[c.index]!.clone();
    return c.local ? v.applyQuaternion(this.targets.orient) : v;
  }

  private delta() {
    const t = this.targets;
    const num = this.numericValue();
    const c = this.constraint;
    if (this.kind === 'move') {
      let d: Vector3;
      if (num !== null) {
        d =
          c && !c.plane
            ? this.axisVector(c).multiplyScalar(num)
            : (c ? this.planeAxis(c) : UNIT[0]!.clone()).multiplyScalar(num);
      } else {
        d = this.mouseMove();
        if (this.snapping()) {
          const st = this.snap.move;
          if (c && !c.plane) {
            const a = this.axisVector(c);
            d = a.multiplyScalar(Math.round(d.dot(this.axisVector(c)) / st) * st);
          } else
            d.set(Math.round(d.x / st) * st, Math.round(d.y / st) * st, Math.round(d.z / st) * st);
        }
      }
      this.value.move = d;
      return moveDelta(d);
    }
    if (this.kind === 'rotate') {
      let angle: number;
      let axis: Vector3;
      const fwd = this.camera.getWorldDirection(new Vector3());
      if (c && !c.plane) {
        axis = this.axisVector(c);
        angle = axis.dot(fwd) >= 0 ? this.angle : -this.angle;
      } else {
        axis = c ? this.axisVector(c) : fwd;
        angle = this.angle;
      }
      if (num !== null) angle = (num * Math.PI) / 180;
      else if (this.snapping()) {
        const st = (this.snap.rotate * Math.PI) / 180;
        angle = Math.round(angle / st) * st;
      }
      this.value.angle = angle;
      return rotateDelta(t.pivot, axis, angle);
    }
    // Scale
    const s = this.toScreen(t.pivot);
    const d0 = Math.max(4, this.start.distanceTo(s));
    let f = num ?? this.virtual.distanceTo(s) / d0;
    if (num === null && this.snapping()) f = Math.round(f / this.snap.scale) * this.snap.scale;
    this.value.scale = f;
    const orient = c?.local || c?.custom ? t.orient : new Quaternion();
    let v = new Vector3(f, f, f);
    if (c && c.index >= 0) {
      v = c.plane
        ? new Vector3(f, f, f).setComponent(c.index, 1)
        : new Vector3(1, 1, 1).setComponent(c.index, f);
    }
    return scaleDelta(t.pivot, orient, v);
  }

  /** For a plane lock with a typed number, move along the first free axis. */
  private planeAxis(c: Constraint): Vector3 {
    const free = [0, 1, 2].find((i) => i !== c.index)!;
    const v = UNIT[free]!.clone();
    return c.local ? v.applyQuaternion(this.targets.orient) : v;
  }

  private mouseMove(): Vector3 {
    const pivot = this.targets.pivot;
    const r0 = this.ray(this.start);
    const r1 = this.ray(this.virtual);
    const c = this.constraint;
    if (c && !c.plane) {
      const a = this.axisVector(c);
      const s0 = closestOnLine(pivot, a, r0.origin, r0.direction);
      const s1 = closestOnLine(pivot, a, r1.origin, r1.direction);
      if (s0 === null || s1 === null) return new Vector3();
      return a.multiplyScalar(s1 - s0);
    }
    const normal = c ? this.axisVector(c) : this.camera.getWorldDirection(new Vector3());
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, pivot);
    const h0 = r0.intersectPlane(plane, new Vector3());
    const h1 = r1.intersectPlane(plane, new Vector3());
    if (!h0 || !h1) return new Vector3();
    return h1.sub(h0);
  }

  private ray(p: Vector2) {
    const rc = new Raycaster();
    rc.setFromCamera(
      new Vector2((p.x / this.size.x) * 2 - 1, -(p.y / this.size.y) * 2 + 1),
      this.camera,
    );
    return rc.ray;
  }

  private toScreen(v: Vector3): Vector2 {
    const p = v.clone().project(this.camera);
    return new Vector2(((p.x + 1) / 2) * this.size.x, ((1 - p.y) / 2) * this.size.y);
  }

  /* ---------------------------------------------------------- feedback */

  /** The axis line to draw while an axis is locked. */
  guide(): { origin: Vector3; dir: Vector3; color: string } | null {
    const c = this.constraint;
    if (!c || c.plane) return null;
    return {
      origin: this.targets.pivot.clone(),
      dir: this.axisVector(c),
      color: c.index >= 0 ? AXIS_COLORS[c.index]! : '#f5a524',
    };
  }

  status(): string {
    const c = this.constraint;
    const axis = c
      ? c.custom
        ? ` along ${c.name}`
        : `${c.plane ? ' except ' : ' along '}${AXIS_NAMES[c.index]}${c.local ? ' (local)' : ''}`
      : '';
    const typed = this.numeric ? ` [${this.numeric}]` : '';
    const v = this.value;
    let main: string;
    if (this.kind === 'move') {
      main =
        c && !c.plane
          ? `Move ${fmt(v.move.length() * Math.sign(v.move.dot(this.axisVector(c)) || 1))} m${axis}`
          : `Move ${fmt(v.move.x)}, ${fmt(v.move.y)}, ${fmt(v.move.z)} m${axis}`;
    } else if (this.kind === 'rotate') main = `Rotate ${fmt((v.angle * 180) / Math.PI, 1)}°${axis}`;
    else main = `Scale ×${fmt(v.scale)}${axis}`;
    return `${main}${typed}`;
  }
}

/** Parameter s of the point on line (p + s·a) closest to the ray (o + t·d). */
function closestOnLine(p: Vector3, a: Vector3, o: Vector3, d: Vector3): number | null {
  const w0 = p.clone().sub(o);
  const b = a.dot(d);
  const denom = a.lengthSq() * d.lengthSq() - b * b;
  if (Math.abs(denom) < 1e-8) return null;
  return (b * d.dot(w0) - d.lengthSq() * a.dot(w0)) / denom;
}

function fmt(x: number, digits = 3): string {
  const v = Math.abs(x) < 1e-9 ? 0 : x;
  return v.toFixed(digits).replace(/\.?0+$/, '') || '0';
}
