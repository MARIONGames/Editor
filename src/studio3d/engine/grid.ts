/**
 * The floor grid: an "infinite" plane drawn by a shader, with 10 cm / 1 m / 10 m lines
 * that fade in and out with zoom and the X (red) and Z (blue) axes through the origin.
 */
import { Color, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, type Camera } from 'three';

const SIZE = 4000;

export class FloorGrid extends Mesh<PlaneGeometry, ShaderMaterial> {
  constructor() {
    const geo = new PlaneGeometry(SIZE, SIZE);
    geo.rotateX(-Math.PI / 2);
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(0.6, 0.6, 0.65) },
        uAxisX: { value: new Color('#e2475c') },
        uAxisZ: { value: new Color('#3d8bff') },
        uOpacity: { value: 0.55 },
        uFade: { value: 60 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uAxisX;
        uniform vec3 uAxisZ;
        uniform float uOpacity;
        uniform float uFade;
        varying vec3 vWorld;

        // Anti-aliased grid lines; cells smaller than a few pixels fade away.
        float grid(vec2 p, float size) {
          vec2 c = p / size;
          vec2 d = fwidth(c);
          vec2 g = abs(fract(c - 0.5) - 0.5) / max(d, vec2(1e-6));
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float density = max(d.x, d.y);
          return line * (1.0 - smoothstep(0.05, 0.25, density));
        }

        float axis(float x) {
          float d = fwidth(x);
          return 1.0 - min(abs(x) / max(d * 1.5, 1e-6), 1.0);
        }

        void main() {
          vec2 p = vWorld.xz;
          float a = max(max(grid(p, 0.1) * 0.35, grid(p, 1.0) * 0.7), grid(p, 10.0));
          float dist = length(vWorld - cameraPosition);
          float fade = 1.0 - smoothstep(uFade * 0.35, uFade, dist);
          vec3 col = uColor;
          float ax = axis(p.y);
          float az = axis(p.x);
          if (ax > 0.0 || az > 0.0) {
            col = ax > az ? uAxisX : uAxisZ;
            a = max(a, max(ax, az));
          }
          float alpha = a * fade * uOpacity;
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    mat.allowOverride = false;
    super(geo, mat);
    this.name = 'kinora-grid';
    this.renderOrder = -1;
    this.frustumCulled = false;
    this.userData.overlay = true;
    this.raycast = () => {};
  }

  /** Follows the camera so the grid never ends; fades further out the higher you are. */
  follow(camera: Camera, light: boolean): void {
    const p = camera.position;
    this.position.set(Math.round(p.x / 10) * 10, 0, Math.round(p.z / 10) * 10);
    const u = this.material.uniforms;
    u.uFade!.value = Math.max(40, Math.abs(p.y) * 25, p.length() * 3);
    (u.uColor!.value as Color).set(light ? '#5a5d6a' : '#a3a6b4');
    u.uOpacity!.value = light ? 0.5 : 0.45;
  }
}
