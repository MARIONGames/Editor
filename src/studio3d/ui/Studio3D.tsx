import '../../styles/studio3d.css';
import { useEffect } from 'preact/hooks';
import { X } from 'lucide-preact';
import { isCompact } from '../../state/store';
import { endGesture3d } from '../state/actions3d';
import { mode3d, playing3d, scene3d, sheet3d, tab3d, time3d, type Sheet3D } from '../state/store3d';
import { AddMenu } from './AddMenu';
import { ContextMenu3D } from './ContextMenu3D';
import { Dialogs3D } from './Dialogs3D';
import { EditTools } from './EditTools';
import { Outliner } from './Outliner';
import { Properties, TAB_TITLES } from './Properties';
import { Timeline3D } from './Timeline3D';
import { BottomDock3D, MagicMenu, ToolRail } from './ToolRail';
import { TopBar3D } from './TopBar3D';
import { ViewportView } from './ViewportView';
import { useStudioShortcuts } from './shortcuts3d';
import { Coach3D } from './Coach3D';

export function Studio3D() {
  const s = scene3d.value;
  const compact = isCompact.value;
  useStudioShortcuts();
  usePlayback();
  useEffect(() => {
    document.body.classList.add('in-editor');
    return () => document.body.classList.remove('in-editor');
  }, []);
  if (!s) return <div class="editor-loading">Opening your 3D scene…</div>;
  return (
    <div class={`studio3d editor ${compact ? 'compact' : 'wide'} mode-${mode3d.value}`}>
      <TopBar3D />
      <div class="studio-body">
        {!compact && <ToolRail />}
        <div class="studio-center">
          <ViewportView compact={compact} />
          {mode3d.value === 'edit' && !compact && <EditTools />}
          <Timeline3D compact={compact} />
          {compact && <BottomDock3D />}
        </div>
        {!compact && (
          <aside class="studio-side">
            <Outliner />
            <Properties />
          </aside>
        )}
      </div>
      {compact && <PhoneSheet />}
      <ContextMenu3D />
      <Dialogs3D />
      <Coach3D />
    </div>
  );
}

const SHEET_TITLES: Record<Exclude<Sheet3D, null>, string> = {
  add: 'Add to your scene',
  outliner: 'Everything in your scene',
  props: 'Properties',
  edit: 'Edit the shape',
  magic: 'Magic',
};

/** Phone layout: one bottom sheet at a time. */
function PhoneSheet() {
  const which = sheet3d.value;
  if (!which) return null;
  const title = which === 'props' ? TAB_TITLES[tab3d.value] : SHEET_TITLES[which];
  const close = () => {
    endGesture3d();
    sheet3d.value = null;
  };
  return (
    <div class="sheet studio-sheet" role="dialog" aria-label={title}>
      <div class="sheet-head">
        <div class="grow">
          <h3>{title}</h3>
        </div>
        <button class="icon-btn done-btn" aria-label="Done" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div class="sheet-body scroll-y">
        {which === 'add' && <AddMenu onDone={close} />}
        {which === 'outliner' && <Outliner embedded />}
        {which === 'props' && <Properties embedded />}
        {which === 'edit' && <EditTools embedded />}
        {which === 'magic' && <MagicMenu onDone={close} />}
      </div>
    </div>
  );
}

/** Advances the time while playing (loops over the animation range). */
function usePlayback(): void {
  const playing = playing3d.value;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = scene3d.peek();
      if (!s) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let t = time3d.peek() + dt;
      if (t > s.anim.end)
        t = s.anim.start + ((t - s.anim.start) % Math.max(0.01, s.anim.end - s.anim.start));
      if (t < s.anim.start) t = s.anim.start;
      time3d.value = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}
