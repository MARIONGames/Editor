import { effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { Camera, Eye, EyeOff, Grid3x3, Magnet, Scan, View } from 'lucide-preact';
import { Viewport, type ViewportHost } from '../engine/viewport';
import {
  enterEditMode,
  exitEditMode,
  finish3d,
  live3d,
  selectElements,
  selectObjects,
} from '../state/actions3d';
import { setSceneCoverProvider } from '../state/persist3d';
import {
  autoKey,
  editSel,
  lookThrough,
  modalStatus,
  mode3d,
  orientation,
  orthoView,
  overlays,
  pivotMode,
  scene3d,
  selection3d,
  selectMode,
  shading,
  snap3d,
  time3d,
  tool3d,
} from '../state/store3d';
import { AdjustPanel } from './AdjustPanel';
import { contextMenu3d, isLightTheme, viewportRef, viewVersion } from './viewportRef';

export function ViewportView(props: { compact: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current!;
    const h: ViewportHost = {
      selectObjects: (ids, how) => selectObjects(ids, how),
      selectElements: (ids, how) => selectElements(ids, how),
      live: (s) => live3d(s),
      finish: (label, before, after) => finish3d(label, before, after),
      status: (t) => (modalStatus.value = t),
      doubleClick: (id) => {
        const s = scene3d.peek();
        if (mode3d.peek() === 'edit') {
          if (!id) exitEditMode();
          return;
        }
        if (id && s?.objects[id]?.kind === 'mesh') {
          selectObjects([id], 'set');
          enterEditMode();
        }
      },
      contextMenu: (x, y) => (contextMenu3d.value = { x, y }),
      viewChanged: () => {
        if (lookThrough.peek()) viewVersion.value = viewVersion.peek() + 1;
      },
    };
    const vp = new Viewport(el, h);
    viewportRef.current = vp;
    const stop = effect(() => {
      const scene = scene3d.value;
      if (!scene) return;
      const sel = selection3d.value;
      vp.setState({
        scene,
        selected: sel.ids,
        active: sel.active,
        mode: mode3d.value,
        editSel: editSel.value,
        selectMode: selectMode.value,
        time: time3d.value,
        shading: shading.value,
        overlays: overlays.value,
        tool: tool3d.value,
        snap: snap3d.value,
        orientation: orientation.value,
        pivot: pivotMode.value,
        autoKey: autoKey.value,
        lookThrough: lookThrough.value,
        light: isLightTheme.value,
      });
      viewVersion.value = viewVersion.peek() + 1;
    });
    const stopOrtho = effect(() => vp.setOrtho(orthoView.value));
    setSceneCoverProvider(() => vp.cover());
    return () => {
      stop();
      stopOrtho();
      setSceneCoverProvider(null);
      vp.dispose();
      viewportRef.current = null;
    };
  }, []);

  return (
    <div class="vp-wrap">
      <div class="vp" ref={host} data-coach="viewport3d" />
      <ViewHeader compact={props.compact} />
      <CameraFrame />
      {modalStatus.value && (
        <div class="vp-status" role="status">
          {modalStatus.value}
          <span class="faint"> · type a number · X/Y/Z lock an axis · Enter done · Esc cancel</span>
        </div>
      )}
      <AdjustPanel />
    </div>
  );
}

/** Small floating controls on the viewport: shading, overlays, snapping, camera. */
function ViewHeader(props: { compact: boolean }) {
  const sh = shading.value;
  const ov = overlays.value;
  const snap = snap3d.value;
  const shadingOpts = [
    { id: 'solid', label: 'Clay', title: 'Clay: plain grey, best for shaping' },
    { id: 'material', label: 'Look', title: 'Look: real materials in a studio light' },
    {
      id: 'rendered',
      label: 'Final',
      title: 'Final: your lights, world and shadows — what renders',
    },
  ] as const;
  return (
    <div class={`vp-header ${props.compact ? 'compact' : ''}`}>
      <div class="vp-pills" role="radiogroup" aria-label="How the view looks">
        {shadingOpts.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={sh === o.id}
            class={sh === o.id ? 'on' : ''}
            title={o.title}
            onClick={() => (shading.value = o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div class="vp-tools">
        <button
          class={`vp-btn ${ov.wire ? 'on' : ''}`}
          title="Show edges (wireframe)"
          aria-pressed={ov.wire}
          onClick={() => (overlays.value = { ...ov, wire: !ov.wire })}
        >
          <Grid3x3 size={17} />
        </button>
        <button
          class={`vp-btn ${ov.xray ? 'on' : ''}`}
          title="X-ray: see and select through the surface (Alt+Z)"
          aria-pressed={ov.xray}
          onClick={() => (overlays.value = { ...ov, xray: !ov.xray })}
        >
          {ov.xray ? <Eye size={17} /> : <EyeOff size={17} />}
        </button>
        <button
          class={`vp-btn ${snap.on ? 'on' : ''}`}
          title="Snap to steps (hold Ctrl to flip)"
          aria-pressed={snap.on}
          onClick={() => (snap3d.value = { ...snap, on: !snap.on })}
        >
          <Magnet size={17} />
        </button>
        <button
          class={`vp-btn ${orthoView.value ? 'on' : ''}`}
          title="Flat view without perspective (numpad 5)"
          aria-pressed={orthoView.value}
          onClick={() => (orthoView.value = !orthoView.value)}
        >
          <View size={17} />
        </button>
        <button
          class={`vp-btn ${lookThrough.value ? 'on' : ''}`}
          title="Look through the camera (numpad 0)"
          aria-pressed={lookThrough.value}
          onClick={() => (lookThrough.value = !lookThrough.value)}
        >
          <Camera size={17} />
        </button>
        <button
          class="vp-btn"
          title="Frame everything (Home)"
          onClick={() =>
            viewportRef.current?.frame(
              selection3d.peek().ids.length ? selection3d.peek().ids : undefined,
            )
          }
        >
          <Scan size={17} />
        </button>
      </div>
    </div>
  );
}

/** Darkens everything outside the render frame while looking through the camera. */
function CameraFrame() {
  void viewVersion.value;
  if (!lookThrough.value) return null;
  const f = viewportRef.current?.cameraFrame();
  if (!f) return null;
  return (
    <div
      class="vp-frame"
      style={{ left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` }}
    >
      <span class="vp-frame-label">
        Camera view · {scene3d.value?.render.width}×{scene3d.value?.render.height}
      </span>
    </div>
  );
}
