/* Dev-only page used to check the renderer quickly in a real browser. */
import { createMediaClip, createProject, createShapeClip, createStickerClip, createTextClip } from '../src/model/defaults';
import { addAsset, addOverlayClip, insertMainClips, setTransition } from '../src/model/ops';
import type { Asset, Project } from '../src/model/types';
import { loadProjectFonts } from '../src/engine/render/rasterize';
import { Renderer, type MediaProvider } from '../src/engine/render/renderer';

function makeImage(w: number, h: number, hue: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `hsl(${hue},70%,35%)`);
  grad.addColorStop(1, `hsl(${hue + 60},80%,65%)`);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 12; i++) {
    g.fillStyle = `hsla(${hue + i * 20},90%,${40 + i * 4}%,0.8)`;
    g.beginPath(); g.arc((i * 137) % w, (i * 89) % h, 40 + i * 6, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.fillText('Photo ' + hue, 40, h - 40);
  return c;
}

const log = (s: string) => ((document.getElementById('log')!).textContent += s + '\n');

async function main() {
  const imgs = [makeImage(1600, 1200, 200), makeImage(1080, 1920, 20)];
  const bitmaps = await Promise.all(imgs.map((c) => createImageBitmap(c, { premultiplyAlpha: 'premultiply' })));
  const assets: Asset[] = bitmaps.map((b, i) => ({
    id: 'img' + i, kind: 'image', name: 'img' + i, mime: 'image/png', size: 1, width: b.width, height: b.height,
    duration: 0, hasAudio: false, addedAt: 0,
  }));
  let p: Project = createProject({ kind: 'video', width: 1920, height: 1080 });
  for (const a of assets) p = addAsset(p, a);
  const c1 = createMediaClip(assets[0]!, { motion: 'none' });
  const c2 = createMediaClip(assets[1]!, { motion: 'none' });
  c1.effects.filter = { id: (new URLSearchParams(location.search).get('filter') ?? 'cinematic'), intensity: 1 };
  p = insertMainClips(p, [c1, c2]);
  p = setTransition(p, c2.id, { type: (new URLSearchParams(location.search).get('tr') as never) ?? 'fade', duration: 1 });
  p = addOverlayClip(p, createTextClip('Hello Kinora!', { size: 120, strokeWidth: 0.06, strokeColor: '#000' }, { start: 0, duration: 6, transform: { x: 0.5, y: 0.3, scale: 1, rotation: -4, flipX: false, flipY: false } }));
  p = addOverlayClip(p, createStickerClip('🎉', { start: 0, duration: 6, transform: { x: 0.82, y: 0.7, scale: 1, rotation: 12, flipX: false, flipY: false } }));
  p = addOverlayClip(p, createShapeClip('heart', { start: 0, duration: 6, fill: '#ff4d6d', transform: { x: 0.15, y: 0.75, scale: 0.6, rotation: 0, flipX: false, flipY: false } }));
  await loadProjectFonts(p);
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const r = new Renderer(canvas);
  log('halfFloat=' + r.caps.halfFloat + ' maxTex=' + r.caps.maxTextureSize);
  const media: MediaProvider = {
    frame: (clip, asset) => {
      const i = Number(asset.id.slice(3));
      const b = bitmaps[i]!;
      return { source: b, width: b.width, height: b.height, frameId: 1, isStatic: true };
    },
  };
  const t = Number(new URLSearchParams(location.search).get('t') ?? '1');
  const t0 = performance.now();
  r.render(p, t, media, {});
  log('render ms ' + (performance.now() - t0).toFixed(1));
  (window as unknown as { done: boolean }).done = true;
}
main().catch((e) => { log('ERROR ' + (e?.stack || e)); (window as unknown as { done: boolean }).done = true; });
