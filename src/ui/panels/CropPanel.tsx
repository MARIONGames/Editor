import { useEffect, useRef, useState } from 'preact/hooks';
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Undo2 } from 'lucide-preact';
import { defaultCrop } from '../../model/defaults';
import { findClip } from '../../model/ops';
import type { Crop, MediaClip, Project } from '../../model/types';
import { peekImage } from '../../engine/media/images';
import { getDerivedData } from '../../engine/media/mediaStore';
import { commit, endGesture } from '../../state/actions';
import { playhead, project } from '../../state/store';
import { Section } from '../components/Controls';
import { Slider } from '../components/Slider';
import { NeedSelection } from './PanelHost';
import { useMediaSelection } from './AdjustPanel';

const ASPECTS: { id: string; label: string; ratio: number | null | 'original' }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'original', label: 'Original', ratio: 'original' },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

/** Photo projects: the bottom photo decides the output size (crop = crop the result). */
export function isPhotoBase(p: Project, clipId: string): boolean {
  if (p.kind !== 'photo') return false;
  const loc = findClip(p, clipId);
  return !!loc && loc.trackIndex === 0 && loc.clip.type === 'media';
}

/** Straighten: zoom just enough that no empty corners show. */
export function coverScale(deg: number, W: number, H: number): number {
  const r = (Math.abs(deg % 90) * Math.PI) / 180;
  const q = Math.min(r, Math.PI / 2 - r);
  return Math.cos(q) + Math.max(W / H, H / W) * Math.sin(q);
}

/** Applies a crop/rotation change to a clip (and resizes the canvas for a photo's base layer). */
export function applyCrop(
  p: Project,
  clipId: string,
  patch: { crop?: Crop; turns?: number; straighten?: number; flipX?: boolean; flipY?: boolean },
): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.type !== 'media') return p;
  const c = loc.clip;
  const crop = patch.crop ?? c.crop;
  const turns = ((((patch.turns ?? c.turns) % 4) + 4) % 4);
  const straight = patch.straighten ?? c.transform.rotation;
  const transform = {
    ...c.transform,
    rotation: straight,
    flipX: patch.flipX ?? c.transform.flipX,
    flipY: patch.flipY ?? c.transform.flipY,
  };
  let q: Project = p;
  if (isPhotoBase(p, clipId)) {
    // The photo decides the output: crop/rotate the result, straighten without empty corners.
    const a = p.assets[c.assetId]!;
    const cw = a.width * (1 - crop.left - crop.right);
    const ch = a.height * (1 - crop.top - crop.bottom);
    const swap = turns % 2 === 1;
    const W = Math.max(16, Math.round(swap ? ch : cw));
    const H = Math.max(16, Math.round(swap ? cw : ch));
    transform.scale = Math.abs(straight) > 0.01 ? coverScale(straight, W, H) : 1;
    transform.x = 0.5;
    transform.y = 0.5;
    q = { ...p, width: W, height: H };
  }
  const clips = loc.track.clips.slice();
  clips[loc.clipIndex] = { ...c, crop, turns, transform } as MediaClip;
  return { ...q, tracks: q.tracks.map((t) => (t.id === loc.track.id ? { ...t, clips } : t)) };
}

/** Loads a picture of the clip to crop on. */
function useSourcePicture(clip: MediaClip | null): ImageBitmap | null {
  const p = project.value;
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const key = clip ? `${clip.assetId}` : '';
  useEffect(() => {
    if (!clip || !p) return;
    let cancelled = false;
    const asset = p.assets[clip.assetId];
    if (!asset) return;
    if (asset.kind === 'image') {
      const tryGet = () => {
        const b = peekImage(asset.id, 1024);
        if (b) setBmp(b);
        else if (!cancelled) setTimeout(tryGet, 150);
      };
      tryGet();
    } else {
      void getDerivedData(asset.id).then(async (d) => {
        if (!d?.thumbs.length || cancelled) return;
        const src = clip.in + Math.max(0, playhead.peek() - clip.start) * clip.speed;
        const idx = d.thumbInterval > 0 ? Math.min(d.thumbs.length - 1, Math.floor(src / d.thumbInterval)) : 0;
        const b = await createImageBitmap(d.thumbs[idx]!);
        if (!cancelled) setBmp(b);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return bmp;
}

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'move';

function CropBox({ clip, aspect }: { clip: MediaClip; aspect: number | null }) {
  const p = project.value!;
  const asset = p.assets[clip.assetId]!;
  const bmp = useSourcePicture(clip);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ h: Handle; x: number; y: number; crop: Crop } | null>(null);
  const maxW = 300;
  const maxH = 220;
  const s = Math.min(maxW / asset.width, maxH / asset.height);
  const w = Math.round(asset.width * s);
  const h = Math.round(asset.height * s);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !bmp) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  }, [bmp, w, h]);
  const cr = clip.crop;
  const rect = { x: cr.left * w, y: cr.top * h, w: (1 - cr.left - cr.right) * w, h: (1 - cr.top - cr.bottom) * h };

  const onDown = (e: PointerEvent, hd: Handle) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { h: hd, x: e.clientX, y: e.clientY, crop: { ...clip.crop } };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / w;
    const dy = (e.clientY - d.y) / h;
    const o = d.crop;
    const min = 0.05;
    let { left, top, right, bottom } = o;
    if (d.h === 'move') {
      const cw = 1 - o.left - o.right;
      const ch = 1 - o.top - o.bottom;
      left = Math.max(0, Math.min(1 - cw, o.left + dx));
      top = Math.max(0, Math.min(1 - ch, o.top + dy));
      right = 1 - cw - left;
      bottom = 1 - ch - top;
    } else {
      if (d.h.includes('l')) left = Math.max(0, Math.min(1 - right - min, o.left + dx));
      if (d.h.includes('r')) right = Math.max(0, Math.min(1 - left - min, o.right - dx));
      if (d.h.includes('t')) top = Math.max(0, Math.min(1 - bottom - min, o.top + dy));
      if (d.h.includes('b')) bottom = Math.max(0, Math.min(1 - top - min, o.bottom - dy));
      if (aspect) {
        // Keep the chosen shape: adjust height from width (in source pixels).
        const cwPx = (1 - left - right) * asset.width;
        let chFrac = cwPx / aspect / asset.height;
        if (chFrac > 1) chFrac = 1;
        if (d.h.includes('t')) top = Math.max(0, 1 - bottom - chFrac);
        else bottom = Math.max(0, 1 - top - chFrac);
        const realH = 1 - top - bottom;
        const cwFrac = (realH * asset.height * aspect) / asset.width;
        if (d.h.includes('l')) left = Math.max(0, 1 - right - cwFrac);
        else right = Math.max(0, 1 - left - cwFrac);
      }
    }
    commit('Crop', (q) => applyCrop(q, clip.id, { crop: { left, top, right, bottom } }), { coalesce: `crop:${clip.id}` });
  };
  const onUp = () => {
    drag.current = null;
    endGesture();
  };
  return (
    <div class="cropbox" ref={boxRef} style={{ width: `${w}px`, height: `${h}px` }} onPointerMove={onMove as never} onPointerUp={onUp} onPointerCancel={onUp}>
      <canvas ref={canvasRef} style={{ width: `${w}px`, height: `${h}px` }} />
      <div class="crop-rect" style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` }} onPointerDown={(e) => onDown(e as unknown as PointerEvent, 'move')}>
        <div class="crop-grid" />
        {(['tl', 'tr', 'bl', 'br'] as const).map((hd) => (
          <div key={hd} class={`crop-handle ${hd}`} onPointerDown={(e) => onDown(e as unknown as PointerEvent, hd)} />
        ))}
      </div>
    </div>
  );
}

export function CropPanel() {
  const c = useMediaSelection();
  const p = project.value!;
  const [aspectId, setAspectId] = useState('free');
  if (!c) {
    return <NeedSelection what="Tap a photo or video first, then crop, rotate or flip it here." />;
  }
  const clip = c;
  const asset = p.assets[clip.assetId]!;
  const def = ASPECTS.find((a) => a.id === aspectId)!;
  const ratio = def.ratio === 'original' ? asset.width / asset.height : def.ratio;
  const straight = clip.transform.rotation;

  const chooseAspect = (id: string) => {
    setAspectId(id);
    const d = ASPECTS.find((a) => a.id === id)!;
    const r = d.ratio === 'original' ? asset.width / asset.height : d.ratio;
    if (!r) return;
    // Largest centred crop of that shape.
    let cw = 1;
    let ch = (asset.width / r) / asset.height;
    if (ch > 1) {
      ch = 1;
      cw = (asset.height * r) / asset.width;
    }
    const crop = { left: (1 - cw) / 2, right: (1 - cw) / 2, top: (1 - ch) / 2, bottom: (1 - ch) / 2 };
    commit(`Crop to ${d.label}`, (q) => applyCrop(q, clip.id, { crop }));
  };

  return (
    <div class="panel crop-panel">
      <CropBox clip={clip} aspect={ratio} />
      <div class="chips">
        {ASPECTS.map((a) => (
          <button key={a.id} class={`chip ${aspectId === a.id ? 'on' : ''}`} onClick={() => chooseAspect(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      <Section title="Rotate & flip">
        <div class="row wrap-gap">
          <button class="btn small" onClick={() => commit('Rotate left', (q) => applyCrop(q, clip.id, { turns: clip.turns - 1 }))}>
            <RotateCcw size={16} /> Left
          </button>
          <button class="btn small" onClick={() => commit('Rotate right', (q) => applyCrop(q, clip.id, { turns: clip.turns + 1 }))}>
            <RotateCw size={16} /> Right
          </button>
          <button class={`btn small ${clip.transform.flipX ? 'primary' : ''}`} onClick={() => commit('Flip', (q) => applyCrop(q, clip.id, { flipX: !clip.transform.flipX }))}>
            <FlipHorizontal2 size={16} /> Mirror
          </button>
          <button class={`btn small ${clip.transform.flipY ? 'primary' : ''}`} onClick={() => commit('Flip upside down', (q) => applyCrop(q, clip.id, { flipY: !clip.transform.flipY }))}>
            <FlipVertical2 size={16} /> Upside down
          </button>
        </div>
        <Slider
          label="Straighten"
          value={Math.max(-45, Math.min(45, Math.round(straight * 10) / 10))}
          min={-45}
          max={45}
          step={0.1}
          defaultValue={0}
          format={(v) => `${v.toFixed(1)}°`}
          hint="Fix a tilted horizon"
          onChange={(v, final) => {
            commit('Straighten', (q) => applyCrop(q, clip.id, { straighten: v }), { coalesce: `straighten:${clip.id}` });
            if (final) endGesture();
          }}
        />
      </Section>
      <button
        class="btn small ghost"
        onClick={() => {
          setAspectId('free');
          commit('Reset crop', (q) => applyCrop(q, clip.id, { crop: defaultCrop(), turns: 0, straighten: 0, flipX: false, flipY: false }));
        }}
      >
        <Undo2 size={16} /> Reset crop &amp; rotation
      </button>
    </div>
  );
}
