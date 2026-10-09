import { signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { Check } from 'lucide-preact';
import { select } from '../../state/actions';
import { formatDuration } from '../../model/time';
import type { Clip, Project } from '../../model/types';
import { isCompact, project, selectedClip, settings } from '../../state/store';
import { clipTools, rootTools, type ToolDef } from './tools';

/** Plain-language explanation bubble (hover on desktop, press-and-hold on touch). */
export const hintBubble = signal<{ text: string; title: string; x: number; y: number } | null>(null);

export function HintBubble() {
  const h = hintBubble.value;
  if (!h) return null;
  const left = Math.max(12, Math.min(window.innerWidth - 272, h.x - 130));
  const below = h.y < 140;
  return (
    <div class="hint-bubble" style={{ left: `${left}px`, top: `${below ? h.y + 16 : h.y - 12}px`, transform: below ? 'none' : 'translateY(-100%)' }} role="tooltip">
      <strong>{h.title}</strong>
      <span>{h.text}</span>
    </div>
  );
}

export function ToolButton({ tool, vertical }: { tool: ToolDef; vertical?: boolean }) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const show = (el: HTMLElement) => {
    if (!settings.peek().hints) return;
    const r = el.getBoundingClientRect();
    hintBubble.value = {
      title: tool.text.label,
      text: tool.text.hint,
      x: vertical ? r.right + 140 : r.left + r.width / 2,
      y: vertical ? r.top + r.height / 2 + 30 : r.top,
    };
  };
  const hide = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hintBubble.value = null;
  };
  const Icon = tool.icon;
  return (
    <button
      class={`tool ${tool.active ? 'active' : ''} ${tool.danger ? 'danger' : ''} ${tool.magic ? 'magic' : ''}`}
      data-coach={tool.coach}
      aria-label={`${tool.text.label}: ${tool.text.hint}`}
      aria-pressed={tool.active}
      onPointerDown={(e) => {
        suppressClick.current = false;
        if (e.pointerType !== 'mouse') {
          const el = e.currentTarget as HTMLElement;
          pressTimer.current = setTimeout(() => {
            suppressClick.current = true;
            show(el);
          }, 450);
        }
      }}
      onPointerUp={() => {
        if (pressTimer.current) clearTimeout(pressTimer.current);
        if (suppressClick.current) setTimeout(() => (hintBubble.value = null), 1800);
      }}
      onPointerCancel={hide}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          const el = e.currentTarget as HTMLElement;
          hoverTimer.current = setTimeout(() => show(el), 550);
        }
      }}
      onPointerLeave={hide}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        hide();
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        tool.run();
      }}
    >
      <span class="tool-icon">
        <Icon size={22} />
      </span>
      <span class="tool-label">{tool.text.label}</span>
    </button>
  );
}

/**
 * Phones: a scrollable bar at the bottom that switches to the selected clip's tools.
 * Desktop: a vertical rail with the "add things" tools.
 */
export function ToolDock({ vertical }: { vertical?: boolean }) {
  const p = project.value!;
  const clip = selectedClip.value;
  const compact = isCompact.value;
  const showClip = !!clip && compact;
  const tools = showClip ? clipTools(p, clip!) : rootTools(p);
  return (
    <nav class={`tooldock ${vertical ? 'vertical' : 'horizontal'} ${showClip ? 'clip-mode' : ''}`} aria-label="Tools">
      {showClip && (
        <button class="tool done" onClick={() => select(null)} aria-label="Done — back to all tools">
          <span class="tool-icon">
            <Check size={22} />
          </span>
          <span class="tool-label">Done</span>
        </button>
      )}
      <div class={`tooldock-items ${vertical ? '' : 'scroll-x'}`}>
        {tools.map((t) => (
          <ToolButton key={t.id} tool={t} vertical={vertical} />
        ))}
      </div>
    </nav>
  );
}

/** Desktop: a row under the picture with the selected item's tools (or a hint). */
export function SelectionBar() {
  const p = project.value!;
  const clip = selectedClip.value;
  if (!clip) {
    return (
      <div class="selbar empty">
        <span class="faint">
          {p.kind === 'video'
            ? 'Tip: tap a clip in the timeline (or anything on the picture) to cut, adjust or move it.'
            : 'Tip: tap anything on the picture to change it. Drag to move, pull a corner to resize.'}
        </span>
      </div>
    );
  }
  return (
    <div class="selbar">
      <span class="selbar-label">
        <span class="sel-dot" /> {describe(p, clip)}
      </span>
      <div class="selbar-tools scroll-x" aria-label="Tools for the selected item">
        {clipTools(p, clip).map((t) => (
          <ToolButton key={t.id} tool={t} />
        ))}
      </div>
      <button class="btn small ghost" onClick={() => select(null)}>
        Done
      </button>
    </div>
  );
}

function describe(p: Project, c: Clip): string {
  if (c.type === 'text') return 'Text';
  if (c.type === 'sticker') return `Sticker ${c.emoji}`;
  if (c.type === 'shape') return 'Shape';
  const a = p.assets[c.assetId];
  const kind = a?.kind === 'audio' ? 'Sound' : a?.kind === 'image' ? 'Photo' : 'Video clip';
  return p.kind === 'video' ? `${kind} · ${formatDuration(c.duration)}` : kind;
}
