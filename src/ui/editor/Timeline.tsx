import { useSignalEffect } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ArrowLeftRight, Image as ImageIcon, Music, Plus, Shapes, Type, Volume2, VolumeX } from 'lucide-preact';
import { transitionDef } from '../../model/catalog';
import {
  clipEnd,
  findClip,
  mainTrack,
  moveClip,
  moveClipToNewLane,
  reorderMainClip,
  setTrackProps,
  trimClip,
} from '../../model/ops';
import { formatDuration, rulerStep, snapTime } from '../../model/time';
import type { Clip, MediaClip, Project, Track } from '../../model/types';
import { preview } from '../../engine/preview';
import { commit, endGesture, openPanel, select } from '../../state/actions';
import { emit } from '../../state/events';
import { duration, isCompact, playhead, playing, project, selectionId, zoom } from '../../state/store';
import { addMediaFlow } from '../home/flows';
import { clampZoom } from './Transport';
import { derived, derivedVersion, thumbUrls } from './thumbs';
import { Waveform } from './Waveform';

type TLDrag =
  | {
      kind: 'pending';
      id: string;
      pointerId: number;
      x: number;
      y: number;
      touch: boolean;
      timer: ReturnType<typeof setTimeout> | null;
      ready: boolean;
    }
  | { kind: 'trim'; id: string; edge: 'start' | 'end'; x: number; orig: Project; origPlayhead: number; mainStart: boolean }
  | { kind: 'move'; id: string; x: number; y: number; orig: Project; origStart: number }
  | { kind: 'reorder'; id: string; x: number; orig: Project; index: number; pointerX: number };

const RULER_H = 26;

export function Timeline() {
  const p = project.value!;
  const z = zoom.value;
  const compact = isCompact.value;
  const dv = derivedVersion.value;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(800);
  const [view, setView] = useState<[number, number]>([0, 30]);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [reorderMark, setReorderMark] = useState<{ x: number; ghostX: number; id: string } | null>(null);
  const programmatic = useRef(-1);
  const drag = useRef<TLDrag | null>(null);
  const dur = duration.value;
  const pad = vw / 2;
  const contentW = Math.ceil(pad * 2 + dur * z);
  const selId = selectionId.value;

  // Viewport size.
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    setVw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const updateView = () => {
    const el = scrollRef.current;
    if (!el) return;
    const zz = zoom.peek();
    const t0 = (el.scrollLeft - el.clientWidth / 2) / zz;
    const t1 = (el.scrollLeft + el.clientWidth / 2) / zz;
    const margin = (el.clientWidth / zz) * 0.5;
    setView((v) =>
      Math.abs(v[0] - (t0 - margin)) > margin * 0.4 || Math.abs(v[1] - (t1 + margin)) > margin * 0.4 ? [t0 - margin, t1 + margin] : v,
    );
    drawRuler();
  };

  // Playhead → scroll position (without re-rendering the timeline).
  useSignalEffect(() => {
    const t = playhead.value;
    const zz = zoom.value;
    const el = scrollRef.current;
    if (!el) return;
    const target = t * zz;
    if (Math.abs(el.scrollLeft - target) > 0.5) {
      programmatic.current = target;
      el.scrollLeft = target;
    }
    drawRuler();
  });

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const target = playhead.peek() * z;
    programmatic.current = target;
    el.scrollLeft = target;
    updateView();
  }, [z, contentW, vw]);

  const onScroll = () => {
    const el = scrollRef.current!;
    if (programmatic.current >= 0 && Math.abs(el.scrollLeft - programmatic.current) < 1.5) {
      programmatic.current = -1;
      updateView();
      return;
    }
    programmatic.current = -1;
    if (playing.peek()) preview.pause();
    preview.seek(el.scrollLeft / zoom.peek());
    emit('playhead:moved', {});
    updateView();
  };

  /* ------------------------------------------------------------------ ruler */

  const drawRuler = () => {
    const c = rulerRef.current;
    const el = scrollRef.current;
    if (!c || !el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(RULER_H * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, RULER_H);
    const zz = zoom.peek();
    const left = el.scrollLeft - w / 2; // timeline px at the viewport's left edge
    const { major, minor } = rulerStep(zz);
    const style = getComputedStyle(c);
    ctx.strokeStyle = style.getPropertyValue('--ruler-tick') || '#555';
    ctx.fillStyle = style.getPropertyValue('--ruler-text') || '#999';
    ctx.font = '600 10.5px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const t0 = Math.max(0, Math.floor(left / zz / minor) * minor);
    const end = Math.min(duration.peek() + major, (left + w) / zz + minor);
    ctx.beginPath();
    for (let t = t0; t <= end; t += minor) {
      const x = Math.round(t * zz - left) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.moveTo(x, isMajor ? RULER_H - 9 : RULER_H - 5);
      ctx.lineTo(x, RULER_H);
      if (isMajor) {
        const label = major < 1 ? `${t.toFixed(major < 0.1 ? 2 : 1)}s` : t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${Math.round(t)}s`;
        ctx.fillText(label, x + 3, 4);
      }
    }
    ctx.stroke();
  };

  const rulerSeek = (e: PointerEvent) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    const t = (el.scrollLeft - el.clientWidth / 2 + (e.clientX - r.left)) / zoom.peek();
    if (playing.peek()) preview.pause();
    preview.seek(t);
    emit('playhead:moved', {});
  };

  /* ----------------------------------------------------- zoom: pinch & wheel */

  useEffect(() => {
    const el = scrollRef.current!;
    let pinch: { d: number; z: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        pinch = { d: Math.abs(a.clientX - b.clientX) + 1, z: zoom.peek() };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      const d = drag.current;
      if (d && d.kind !== 'pending') {
        e.preventDefault();
        return;
      }
      if (d && d.kind === 'pending' && d.ready) {
        e.preventDefault();
        return;
      }
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        zoom.value = clampZoom((pinch.z * (Math.abs(a.clientX - b.clientX) + 1)) / pinch.d);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoom.value = clampZoom(zoom.peek() * Math.exp(-e.deltaY * 0.0025));
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
        // A normal mouse wheel moves through time.
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  /* --------------------------------------------------------- clip dragging */

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return (el.scrollLeft - el.clientWidth / 2 + (clientX - r.left)) / zoom.peek();
  };

  const snapCandidates = (proj: Project, excludeId: string): number[] => {
    const out = [0, playhead.peek()];
    for (const t of proj.tracks)
      for (const c of t.clips) {
        if (c.id === excludeId) continue;
        out.push(c.start, clipEnd(c));
      }
    return out;
  };

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-tl-button]')) return;
    const clipEl = target.closest<HTMLElement>('[data-clip-id]');
    if (!clipEl) return;
    const id = clipEl.dataset.clipId!;
    const trim = target.closest<HTMLElement>('[data-trim]')?.dataset.trim as 'start' | 'end' | undefined;
    if (playing.peek()) preview.pause();
    const proj = project.peek()!;
    const loc = findClip(proj, id);
    if (!loc || loc.track.locked) return;
    if (trim) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = {
        kind: 'trim',
        id,
        edge: trim,
        x: e.clientX,
        orig: proj,
        origPlayhead: playhead.peek(),
        mainStart: loc.track.kind === 'main' && trim === 'start',
      };
      return;
    }
    const touch = e.pointerType !== 'mouse';
    const pending: TLDrag = { kind: 'pending', id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, touch, timer: null, ready: !touch };
    if (touch) {
      pending.timer = setTimeout(() => {
        if (drag.current === pending) {
          pending.ready = true;
          navigator.vibrate?.(12);
          select(id);
          startMove(pending, e.clientX, e.clientY);
        }
      }, 380);
    }
    drag.current = pending;
  };

  const startMove = (d: Extract<TLDrag, { kind: 'pending' }>, x: number, y: number) => {
    const proj = project.peek()!;
    const loc = findClip(proj, d.id);
    if (!loc) return;
    try {
      lanesRef.current?.setPointerCapture(d.pointerId);
    } catch {
      /* pointer may already be gone */
    }
    if (loc.track.kind === 'main') {
      drag.current = { kind: 'reorder', id: d.id, x, orig: proj, index: loc.clipIndex, pointerX: x };
    } else {
      drag.current = { kind: 'move', id: d.id, x, y, orig: proj, origStart: loc.clip.start };
    }
    void y;
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const zz = zoom.peek();
    if (d.kind === 'pending') {
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (d.touch) {
        if (!d.ready && moved > 10) {
          if (d.timer) clearTimeout(d.timer);
          drag.current = null; // it's a scroll
        }
        return;
      }
      if (moved > 5) {
        select(d.id);
        startMove(d, d.x, d.y);
      }
      return;
    }
    const thr = 10 / zz;
    if (d.kind === 'trim') {
      const origClip = findClip(d.orig, d.id)!.clip;
      let delta = (e.clientX - d.x) / zz;
      const edgeT = d.edge === 'start' ? origClip.start + delta : clipEnd(origClip) + delta;
      const cands = d.mainStart ? [] : snapCandidates(d.orig, d.id);
      const s = snapTime(edgeT, cands, thr);
      if (s.snapped) delta += s.value - edgeT;
      setSnapLine(s.snapped ? s.value : null);
      const next = trimClip(d.orig, d.id, d.edge, delta);
      commit('Trim clip', () => next, { coalesce: `trim:${d.id}` });
      if (d.mainStart) {
        // Keep the picture under the finger still: shift the view by the trimmed amount.
        const nc = findClip(next, d.id)?.clip;
        if (nc) preview.seek(Math.max(0, d.origPlayhead - (origClip.duration - nc.duration)));
      }
      return;
    }
    if (d.kind === 'move') {
      const origClip = findClip(d.orig, d.id)!.clip;
      let start = Math.max(0, d.origStart + (e.clientX - d.x) / zz);
      const cands = snapCandidates(d.orig, d.id);
      const s1 = snapTime(start, cands, thr);
      const s2 = snapTime(start + origClip.duration, cands, thr);
      if (s1.snapped && (!s2.snapped || Math.abs(s1.value - start) <= Math.abs(s2.value - start - origClip.duration))) {
        start = s1.value;
        setSnapLine(s1.value);
      } else if (s2.snapped) {
        start = s2.value - origClip.duration;
        setSnapLine(s2.value);
      } else setSnapLine(null);
      const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const laneEl = under?.closest<HTMLElement>('[data-track-id]');
      const newLane = !!under?.closest('[data-new-lane]');
      const origTrack = findClip(d.orig, d.id)!.track;
      const target = laneEl?.dataset.trackKind === origTrack.kind ? laneEl.dataset.trackId : origTrack.id;
      const next = newLane && origTrack.kind === 'overlay' ? moveClipToNewLane(d.orig, d.id, start) : moveClip(d.orig, d.id, start, target);
      commit('Move', () => next, { coalesce: `move:${d.id}` });
      autoScroll(e.clientX);
      return;
    }
    if (d.kind === 'reorder') {
      const t = timeAt(e.clientX);
      const m = mainTrack(d.orig)!;
      const others = m.clips.filter((c) => c.id !== d.id);
      let index = 0;
      for (const c of others) if (c.start + c.duration / 2 < t) index++;
      d.index = index;
      d.pointerX = e.clientX;
      // marker position: boundary between others[index-1] and others[index] in the current layout
      const boundaryT = index === 0 ? 0 : index >= others.length ? clipEnd(m.clips[m.clips.length - 1]!) : others[index]!.start;
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      setReorderMark({ x: pad + boundaryT * zz, ghostX: e.clientX - r.left + el.scrollLeft, id: d.id });
      autoScroll(e.clientX);
    }
  };

  const autoScroll = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    const edge = 44;
    if (clientX < r.left + edge) el.scrollLeft -= 14;
    else if (clientX > r.right - edge) el.scrollLeft += 14;
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setSnapLine(null);
    if (!d) return;
    if (d.kind === 'pending') {
      if (d.timer) clearTimeout(d.timer);
      // A tap selects.
      if (!d.ready || !d.touch) select(d.id);
      return;
    }
    if (d.kind === 'trim') emit('clip:trimmed', { id: d.id });
    if (d.kind === 'move') emit('clip:moved', { id: d.id });
    if (d.kind === 'reorder') {
      setReorderMark(null);
      const loc = findClip(d.orig, d.id);
      if (loc) {
        const target = d.index;
        if (target !== loc.clipIndex) {
          commit('Reorder clips', () => reorderMainClip(d.orig, d.id, target));
          emit('clip:moved', { id: d.id });
        }
      }
    }
    endGesture();
  };

  /** The browser took over (e.g. started scrolling): never treat that as a tap. */
  const onPointerCancel = (e: PointerEvent) => {
    const d = drag.current;
    if (d?.kind === 'pending') {
      if (d.timer) clearTimeout(d.timer);
      drag.current = null;
      return;
    }
    onPointerUp(e);
  };

  const onLanesClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-clip-id]') && !target.closest('[data-tl-button]') && drag.current === null) select(null);
  };

  /* --------------------------------------------------------------- render */

  const overlays = p.tracks.filter((t) => t.kind === 'overlay').reverse();
  const main = mainTrack(p);
  const audios = p.tracks.filter((t) => t.kind === 'audio');
  const mainH = compact ? 54 : 62;

  return (
    <div class="timeline" data-coach="timeline">
      <canvas
        ref={rulerRef}
        class="tl-ruler"
        style={{ height: `${RULER_H}px` }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          rulerSeek(e as unknown as PointerEvent);
        }}
        onPointerMove={(e) => {
          if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) rulerSeek(e as unknown as PointerEvent);
        }}
        aria-label="Time ruler: tap to jump to a moment"
      />
      <div class="tl-scroll" ref={scrollRef} onScroll={onScroll}>
        <div
          class="tl-lanes"
          ref={lanesRef}
          style={{ width: `${contentW}px` }}
          onPointerDown={onPointerDown as never}
          onPointerMove={onPointerMove as never}
          onPointerUp={onPointerUp as never}
          onPointerCancel={onPointerCancel as never}
          onClick={onLanesClick as never}
        >
          {overlays.length > 0 && <div class="tl-new-lane" data-new-lane style={{ width: `${contentW}px` }} />}
          {overlays.map((t) => (
            <Lane key={t.id} track={t} p={p} z={z} pad={pad} view={view} selId={selId} dv={dv} height={compact ? 30 : 32} />
          ))}
          {main && (
            <div class="tl-lane main" data-track-id={main.id} data-track-kind="main" style={{ height: `${mainH}px` }}>
              {main.clips.map((c, i) => (
                <ClipView key={c.id} clip={c} p={p} z={z} pad={pad} view={view} selected={c.id === selId} dv={dv} height={mainH} main index={i} />
              ))}
              {main.clips.slice(1).map((c) => {
                const x = pad + (c.start + (c.transition?.duration ?? 0) / 2) * z;
                return (
                  <button
                    key={`tr-${c.id}`}
                    data-tl-button
                    class={`tl-transition ${c.transition ? 'on' : ''}`}
                    style={{ left: `${x}px` }}
                    title={c.transition ? `Transition: ${transitionDef(c.transition.type).name}` : 'Add a transition'}
                    aria-label={c.transition ? `Transition: ${transitionDef(c.transition.type).name}` : 'Add a transition between these clips'}
                    data-coach="transition-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      select(c.id);
                      openPanel('transition');
                    }}
                  >
                    {c.transition ? <ArrowLeftRight size={13} /> : <Plus size={13} />}
                  </button>
                );
              })}
              <button
                data-tl-button
                class="tl-add"
                style={{ left: `${pad + dur * z + 8}px`, height: `${mainH - 8}px` }}
                onClick={(e) => {
                  e.stopPropagation();
                  void addMediaFlow();
                }}
                aria-label="Add photos or videos at the end"
                title="Add photos or videos"
              >
                <Plus size={22} />
              </button>
              {!main.clips.length && (
                <button data-tl-button class="tl-empty" style={{ left: `${pad}px` }} onClick={() => void addMediaFlow()}>
                  <Plus size={18} /> Add photos or videos
                </button>
              )}
              <TrackMute track={main} label="clip sound" />
            </div>
          )}
          {audios.map((t) => (
            <Lane key={t.id} track={t} p={p} z={z} pad={pad} view={view} selId={selId} dv={dv} height={compact ? 38 : 42} />
          ))}
          {snapLine !== null && <div class="tl-snap" style={{ left: `${pad + snapLine * z}px` }} />}
          {reorderMark && (
            <>
              <div class="tl-insert" style={{ left: `${reorderMark.x}px` }} />
              <div class="tl-ghost" style={{ left: `${reorderMark.ghostX - 30}px`, height: `${mainH - 10}px` }}>
                <ClipThumbStatic clip={findClip(p, reorderMark.id)?.clip as MediaClip | undefined} />
              </div>
            </>
          )}
        </div>
      </div>
      <div class="tl-playhead" aria-hidden="true" />
    </div>
  );
}

function TrackMute({ track, label }: { track: Track; label: string }) {
  return (
    <button
      data-tl-button
      class={`tl-mute ${track.muted ? 'on' : ''}`}
      title={track.muted ? `Turn ${label} on` : `Turn ${label} off`}
      aria-label={track.muted ? `Turn ${label} on` : `Turn ${label} off`}
      onClick={(e) => {
        e.stopPropagation();
        commit(track.muted ? 'Sound on' : 'Sound off', (q) => setTrackProps(q, track.id, { muted: !track.muted }));
      }}
    >
      {track.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
    </button>
  );
}

function Lane(props: { track: Track; p: Project; z: number; pad: number; view: [number, number]; selId: string | null; dv: number; height: number }) {
  const { track } = props;
  return (
    <div class={`tl-lane ${track.kind}`} data-track-id={track.id} data-track-kind={track.kind} style={{ height: `${props.height}px` }}>
      {track.clips.map((c) => (
        <ClipView key={c.id} clip={c} p={props.p} z={props.z} pad={props.pad} view={props.view} selected={c.id === props.selId} dv={props.dv} height={props.height} />
      ))}
      {track.kind === 'audio' && <TrackMute track={track} label="music" />}
    </div>
  );
}

function clipLabel(p: Project, c: Clip): string {
  if (c.type === 'text') return c.text.split('\n')[0] || 'Text';
  if (c.type === 'sticker') return c.emoji;
  if (c.type === 'shape') return 'Shape';
  return p.assets[c.assetId]?.name ?? 'Media';
}

function ClipView(props: {
  clip: Clip;
  p: Project;
  z: number;
  pad: number;
  view: [number, number];
  selected: boolean;
  dv: number;
  height: number;
  main?: boolean;
  index?: number;
}) {
  const { clip, p, z, pad, view } = props;
  const left = pad + clip.start * z;
  const width = Math.max(4, clip.duration * z);
  const asset = clip.type === 'media' ? p.assets[clip.assetId] : undefined;
  const kind = clip.type === 'media' ? (asset?.kind === 'audio' ? 'audio' : asset?.kind === 'image' ? 'photo' : 'video') : clip.type;
  const visible = clip.start + clip.duration >= view[0] && clip.start <= view[1];
  return (
    <div
      class={`tl-clip k-${kind} ${props.selected ? 'selected' : ''}`}
      data-clip-id={clip.id}
      style={{ left: `${left}px`, width: `${width}px` }}
      role="button"
      tabIndex={0}
      aria-label={`${kind} ${clipLabel(p, clip)}, ${formatDuration(clip.duration)}${props.selected ? ', selected' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select(clip.id);
        }
      }}
    >
      {visible && clip.type === 'media' && asset && asset.kind !== 'audio' && props.main && (
        <Filmstrip clip={clip} z={z} view={view} height={props.height} dv={props.dv} />
      )}
      {visible && clip.type === 'media' && asset && (asset.kind === 'audio' || (props.main && asset.hasAudio)) && (
        <Waveform
          clip={clip}
          zoom={z}
          view={view}
          height={asset.kind === 'audio' ? props.height - 14 : 14}
          color={asset.kind === 'audio' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.55)'}
          version={props.dv}
        />
      )}
      {!props.main && (
        <span class="tl-clip-label">
          {kind === 'text' && <Type size={13} />}
          {kind === 'shape' && <Shapes size={13} />}
          {kind === 'audio' && <Music size={13} />}
          {(kind === 'photo' || kind === 'video') && <ImageIcon size={13} />}
          <span>{clipLabel(p, clip)}</span>
        </span>
      )}
      {props.main && clip.type === 'media' && clip.speed !== 1 && <span class="tl-badge">{clip.speed}×</span>}
      {props.selected && (
        <>
          <div class="trim-handle start" data-trim="start" aria-label="Drag to cut the start" />
          <div class="trim-handle end" data-trim="end" aria-label="Drag to cut the end" />
          <span class="tl-duration">{formatDuration(clip.duration)}</span>
        </>
      )}
    </div>
  );
}

function Filmstrip(props: { clip: MediaClip; z: number; view: [number, number]; height: number; dv: number }) {
  const { clip, z, view } = props;
  const urls = thumbUrls(clip.assetId);
  const d = derived(clip.assetId);
  if (!urls.length || !d) return <div class="tl-filmstrip placeholder" />;
  const isPhoto = d.thumbInterval === 0;
  if (isPhoto) {
    return <div class="tl-filmstrip" style={{ backgroundImage: `url(${urls[0]})`, backgroundSize: `auto 100%` }} />;
  }
  const tileW = Math.max(24, props.height * 0.9);
  const visStart = Math.max(clip.start, view[0]);
  const visEnd = Math.min(clip.start + clip.duration, view[1]);
  const first = Math.max(0, Math.floor(((visStart - clip.start) * z) / tileW));
  const last = Math.ceil(((visEnd - clip.start) * z) / tileW);
  const tiles = [];
  for (let i = first; i < last; i++) {
    const tl = ((i + 0.5) * tileW) / z;
    const src = clip.in + tl * clip.speed;
    const idx = Math.min(urls.length - 1, Math.max(0, Math.floor(src / d.thumbInterval)));
    tiles.push(<div key={i} class="tl-tile" style={{ left: `${i * tileW}px`, width: `${tileW}px`, backgroundImage: `url(${urls[idx]})` }} />);
  }
  return <div class="tl-filmstrip">{tiles}</div>;
}

function ClipThumbStatic({ clip }: { clip?: MediaClip }) {
  if (!clip) return null;
  const urls = thumbUrls(clip.assetId);
  return <div class="tl-ghost-img" style={{ backgroundImage: urls[0] ? `url(${urls[0]})` : undefined }} />;
}
