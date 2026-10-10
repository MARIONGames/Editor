/**
 * Image-based lighting. Presets are generated (no downloads, works offline); any HDR or
 * EXR panorama can be used too.
 */
import {
  BackSide,
  Color,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  type DataTextureLoaderTexData,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getBlob } from '../../engine/media/mediaStore';
import type { EnvPreset, Scene3D } from '../model/types';

interface Sky {
  top: string;
  horizon: string;
  bottom: string;
  sun?: { color: string; strength: number; dir: [number, number, number]; size: number };
}

const SKIES: Record<Exclude<EnvPreset, 'studio' | 'hdri' | 'none'>, Sky> = {
  sunset: {
    top: '#2b3a67',
    horizon: '#ff9e6d',
    bottom: '#3a2a2a',
    sun: { color: '#ffb36b', strength: 40, dir: [0.8, 0.12, -0.6], size: 0.06 },
  },
  overcast: { top: '#c9d1dc', horizon: '#e6e9ee', bottom: '#5b5e63' },
  night: {
    top: '#03050d',
    horizon: '#14203d',
    bottom: '#050505',
    sun: { color: '#b7c9ff', strength: 8, dir: [-0.4, 0.6, 0.5], size: 0.03 },
  },
};

function skyScene(sky: Sky): Scene {
  const s = new Scene();
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color(sky.top) },
      horizon: { value: new Color(sky.horizon) },
      bottom: { value: new Color(sky.bottom) },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon, bottom, pow(-y, 0.4));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  s.add(new Mesh(new SphereGeometry(50, 32, 16), mat));
  if (sky.sun) {
    const sun = new Mesh(
      new SphereGeometry(50 * sky.sun.size, 16, 8),
      new MeshBasicMaterial({ color: new Color(sky.sun.color).multiplyScalar(sky.sun.strength) }),
    );
    const [x, y, z] = sky.sun.dir;
    const l = Math.hypot(x, y, z);
    sun.position.set((x / l) * 45, (y / l) * 45, (z / l) * 45);
    s.add(sun);
  }
  return s;
}

export class Environments {
  private pmrem: PMREMGenerator;
  private cache = new Map<string, Texture>();
  private loading = new Set<string>();
  onLoaded: (() => void) | null = null;

  constructor(renderer: WebGLRenderer) {
    this.pmrem = new PMREMGenerator(renderer);
  }

  /** The lighting texture for a world (null = none / still loading). */
  get(world: Scene3D['world']): Texture | null {
    const key = world.env === 'hdri' ? `hdri:${world.hdri}` : world.env;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (world.env === 'none') return null;
    if (world.env === 'studio') {
      const room = new RoomEnvironment();
      const tex = this.pmrem.fromScene(room, 0.04).texture;
      this.cache.set(key, tex);
      return tex;
    }
    if (world.env === 'hdri') {
      if (world.hdri && !this.loading.has(key)) {
        this.loading.add(key);
        void this.loadHdri(world.hdri).then((tex) => {
          if (tex) {
            this.cache.set(key, tex);
            this.onLoaded?.();
          }
        });
      }
      return this.cache.get('studio') ?? this.get({ ...world, env: 'studio' });
    }
    const tex = this.pmrem.fromScene(skyScene(SKIES[world.env]), 0.02).texture;
    this.cache.set(key, tex);
    return tex;
  }

  private async loadHdri(assetId: string): Promise<Texture | null> {
    const blob = await getBlob(assetId);
    if (!blob) return null;
    const data = await blob.arrayBuffer();
    const isExr = new Uint8Array(data, 0, 4).join(',') === '118,47,49,1';
    try {
      let tex: Texture;
      if (isExr) {
        const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
        const parsed = new EXRLoader().parse(data);
        tex = dataTexture(parsed);
      } else {
        const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
        const parsed = new HDRLoader().parse(data);
        tex = dataTexture(parsed);
      }
      tex.mapping = EquirectangularReflectionMapping;
      const env = this.pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
      return env;
    } catch (err) {
      console.error('HDRI failed to load', err);
      return null;
    }
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.pmrem.dispose();
  }
}

function dataTexture(p: DataTextureLoaderTexData): DataTexture {
  const t = new DataTexture(
    p.data as Uint16Array,
    p.width,
    p.height,
    RGBAFormat,
    p.type === FloatType ? FloatType : HalfFloatType,
  );
  t.minFilter = t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.flipY = true;
  t.needsUpdate = true;
  return t;
}
