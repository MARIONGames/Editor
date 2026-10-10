/**
 * Getting work out of the 3D studio: pictures and videos rendered through the scene
 * camera, and model files for game engines (GLB/glTF), 3D printing (STL), AR on
 * iPhone (USDZ) and everything else (OBJ).
 */
import {
  AnimationClip,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Euler,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  QuaternionKeyframeTrack,
  SpotLight,
  Texture,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  VectorKeyframeTrack,
  type Material,
} from 'three';
import { getBlob } from '../../engine/media/mediaStore';
import {
  canUseWebCodecs,
  ExportCancelled,
  type ExportResult,
  type ProgressFn,
} from '../../engine/export/videoExport';
import { transformAt } from '../model/animation';
import { buildDisplay } from '../model/display';
import { evaluate } from '../model/modifiers';
import type { ID, Material3D, Obj3D, Scene3D } from '../model/types';
import { applyMaterial } from '../engine/sync';
import { loadModel } from '../engine/models';
import type { Viewport } from '../engine/viewport';

/* --------------------------------------------------------------- pictures */

export async function renderPicture(
  vp: Viewport,
  scene: Scene3D,
  opts: { scale: number; format: 'png' | 'jpeg'; time: number },
): Promise<Blob> {
  const W = Math.round(scene.render.width * opts.scale);
  const H = Math.round(scene.render.height * opts.scale);
  const img = vp.renderImage({ width: W, height: H, time: opts.time });
  if (!img) throw new Error('Nothing to render yet.');
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  if (opts.format === 'jpeg') {
    // JPEG has no transparency: put a background behind.
    ctx.fillStyle = scene.world.background === 'color' ? scene.world.color : '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  } else ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) =>
    c.toBlob(res, opts.format === 'png' ? 'image/png' : 'image/jpeg', 0.93),
  );
  if (!blob) throw new Error('Could not make the picture.');
  return blob;
}

/* ----------------------------------------------------------------- video */

const yieldToPage = () => new Promise<void>((r) => setTimeout(r, 0));

export async function renderVideo(
  vp: Viewport,
  scene: Scene3D,
  opts: { format: 'mp4' | 'webm'; bitrate: number; scale: number },
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<ExportResult> {
  const fps = scene.render.fps;
  const W = even(scene.render.width * opts.scale);
  const H = even(scene.render.height * opts.scale);
  const start = scene.anim.start;
  const frames = Math.max(1, Math.round((scene.anim.end - start) * fps));
  const mb = canUseWebCodecs() ? await import('mediabunny').catch(() => null) : null;
  if (!mb) return recordFallback(vp, { W, H, fps, start, frames }, onProgress, signal);
  const quality = new mb.Quality({ bitrate: opts.bitrate });
  let chosen: { format: 'mp4' | 'webm'; codec: import('mediabunny').VideoCodec } | null = null;
  for (const f of opts.format === 'mp4' ? (['mp4', 'webm'] as const) : (['webm', 'mp4'] as const)) {
    const codec = await mb.getFirstEncodableVideoCodec(
      f === 'mp4' ? ['avc', 'vp9', 'av1', 'hevc'] : ['vp9', 'vp8', 'av1'],
      { width: W, height: H, quality, frameRate: fps },
    );
    if (codec) {
      chosen = { format: f, codec };
      break;
    }
  }
  if (!chosen) return recordFallback(vp, { W, H, fps, start, frames }, onProgress, signal);
  const target = new mb.BufferTarget();
  const output = new mb.Output({
    format:
      chosen.format === 'mp4'
        ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' })
        : new mb.WebMOutputFormat(),
    target,
  });
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const source = new mb.CanvasSource(canvas, {
    codec: chosen.codec,
    quality,
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(source, { frameRate: fps });
  const session = vp.beginRender({ width: W, height: H, samples: 4 });
  if (!session) throw new Error('A render is already running.');
  try {
    await output.start();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new ExportCancelled();
      ctx.putImageData(session.frame(start + i / fps), 0, 0);
      await source.add(i / fps, 1 / fps);
      if (i % 2 === 0) {
        const done = (i + 1) / frames;
        const el = (performance.now() - t0) / 1000;
        const left = done > 0.05 ? (el / done) * (1 - done) : NaN;
        onProgress(
          done * 0.97,
          Number.isFinite(left)
            ? `Rendering frame ${i + 1} of ${frames} — about ${Math.ceil(left)} s left`
            : `Rendering frame ${i + 1} of ${frames}…`,
        );
        await yieldToPage();
      }
    }
    source.close();
    onProgress(0.98, 'Finishing up…');
    await output.finalize();
    const mime = chosen.format === 'mp4' ? 'video/mp4' : 'video/webm';
    onProgress(1, 'Done!');
    return {
      blob: new Blob([target.buffer!], { type: mime }),
      mime,
      ext: chosen.format,
      details: `${chosen.format.toUpperCase()} · ${W}×${H} · ${fps} fps`,
    };
  } catch (err) {
    if (output.state === 'started' || output.state === 'pending')
      await output.cancel().catch(() => undefined);
    throw err;
  } finally {
    session.end();
  }
}

function even(x: number): number {
  return Math.max(2, Math.round(x / 2) * 2);
}

/** Browsers without WebCodecs: record a canvas in real time. */
async function recordFallback(
  vp: Viewport,
  o: { W: number; H: number; fps: number; start: number; frames: number },
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<ExportResult> {
  if (typeof MediaRecorder === 'undefined')
    throw new Error('This browser can’t make videos. Try Chrome, Edge or Safari 17+.');
  const canvas = document.createElement('canvas');
  canvas.width = o.W;
  canvas.height = o.H;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(o.fps);
  const mime =
    ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    ) ?? 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const session = vp.beginRender({ width: o.W, height: o.H, samples: 4 });
  if (!session) throw new Error('A render is already running.');
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
  rec.start();
  try {
    for (let i = 0; i < o.frames; i++) {
      if (signal.aborted) throw new ExportCancelled();
      const t = performance.now();
      ctx.putImageData(session.frame(o.start + i / o.fps), 0, 0);
      onProgress((i + 1) / o.frames, `Recording frame ${i + 1} of ${o.frames}…`);
      await new Promise((r) => setTimeout(r, Math.max(0, 1000 / o.fps - (performance.now() - t))));
    }
  } finally {
    rec.stop();
    session.end();
  }
  await stopped;
  const type = mime.split(';')[0]!;
  return {
    blob: new Blob(chunks, { type }),
    mime: type,
    ext: type === 'video/mp4' ? 'mp4' : 'webm',
    details: 'Recorded in real time',
  };
}

/* ---------------------------------------------------------------- models */

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'usdz';

export interface ModelExportOptions {
  format: ModelFormat;
  /** Only the selected objects (and their children). */
  only?: ID[];
  animations: boolean;
  /** STL: millimeters with Z up, the way slicers expect. */
  forPrinting?: boolean;
}

async function loadTexture(scene: Scene3D, id: ID, color: boolean): Promise<Texture | null> {
  const ref = scene.textures[id];
  const blob = ref ? await getBlob(ref.assetId) : undefined;
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const t = new Texture(bmp as unknown as HTMLImageElement);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Builds a clean three.js scene (no editor helpers) for the exporters. */
async function buildExportScene(
  scene: Scene3D,
  opts: ModelExportOptions,
): Promise<{ root: Group; clips: AnimationClip[]; skipped: string[] }> {
  const time = scene.anim.start;
  const keep = new Set<ID>();
  if (opts.only?.length) {
    const add = (id: ID) => {
      keep.add(id);
      for (const c of scene.order) if (scene.objects[c]?.parent === id) add(c);
    };
    opts.only.forEach(add);
  } else scene.order.forEach((id) => keep.add(id));
  const meshesOnly = opts.format === 'stl' || opts.format === 'obj';
  const skipped: string[] = [];

  // Materials (with their texture images).
  const textures = new Map<ID, Texture | null>();
  const wanted = new Set<ID>();
  for (const id of keep) {
    const o = scene.objects[id];
    if (o?.kind === 'mesh') for (const m of o.materials) wanted.add(m);
  }
  const mats = new Map<ID, Material>();
  if (!meshesOnly) {
    for (const mid of wanted) {
      const m = scene.materials[mid];
      if (!m) continue;
      for (const [slot, tid] of Object.entries(m.maps) as [keyof Material3D['maps'], ID][]) {
        if (!textures.has(tid))
          textures.set(tid, await loadTexture(scene, tid, slot === 'color' || slot === 'emissive'));
      }
      const mat = new MeshPhysicalMaterial();
      applyMaterial(mat, m, (_slot, tid) => textures.get(tid) ?? null);
      mats.set(mid, mat);
    }
  }
  const fallback = new MeshPhysicalMaterial({ color: 0xc8c8cc, roughness: 0.5 });

  const root = new Group();
  root.name = scene.name;
  const nodes = new Map<ID, Object3D>();
  const used = new Set<string>();
  const nameOf = (o: Obj3D) => {
    let n = o.name || o.kind;
    for (let i = 2; used.has(n); i++) n = `${o.name} ${i}`;
    used.add(n);
    return n;
  };
  const ownTracks: AnimationClip['tracks'] = [];
  const modelClips: AnimationClip[] = [];
  for (const id of scene.order) {
    if (!keep.has(id)) continue;
    const o = scene.objects[id]!;
    if (!o.visible) continue;
    let node: Object3D | null = null;
    if (o.kind === 'mesh') {
      const d = buildDisplay(evaluate(o.mesh, o.modifiers), o.shade, o.smoothAngle);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(d.position, 3));
      g.setAttribute('normal', new BufferAttribute(d.normal, 3));
      g.setAttribute('uv', new BufferAttribute(d.uv, 2));
      g.setIndex(new BufferAttribute(d.index, 1));
      const slots = o.materials.length ? o.materials : [''];
      for (const gr of d.groups)
        g.addGroup(gr.start, gr.count, Math.min(gr.slot, slots.length - 1));
      const list = slots.map((m) => mats.get(m) ?? fallback);
      node = new Mesh(g, list.length === 1 ? list[0] : list);
    } else if (o.kind === 'model') {
      const loaded = await loadModel(o.assetId, scene.assets[o.assetId]?.name ?? 'model.glb');
      if (loaded) {
        node = loaded.object;
        if (opts.animations) {
          const clip = loaded.clips.find((c) => c.name === o.clip.name);
          if (clip) modelClips.push(clip);
        }
      }
    } else if (meshesOnly) {
      continue;
    } else if (o.kind === 'light') {
      const L = o.light;
      if (L.type === 'area') {
        skipped.push(`${o.name} (soft box lights don’t exist in glTF)`);
        node = new Object3D();
      } else {
        const light =
          L.type === 'sun'
            ? new DirectionalLight(L.color, L.intensity)
            : L.type === 'point'
              ? new PointLight(L.color, L.intensity, L.range, 2)
              : new SpotLight(
                  L.color,
                  L.intensity,
                  L.range,
                  (L.angle * Math.PI) / 360,
                  L.softness,
                  2,
                );
        if (light instanceof DirectionalLight || light instanceof SpotLight) {
          light.target.position.set(0, 0, -1);
          light.add(light.target);
        }
        node = light;
      }
    } else if (o.kind === 'camera') {
      node = new PerspectiveCamera(
        o.camera.fov,
        scene.render.width / scene.render.height,
        o.camera.near,
        o.camera.far,
      );
    } else node = new Object3D();
    if (!node) continue;
    const holder = o.kind === 'model' ? new Group() : node;
    if (holder !== node) holder.add(node);
    holder.name = nameOf(o);
    const t = transformAt(o, time);
    holder.position.set(...t.p);
    holder.rotation.set(t.r[0], t.r[1], t.r[2], 'XYZ');
    holder.scale.set(...t.s);
    nodes.set(id, holder);
    if (opts.animations && o.anim)
      ownTracks.push(
        ...bakeTracks(o, holder.uuid, scene.anim.start, scene.anim.end, scene.render.fps),
      );
  }
  for (const [id, node] of nodes) {
    const p = scene.objects[id]!.parent;
    (p && nodes.get(p) ? nodes.get(p)! : root).add(node);
  }
  // Keyframed objects share one clip (plays as a whole in engines); model clips stay separate.
  const clips = ownTracks.length
    ? [new AnimationClip('Animation', scene.anim.end - scene.anim.start, ownTracks), ...modelClips]
    : modelClips;
  return { root, clips, skipped };
}

/** Eased keyframes become linear samples (glTF only knows linear, step and cubic). */
function bakeTracks(o: Obj3D, node: string, start: number, end: number, fps: number) {
  const n = Math.max(2, Math.round((end - start) * fps) + 1);
  const times: number[] = [];
  const pos: number[] = [];
  const rot: number[] = [];
  const scl: number[] = [];
  const q = new Quaternion();
  const e = new Euler();
  for (let i = 0; i < n; i++) {
    const t = start + ((end - start) * i) / (n - 1);
    const tr = transformAt(o, t);
    times.push(t - start);
    pos.push(...tr.p);
    q.setFromEuler(e.set(tr.r[0], tr.r[1], tr.r[2], 'XYZ'));
    rot.push(q.x, q.y, q.z, q.w);
    scl.push(...tr.s);
  }
  const tracks = [];
  if (o.anim?.p?.length) tracks.push(new VectorKeyframeTrack(`${node}.position`, times, pos));
  if (o.anim?.r?.length) tracks.push(new QuaternionKeyframeTrack(`${node}.quaternion`, times, rot));
  if (o.anim?.s?.length) tracks.push(new VectorKeyframeTrack(`${node}.scale`, times, scl));
  return tracks;
}

export async function exportModel(
  scene: Scene3D,
  opts: ModelExportOptions,
): Promise<{ blob: Blob; ext: string; skipped: string[] }> {
  const { root, clips, skipped } = await buildExportScene(scene, opts);
  root.updateMatrixWorld(true);
  switch (opts.format) {
    case 'glb':
    case 'gltf': {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const binary = opts.format === 'glb';
      const out = await new GLTFExporter().parseAsync(root, {
        binary,
        animations: opts.animations ? clips : [],
        onlyVisible: true,
        maxTextureSize: 4096,
      });
      const blob = binary
        ? new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' })
        : new Blob([JSON.stringify(out)], { type: 'model/gltf+json' });
      return { blob, ext: opts.format, skipped };
    }
    case 'obj': {
      const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
      return {
        blob: new Blob([new OBJExporter().parse(root)], { type: 'model/obj' }),
        ext: 'obj',
        skipped,
      };
    }
    case 'stl': {
      const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
      let target: Object3D = root;
      if (opts.forPrinting) {
        // Slicers expect millimeters with Z pointing up.
        const wrap = new Group();
        wrap.rotation.x = Math.PI / 2;
        wrap.scale.setScalar(1000);
        wrap.add(root);
        wrap.updateMatrixWorld(true);
        target = wrap;
      }
      const data = new STLExporter().parse(target, { binary: true }) as DataView;
      return {
        blob: new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' }),
        ext: 'stl',
        skipped,
      };
    }
    case 'usdz': {
      const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');
      const data = await new USDZExporter().parseAsync(root, { quickLookCompatible: true });
      return {
        blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: 'model/vnd.usdz+zip' }),
        ext: 'usdz',
        skipped,
      };
    }
  }
}
