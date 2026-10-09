import { useEffect, useRef, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { busy, route } from '../state/store';
import { dialog } from '../ui/dialogs/dialogState';
import { HintBubble } from '../ui/editor/ToolDock';
import { advance, endTour, tour } from './tour';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Spotlight + callout for the tour, and the global "what is this?" hint bubble. */
export function CoachLayer() {
  const t = tour.value;
  const [rect, setRect] = useState<Rect | null>(null);
  const raf = useRef(0);
  const step = t?.steps[t.index];
  const hiddenByUi = !!dialog.value || !!busy.value || route.value.name !== 'editor';

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (!step?.target) {
      setRect(null);
      return;
    }
    let last = '';
    const loop = () => {
      const el = document.querySelector<HTMLElement>(step.target!);
      const r = el?.getBoundingClientRect();
      const visible = r && r.width > 0 && r.height > 0;
      const next = visible ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      const key = next ? `${Math.round(next.x)},${Math.round(next.y)},${Math.round(next.w)},${Math.round(next.h)}` : 'none';
      if (key !== last) {
        last = key;
        setRect(next);
      }
      raf.current = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf.current);
  }, [step]);

  return (
    <>
      <HintBubble />
      {t && step && !hiddenByUi && <Callout rect={rect} title={step.title} body={step.body} next={step.next} index={t.index} total={t.steps.length} />}
    </>
  );
}

function Callout(props: { rect: Rect | null; title: string; body: string; next?: string; index: number; total: number }) {
  const { rect } = props;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(340, vw - 24);
  let style: Record<string, string>;
  if (rect && vw < 700) {
    // Phones: put the card in the other half of the screen so it never covers what you need to tap.
    const targetLow = rect.y + rect.h / 2 > vh / 2;
    style = targetLow
      ? { left: `${(vw - cardW) / 2}px`, top: `${Math.max(64, Math.min(rect.y - 12, vh * 0.42) - 190)}px`, width: `${cardW}px` }
      : { left: `${(vw - cardW) / 2}px`, top: `${Math.min(vh - 210, rect.y + rect.h + 16)}px`, width: `${cardW}px` };
  } else if (rect) {
    const below = rect.y + rect.h + 200 < vh || rect.y < vh / 2;
    const left = Math.max(12, Math.min(vw - cardW - 12, rect.x + rect.w / 2 - cardW / 2));
    style = below
      ? { left: `${left}px`, top: `${Math.min(vh - 180, rect.y + rect.h + pad + 10)}px`, width: `${cardW}px` }
      : { left: `${left}px`, top: `${Math.max(12, rect.y - pad - 10)}px`, transform: 'translateY(-100%)', width: `${cardW}px` };
  } else {
    style = { left: `${(vw - cardW) / 2}px`, top: `${vh / 2}px`, transform: 'translateY(-50%)', width: `${cardW}px` };
  }
  return (
    <>
      {rect ? (
        <div
          class="coach-hole"
          style={{ left: `${rect.x - pad}px`, top: `${rect.y - pad}px`, width: `${rect.w + pad * 2}px`, height: `${rect.h + pad * 2}px` }}
          aria-hidden="true"
        />
      ) : (
        <div class="coach-dim" aria-hidden="true" />
      )}
      <div class="coach-card" style={style} role="dialog" aria-live="polite" aria-label={props.title}>
        <div class="row">
          <span class="coach-step">
            {props.index + 1} / {props.total}
          </span>
          <span class="grow" />
          <button class="icon-btn small" aria-label="End the tour" onClick={endTour}>
            <X size={16} />
          </button>
        </div>
        <h3>{props.title}</h3>
        <p>{props.body}</p>
        <div class="row coach-actions">
          <button class="btn small ghost" onClick={endTour}>
            Stop tour
          </button>
          {props.next && (
            <button class="btn small primary" onClick={advance}>
              {props.next}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
