import { useRef, useState } from 'preact/hooks';
import { Circle, CircleDot, Diamond, Pause, Play, SkipBack, SkipForward } from 'lucide-preact';
import { EASES } from '../model/animation';
import type { Ease, ID } from '../model/types';
import {
  allKeyTimes,
  deleteKeyTimes,
  endGesture3d,
  insertKeys,
  moveKeyTimes,
  setKeyEase,
  setTime,
  togglePlay,
} from '../state/actions3d';
import { autoKey, playing3d, scene3d, selection3d, time3d } from '../state/store3d';

function fmtTime(t: number, fps: number): string {
  const s = Math.floor(t);
  const f = Math.floor((t - s) * fps + 1e-6);
  return `${s}:${String(f).padStart(2, '0')}`;
}

/**
 * Timeline with a dope sheet: one row of keyframe diamonds per selected object.
 * Click a diamond to select it (Shift for more), drag to move, right-click or long
 * press to change easing, Delete to remove.
 */
export function Timeline3D(props: { compact: boolean }) {
  const s = scene3d.value!;
  const t = time3d.value;
  const sel = selection3d.value;
  const fps = s.render.fps;
  const start = s.anim.start;
  const end = Math.max(s.anim.end, start + 0.5);
  const track = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [easeMenu, setEaseMenu] = useState<{ x: number; y: number } | null>(null);
  const rows: { id: ID; name: string; times: number[] }[] = sel.ids
    .map((id) => s.objects[id])
    .filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => ({ id: o.id, name: o.name, times: allKeyTimes([o.id]) }));
  const summary = allKeyTimes(sel.ids);
  const pct = (x: number) => `${((x - start) / (end - start)) * 100}%`;

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const raw = start + k * (end - start);
    return Math.round(raw * fps) / fps;
  };

  const scrub = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    if (playing3d.peek()) playing3d.value = false;
    setTime(timeAt(e.clientX));
    const move = (ev: PointerEvent) => setTime(timeAt(ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const dragKey = (e: PointerEvent, time: number) => {
    e.stopPropagation();
    if (e.button === 2) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const chosen = e.shiftKey
      ? picked.includes(time)
        ? picked.filter((x) => x !== time)
        : [...picked, time]
      : picked.includes(time)
        ? picked
        : [time];
    setPicked(chosen);
    const x0 = e.clientX;
    const t0 = timeAt(e.clientX);
    let moved = 0;
    let lastDt = 0;
    const press = window.setTimeout(() => {
      if (!moved) setEaseMenu({ x: e.clientX, y: e.clientY });
    }, 550);
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) < 4 && !moved) return;
      moved++;
      window.clearTimeout(press);
      const dt = timeAt(ev.clientX) - t0;
      if (Math.abs(dt - lastDt) < 1e-9) return;
      // Move by the difference since the last step (keys are matched by their current time).
      const cur = chosen.map((x) => x + lastDt);
      moveKeyTimes(sel.ids, cur, dt - lastDt, 'dope-drag');
      lastDt = dt;
    };
    const up = () => {
      window.clearTimeout(press);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      endGesture3d();
      if (moved) setPicked(chosen.map((x) => Math.round((x + lastDt) * 1000) / 1000));
      else setTime(time);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const ticks: number[] = [];
  const span = end - start;
  const stepT = span <= 3 ? 0.5 : span <= 10 ? 1 : span <= 30 ? 5 : span <= 120 ? 10 : 30;
  for (let x = Math.ceil(start / stepT) * stepT; x <= end + 1e-6; x += stepT) ticks.push(x);

  return (
    <section
      class={`timeline3d ${props.compact ? 'compact' : ''}`}
      aria-label="Timeline"
      data-coach="timeline3d"
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && picked.length) {
          e.stopPropagation();
          deleteKeyTimes(sel.ids, picked);
          setPicked([]);
        }
      }}
    >
      <div class="tl3-bar">
        <button class="icon-btn small" aria-label="Go to start" onClick={() => setTime(start)}>
          <SkipBack size={17} />
        </button>
        <button
          class="play-btn small"
          aria-label={playing3d.value ? 'Pause' : 'Play'}
          title="Play / pause (Space)"
          onClick={togglePlay}
        >
          {playing3d.value ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button class="icon-btn small" aria-label="Go to end" onClick={() => setTime(end)}>
          <SkipForward size={17} />
        </button>
        <span class="time tl3-time">
          {fmtTime(t, fps)} <span class="faint">/ {fmtTime(end, fps)}</span>
        </span>
        <span class="grow" />
        <button
          class={`chip small ${autoKey.value ? 'rec on' : ''}`}
          title="Auto-key: every change becomes a keyframe"
          aria-pressed={autoKey.value}
          onClick={() => (autoKey.value = !autoKey.peek())}
        >
          {autoKey.value ? <CircleDot size={14} /> : <Circle size={14} />}{' '}
          {props.compact ? '' : 'Auto-key'}
        </button>
        <button
          class="chip small"
          title="Add keyframe (I)"
          disabled={!sel.ids.length}
          onClick={() => insertKeys()}
        >
          <Diamond size={14} /> {props.compact ? 'Key' : 'Add key'}
        </button>
      </div>
      <div class="tl3-body">
        {!props.compact && (
          <div class="tl3-names">
            <div class="tl3-name ruler-name" />
            {rows.length > 1 && <div class="tl3-name summary">All selected</div>}
            {rows.map((r) => (
              <div key={r.id} class="tl3-name">
                {r.name}
              </div>
            ))}
            {!rows.length && (
              <div class="tl3-name faint">Select something to see its keyframes</div>
            )}
          </div>
        )}
        <div class="tl3-track" ref={track} onPointerDown={scrub}>
          <div class="tl3-ruler">
            {ticks.map((x) => (
              <span key={x} class="tl3-tick" style={{ left: pct(x) }}>
                {Number.isInteger(x) ? `${x}s` : ''}
              </span>
            ))}
          </div>
          {(props.compact
            ? [{ id: 'all', name: '', times: summary }]
            : rows.length > 1
              ? [{ id: 'all', name: '', times: summary }, ...rows]
              : rows
          ).map((r) => (
            <div key={r.id} class={`tl3-row ${r.id === 'all' ? 'summary' : ''}`}>
              {r.times.map((k) => (
                <button
                  key={k}
                  class={`tl3-key ${picked.some((p) => Math.abs(p - k) < 1e-3) ? 'on' : ''}`}
                  style={{ left: pct(k) }}
                  aria-label={`Keyframe at ${fmtTime(k, fps)}`}
                  onPointerDown={(e) => dragKey(e, k)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!picked.includes(k)) setPicked([k]);
                    setEaseMenu({ x: e.clientX, y: e.clientY });
                  }}
                />
              ))}
            </div>
          ))}
          <div class="tl3-head" style={{ left: pct(t) }} />
        </div>
      </div>
      {easeMenu && picked.length > 0 && (
        <div
          class="menu ease-menu"
          style={{ left: `${easeMenu.x}px`, top: `${easeMenu.y}px` }}
          onPointerLeave={() => setEaseMenu(null)}
        >
          <div class="menu-title">After this keyframe…</div>
          {EASES.map((e) => (
            <button
              key={e.id}
              title={e.hint}
              onClick={() => {
                setKeyEase(picked, e.id as Ease);
                setEaseMenu(null);
              }}
            >
              {e.name}
              <small class="faint"> {e.hint}</small>
            </button>
          ))}
          <button
            class="danger"
            onClick={() => {
              deleteKeyTimes(sel.ids, picked);
              setPicked([]);
              setEaseMenu(null);
            }}
          >
            Delete keyframe{picked.length > 1 ? 's' : ''}
          </button>
        </div>
      )}
    </section>
  );
}
