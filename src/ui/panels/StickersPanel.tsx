import { useState } from 'preact/hooks';
import { STICKER_CATEGORIES } from '../../model/catalog';
import type { ShapeKind, StickerClip } from '../../model/types';
import { addShape, addSticker, updateClipById } from '../../state/actions';
import { selectedClip } from '../../state/store';
import { ShapeIcon } from './ShapePanel';

const SHAPES: { kind: ShapeKind; name: string }[] = [
  { kind: 'rect', name: 'Box' },
  { kind: 'rounded', name: 'Rounded box' },
  { kind: 'ellipse', name: 'Circle' },
  { kind: 'triangle', name: 'Triangle' },
  { kind: 'star', name: 'Star' },
  { kind: 'heart', name: 'Heart' },
  { kind: 'arrow', name: 'Arrow' },
  { kind: 'line', name: 'Line' },
  { kind: 'bubble', name: 'Speech bubble' },
];

export function StickersPanel() {
  const [cat, setCat] = useState('popular');
  const sel = selectedClip.value;
  const replacing = sel?.type === 'sticker' ? (sel as StickerClip) : null;
  const category = STICKER_CATEGORIES.find((c) => c.id === cat);
  return (
    <div class="panel">
      {replacing && <p class="faint">Tap a sticker to swap it.</p>}
      <div class="chips scroll-x nowrap" role="tablist">
        {STICKER_CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} class={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>
            {c.emoji[0]} {c.name}
          </button>
        ))}
        {!replacing && (
          <button role="tab" aria-selected={cat === 'shapes'} class={`chip ${cat === 'shapes' ? 'on' : ''}`} onClick={() => setCat('shapes')}>
            ◆ Shapes
          </button>
        )}
      </div>
      {cat === 'shapes' ? (
        <div class="shape-grid">
          {SHAPES.map((s) => (
            <button key={s.kind} class="shape-tile" onClick={() => addShape(s.kind)} aria-label={`Add ${s.name}`} title={s.name}>
              <ShapeIcon kind={s.kind} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div class="emoji-grid">
          {category?.emoji.map((e) => (
            <button
              key={e}
              class="emoji-tile"
              aria-label={`Sticker ${e}`}
              onClick={() => {
                if (replacing) updateClipById(replacing.id, 'Change sticker', { emoji: e } as Partial<StickerClip>);
                else addSticker(e);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
