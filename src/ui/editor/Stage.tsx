import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ImagePlus, Plus } from 'lucide-preact';
import { quadContains, quadCorners, type Point } from '../../model/geometry';
import { clipsAt, findClip, mainTrack, setTransform } from '../../model/ops';
import type { Clip, Project, Transform } from '../../model/types';
import { Renderer } from '../../engine/render/renderer';
import { clipBaseSize } from '../../engine/render/rasterize';
import { preview } from '../../engine/preview';
import { canvasToBlob } from '../../engine/media/importer';
import { makeCanvas } from '../../engine/render/rasterize';
import { commit, endGesture, openPanel, select } from '../../state/actions';
import { setCoverProvider } from '../../state/persist';
import { editingTextId, isCompact, playhead, playing, project, selectionId } from '../../state/store';
import { emit } from '../../state/events';
import { addMediaFlow } from '../home/flows';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Static (non-animated) placement of a clip, used for the selection frame. */
export function staticQuad(p: Project, clip: Clip) {
  const base = clipBaseSize(p, clip);
  const t = clip.transform;
  return {
    cx: t.x * p.width,
    cy: t.y * p.height,
    w: base.w * t.scale,
    h: base.h * t.scale,
    rotation: (t.rotation * Math.PI) / 180,
  };
}

/** The top-most clip under a canvas point at time t. */
function hitTest(p: Project, t: number, pt: Point): Clip | null {
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i]!;
    if (track.kind === 'audio' || track.hidden || track.locked) continue;
    const active = p.kind === 'photo' ? track.clips : clipsAt(track, t);
    for (let j = active.length - 1; j >= 0; j--) {
      const c = active[j]!;
      if (c.type === 'media' && p.assets[c.assetId]?.kind === 'audio') continue;
      const q = staticQuad(p, c);
      // Small things get a bigger touch area.
      const pad = Math.max(0, 24 * (p.width / 1000) - Math.min(q.w, q.h) / 4);
      if (quadContains(q, pt, pad)) return c;
    }
  }
  return null;
}

type Drag =
  | { kind: 'move'; id: string; start: Point; tr: Transform; snapX: boolean; snapY: boolean }
  | { kind: 'scale'; id: string; center: Point; startDist: number; tr: Transform }
  | { kind: 'rotate'; id: string; center: Point; startAngle: number; tr: Transform }
  | { kind: 'pinch'; id: string; startDist: number; startAngle: number; startMid: Point; tr: Transform };

export function Stage() {
  const p = project.value!;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: 0, h: 0 });
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const compact = isCompact.value;

  // Renderer lifetime.
  useEffect(() => {
    let r: Renderer;
    try {
      r = new Renderer(canvasRef.current!);
    } catch (err) {
      setError('Your browser could not start the graphics engine (WebGL 2). Try updating your browser.');
      console.error(err);
      return;
    }
    preview.attach(r);
    setCoverProvider(async () => {
      const proj = project.peek();
      if (!proj) return null;
      const s = 320 / Math.max(proj.width, proj.height);
      const c = makeCanvas(Math.max(1, Math.round(proj.width * s)), Math.max(1, Math.round(proj.height * s)));
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      preview.renderNow();
      ctx.drawImage(r.canvas as HTMLCanvasElement, 0, 0, c.width, c.height);
      return canvasToBlob(c, 'image/jpeg', 0.8);
    });
    return () => {
      setCoverProvider(null);
      preview.attach(null);
      r.dispose();
    };
  }, []);

  // Fit the canvas into the available space.
  useLayoutEffect(() => {
    const host = hostRef.current!;
    const fit = () => {
      const pad = compact ? 10 : 24;
      const W = host.clientWidth - pad * 2;
      const H = host.clientHeight - pad * 2;
      if (W <= 0 || H <= 0) return;
      const aspect = p.width / p.height;
      const w = W / H > aspect ? H * aspect : W;
      const h = w / aspect;
      const nb = { x: (host.clientWidth - w) / 2, y: (host.clientHeight - h) / 2, w, h };
      setBox(nb);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const c = canvasRef.current!;
      const bw = Math.max(2, Math.round(Math.min(w * dpr, p.width, 2560)));
      const bh = Math.max(2, Math.round((bw * p.height) / p.width));
      if (c.width !== bw || c.height !== bh) {
        c.width = bw;
        c.height = bh;
        preview.requestRender();
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [p.width, p.height, compact]);

  const k = box.w / p.width; // screen px per canvas px
  const toCanvas = (e: { clientX: number; clientY: number }): Point => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - box.x) / k, y: (e.clientY - r.top - box.y) / k };
  };

  const selId = selectionId.value;
  const sel = selId ? findClip(p, selId) : null;
  const selClip = sel && !(sel.clip.type === 'media' && p.assets[sel.clip.assetId]?.kind === 'audio') ? sel.clip : null;
  const t = playhead.value;
  const visibleNow = selClip && (p.kind === 'photo' || (t >= selClip.start - 1e-6 && t < selClip.start + selClip.duration));
  const showGizmo = !!selClip && !!visibleNow && !playing.value;
  const quad = selClip ? staticQuad(p, selClip) : null;

  const applyTransform = (id: string, patch: Partial<Transform>) => {
    commit('Move / resize', (q) => setTransform(q, id, patch), { coalesce: `transform:${id}` });
  };

  const onPointerDown = (e: PointerEvent) => {
    if (playing.peek()) preview.pause();
    const target = e.target as HTMLElement;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = toCanvas(e);
    pointers.current.set(e.pointerId, pt);
    const proj = project.peek()!;
    // Second finger: pinch / rotate the selected clip.
    if (pointers.current.size === 2 && selectionId.peek()) {
      const loc = findClip(proj, selectionId.peek());
      if (loc) {
        const [a, b] = [...pointers.current.values()] as [Point, Point];
        drag.current = {
          kind: 'pinch',
          id: loc.clip.id,
          startDist: Math.hypot(b.x - a.x, b.y - a.y),
          startAngle: Math.atan2(b.y - a.y, b.x - a.x),
          startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          tr: { ...loc.clip.transform },
        };
      }
      return;
    }
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    if (handle && selClip) {
      const q = staticQuad(proj, selClip);
      const center = { x: q.cx, y: q.cy };
      if (handle === 'rotate') {
        drag.current = { kind: 'rotate', id: selClip.id, center, startAngle: Math.atan2(pt.y - center.y, pt.x - center.x), tr: { ...selClip.transform } };
      } else {
        drag.current = { kind: 'scale', id: selClip.id, center, startDist: Math.max(1, Math.hypot(pt.x - center.x, pt.y - center.y)), tr: { ...selClip.transform } };
      }
      return;
    }
    const hit = hitTest(proj, playhead.peek(), pt);
    if (!hit) {
      select(null);
      drag.current = null;
      return;
    }
    select(hit.id);
    drag.current = { kind: 'move', id: hit.id, start: pt, tr: { ...hit.transform }, snapX: false, snapY: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const pt = toCanvas(e);
    pointers.current.set(e.pointerId, pt);
    const d = drag.current;
    const proj = project.peek()!;
    if (!d) return;
    if (d.kind === 'move') {
      const dx = (pt.x - d.start.x) / proj.width;
      const dy = (pt.y - d.start.y) / proj.height;
      if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) return;
      let x = d.tr.x + dx;
      let y = d.tr.y + dy;
      const snap = 8 / k; // 8 screen px
      const snapX = Math.abs(x * proj.width - proj.width / 2) < snap;
      const snapY = Math.abs(y * proj.height - proj.height / 2) < snap;
      if (snapX) x = 0.5;
      if (snapY) y = 0.5;
      if (snapX !== guides.v || snapY !== guides.h) setGuides({ v: snapX, h: snapY });
      applyTransform(d.id, { x, y });
    } else if (d.kind === 'scale') {
      const dist = Math.hypot(pt.x - d.center.x, pt.y - d.center.y);
      applyTransform(d.id, { scale: Math.max(0.02, Math.min(20, d.tr.scale * (dist / d.startDist))) });
    } else if (d.kind === 'rotate') {
      const ang = Math.atan2(pt.y - d.center.y, pt.x - d.center.x);
      let deg = d.tr.rotation + ((ang - d.startAngle) * 180) / Math.PI;
      deg = ((((deg + 180) % 360) + 360) % 360) - 180;
      for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(deg - s) < 4) deg = s;
      applyTransform(d.id, { rotation: Math.round(deg * 10) / 10 });
    } else if (d.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      applyTransform(d.id, {
        scale: Math.max(0.02, Math.min(20, d.tr.scale * (dist / Math.max(1, d.startDist)))),
        rotation: Math.round((d.tr.rotation + ((ang - d.startAngle) * 180) / Math.PI) * 10) / 10,
        x: d.tr.x + (mid.x - d.startMid.x) / proj.width,
        y: d.tr.y + (mid.y - d.startMid.y) / proj.height,
      });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      if (drag.current) emit('clip:moved', { id: drag.current.id });
      drag.current = null;
      setGuides({ v: false, h: false });
      endGesture();
    } else if (drag.current?.kind === 'pinch') {
      drag.current = null;
    }
  };

  const onDblClick = (e: MouseEvent) => {
    const hit = hitTest(project.peek()!, playhead.peek(), toCanvas(e));
    if (hit?.type === 'text') {
      select(hit.id);
      editingTextId.value = hit.id;
      openPanel('text');
    }
  };

  const onWheel = (e: WheelEvent) => {
    const id = selectionId.peek();
    if (!id || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const c = findClip(project.peek()!, id)?.clip;
    if (!c) return;
    const f = Math.exp(-e.deltaY * 0.002);
    applyTransform(id, { scale: Math.max(0.02, Math.min(20, c.transform.scale * f)) });
    clearTimeout((onWheel as unknown as { t?: number }).t);
    (onWheel as unknown as { t?: number }).t = window.setTimeout(endGesture, 300);
  };

  const empty = p.kind === 'video' ? !mainTrack(p)?.clips.length && p.tracks.length <= 1 : p.tracks.length === 0;

  return (
    <div class="stage" ref={hostRef} data-coach="stage">
      <canvas
        ref={canvasRef}
        class="stage-canvas"
        style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }}
        aria-label="Preview of your project"
        role="img"
      />
      <div
        class="stage-input"
        style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }}
        onPointerDown={onPointerDown as never}
        onPointerMove={onPointerMove as never}
        onPointerUp={onPointerUp as never}
        onPointerCancel={onPointerUp as never}
        onDblClick={onDblClick as never}
        onWheel={onWheel as never}
      >
        {guides.v && <div class="guide v" />}
        {guides.h && <div class="guide h" />}
        {showGizmo && quad && <Gizmo quad={quad} k={k} />}
      </div>
      {empty && (
        <div class="stage-empty">
          <button class="empty-add" onClick={() => void addMediaFlow()} data-coach="empty-add">
            {p.kind === 'photo' ? <ImagePlus size={30} /> : <Plus size={34} />}
            <strong>{p.kind === 'photo' ? 'Choose a photo' : 'Add photos or videos'}</strong>
            <span>{compact ? 'From your gallery or files' : 'Or drag & drop files anywhere'}</span>
          </button>
        </div>
      )}
      {error && <div class="stage-error">{error}</div>}
    </div>
  );
}

function Gizmo({ quad, k }: { quad: ReturnType<typeof staticQuad>; k: number }) {
  const pts = quadCorners(quad).map((pt) => ({ x: pt.x * k, y: pt.y * k }));
  const c = { x: quad.cx * k, y: quad.cy * k };
  const up = { x: Math.sin(quad.rotation), y: -Math.cos(quad.rotation) };
  const topMid = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
  const rot = { x: topMid.x + up.x * 34, y: topMid.y + up.y * 34 };
  void c;
  return (
    <>
      <svg class="gizmo" aria-hidden="true">
        <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
        <line x1={topMid.x} y1={topMid.y} x2={rot.x} y2={rot.y} />
      </svg>
      {pts.map((pt, i) => (
        <div key={i} class="handle scale" data-handle={`scale-${i}`} style={{ left: `${pt.x}px`, top: `${pt.y}px` }} />
      ))}
      <div class="handle rotate" data-handle="rotate" style={{ left: `${rot.x}px`, top: `${rot.y}px` }} title="Drag to rotate" />
    </>
  );
}
