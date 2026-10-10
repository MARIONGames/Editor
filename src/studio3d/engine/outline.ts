/**
 * Selection outline: selected meshes are drawn as flat colors into a mask, then a
 * full-screen pass draws an orange line just outside their silhouettes (lighter for the
 * active object). Cheaper than a general post-processing chain and it keeps the
 * viewport's tone mapping untouched.
 */
import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Mesh,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export class SelectionOutline {
  private mask = new WebGLRenderTarget(1, 1);
  private selMat = new MeshBasicMaterial({ color: new Color(1, 0, 0), side: DoubleSide });
  private activeMat = new MeshBasicMaterial({ color: new Color(0, 0, 1), side: DoubleSide });
  private quad: FullScreenQuad;
  private material: ShaderMaterial;

  constructor() {
    for (const m of [this.selMat, this.activeMat]) m.toneMapped = false;
    this.material = new ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tMask: { value: this.mask.texture },
        uTexel: { value: new Vector2(1, 1) },
        uRadius: { value: 2 },
        uSel: { value: new Color('#ff9f1a') },
        uActive: { value: new Color('#ffd27a') },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMask;
        uniform vec2 uTexel;
        uniform float uRadius;
        uniform vec3 uSel;
        uniform vec3 uActive;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tMask, vUv);
          if (c.r + c.b > 0.0) discard;
          float sel = 0.0;
          float act = 0.0;
          for (int x = -2; x <= 2; x++) {
            for (int y = -2; y <= 2; y++) {
              vec2 o = vec2(float(x), float(y));
              if (dot(o, o) > 5.0) continue;
              vec4 s = texture2D(tMask, vUv + o * uTexel * uRadius * 0.5);
              sel = max(sel, s.r);
              act = max(act, s.b);
            }
          }
          if (sel + act <= 0.0) discard;
          gl_FragColor = vec4(act > 0.0 ? uActive : uSel, 1.0);
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    const W = Math.max(1, Math.round(w * pixelRatio));
    const H = Math.max(1, Math.round(h * pixelRatio));
    this.mask.setSize(W, H);
    (this.material.uniforms.uTexel!.value as Vector2).set(1 / W, 1 / H);
    this.material.uniforms.uRadius!.value = Math.max(1.5, 1.5 * pixelRatio);
  }

  /** Draws the outline on top of what is already on screen. */
  render(renderer: WebGLRenderer, camera: Camera, selected: Mesh[], active: Mesh[]): void {
    if (!selected.length && !active.length) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevClear = renderer.getClearColor(new Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.autoClear = false;
    const draw = (meshes: Mesh[], mat: Material) => {
      for (const m of meshes) {
        if (!shown(m)) continue;
        const keep = m.material;
        m.material = mat;
        renderer.render(m, camera);
        m.material = keep;
      }
    };
    draw(selected, this.selMat);
    draw(active, this.activeMat);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    this.quad.render(renderer);
    renderer.autoClear = prevAuto;
  }

  dispose(): void {
    this.mask.dispose();
    this.selMat.dispose();
    this.activeMat.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

function shown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
