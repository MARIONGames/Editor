import type { FunctionComponent } from 'preact';
import { Check, X } from 'lucide-preact';
import { TOOL_TEXT } from '../../i18n/tools';
import { isCompact, panel, project, type PanelId } from '../../state/store';
import { AdjustPanel } from './AdjustPanel';
import { FiltersPanel } from './FiltersPanel';
import { TextPanel } from './TextPanel';
import { StickersPanel } from './StickersPanel';
import { TransitionPanel } from './TransitionPanel';
import { AnimationPanel } from './AnimationPanel';
import { SpeedPanel, VolumePanel } from './SpeedVolumePanels';
import { CropPanel } from './CropPanel';
import { TransformPanel } from './TransformPanel';
import { CanvasPanel } from './CanvasPanel';
import { MagicPanel } from './MagicPanel';
import { LayersPanel } from './LayersPanel';
import { GreenScreenPanel } from './GreenScreenPanel';
import { ShapePanel } from './ShapePanel';
import { NextSteps } from '../../coach/NextSteps';
import { endGesture } from '../../state/actions';

const PANELS: Partial<Record<PanelId, { title: string; hint: string; Comp: FunctionComponent }>> = {
  adjust: { ...pick('adjust'), Comp: AdjustPanel },
  filters: { ...pick('filters'), Comp: FiltersPanel },
  text: { ...pick('text'), Comp: TextPanel },
  stickers: { ...pick('stickers'), Comp: StickersPanel },
  transition: { ...pick('transition'), Comp: TransitionPanel },
  animation: { ...pick('animation'), Comp: AnimationPanel },
  speed: { ...pick('speed'), Comp: SpeedPanel },
  volume: { ...pick('volume'), Comp: VolumePanel },
  crop: { ...pick('crop'), Comp: CropPanel },
  transform: { ...pick('transform'), Comp: TransformPanel },
  canvas: { ...pick('canvas'), Comp: CanvasPanel },
  magic: { ...pick('magic'), Comp: MagicPanel },
  layers: { ...pick('layers'), Comp: LayersPanel },
  greenscreen: { ...pick('greenscreen'), Comp: GreenScreenPanel },
  shape: { title: 'Shape', hint: TOOL_TEXT.shape.hint, Comp: ShapePanel },
};

function pick(id: keyof typeof TOOL_TEXT) {
  return { title: TOOL_TEXT[id].label, hint: TOOL_TEXT[id].hint };
}

export function PanelHost() {
  const id = panel.value;
  const compact = isCompact.value;
  const def = id ? PANELS[id] : undefined;
  void project.value;
  const close = () => {
    endGesture();
    panel.value = null;
  };
  if (compact) {
    if (!def) return null;
    return (
      <div class="sheet" role="dialog" aria-label={def.title}>
        <div class="sheet-head">
          <div class="grow">
            <h3>{def.title}</h3>
            <p class="sheet-hint">{def.hint}</p>
          </div>
          <button class="icon-btn done-btn" onClick={close} aria-label="Done">
            <Check size={22} />
          </button>
        </div>
        <div class="sheet-body scroll-y">
          <def.Comp />
        </div>
      </div>
    );
  }
  return (
    <aside class="inspector" aria-label={def ? def.title : 'Getting started'}>
      {def ? (
        <>
          <div class="inspector-head">
            <div class="grow">
              <h3>{def.title}</h3>
              <p class="sheet-hint">{def.hint}</p>
            </div>
            <button class="icon-btn small" onClick={close} aria-label="Close panel">
              <X size={18} />
            </button>
          </div>
          <div class="inspector-body scroll-y">
            <def.Comp />
          </div>
        </>
      ) : (
        <div class="inspector-body scroll-y">
          <NextSteps />
        </div>
      )}
    </aside>
  );
}

export function NeedSelection({ what }: { what: string }) {
  return (
    <div class="empty-panel">
      <p>{what}</p>
    </div>
  );
}
