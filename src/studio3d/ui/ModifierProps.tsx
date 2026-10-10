import { useState } from 'preact/hooks';
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Plus, Trash2 } from 'lucide-preact';
import { Slider } from '../../ui/components/Slider';
import { MODIFIER_INFO } from '../model/modifiers';
import type { Modifier, ModifierKind } from '../model/types';
import {
  addModifier,
  applyAllModifiers,
  applyModifier,
  moveModifier,
  removeModifier,
  updateModifier,
} from '../state/actions3d';
import { activeObject } from '../state/store3d';
import { Group, NothingSelected } from './Properties';

const ORDER: ModifierKind[] = [
  'subdivision',
  'mirror',
  'bevel',
  'solidify',
  'array',
  'displace',
  'decimate',
  'triangulate',
  'weld',
];

export function ModifierProps() {
  const o = activeObject.value;
  const [adding, setAdding] = useState(false);
  if (!o || o.kind !== 'mesh')
    return (
      <NothingSelected text="Effects change a shape without destroying it — smooth it, mirror it, repeat it. Select a shape first." />
    );
  return (
    <>
      <Group
        title="Effects on this shape"
        right={
          o.modifiers.length > 0 ? (
            <button
              class="chip small"
              title="Bake every effect into the shape (needed by some tools)"
              onClick={() => applyAllModifiers(o.id)}
            >
              <Check size={13} /> Apply all
            </button>
          ) : null
        }
      >
        {o.modifiers.length === 0 && (
          <p class="faint">
            No effects yet. They run top to bottom and can be changed or removed any time.
          </p>
        )}
        {o.modifiers.map((m, i) => (
          <ModifierCard
            key={m.id}
            objId={o.id}
            m={m}
            first={i === 0}
            last={i === o.modifiers.length - 1}
          />
        ))}
        <button class="btn block" data-coach="add-modifier" onClick={() => setAdding(!adding)}>
          <Plus size={18} /> Add an effect
        </button>
        {adding && (
          <div class="mod-add">
            {ORDER.map((k) => (
              <button
                key={k}
                class="mod-add-item"
                onClick={() => {
                  addModifier(k);
                  setAdding(false);
                }}
              >
                <strong>{MODIFIER_INFO[k].plain}</strong>
                <span class="faint">
                  {MODIFIER_INFO[k].plain !== MODIFIER_INFO[k].name
                    ? `${MODIFIER_INFO[k].name} · `
                    : ''}
                  {MODIFIER_INFO[k].hint}
                </span>
              </button>
            ))}
          </div>
        )}
      </Group>
    </>
  );
}

function ModifierCard(props: { objId: string; m: Modifier; first: boolean; last: boolean }) {
  const { objId, m } = props;
  const info = MODIFIER_INFO[m.kind];
  const set = (patch: Partial<Modifier>) => updateModifier(objId, m.id, patch);
  return (
    <div class={`mod-card ${m.enabled ? '' : 'off'}`}>
      <div class="mod-head">
        <button
          class="icon-btn small"
          title={m.enabled ? 'Turn off' : 'Turn on'}
          aria-label={m.enabled ? 'Turn off' : 'Turn on'}
          onClick={() => updateModifier(objId, m.id, { enabled: !m.enabled }, false)}
        >
          {m.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <strong class="grow" title={info.hint}>
          {info.plain}
          {info.plain !== info.name && <span class="faint"> · {info.name}</span>}
        </strong>
        <button
          class="icon-btn small"
          aria-label="Move up"
          disabled={props.first}
          onClick={() => moveModifier(objId, m.id, -1)}
        >
          <ArrowUp size={15} />
        </button>
        <button
          class="icon-btn small"
          aria-label="Move down"
          disabled={props.last}
          onClick={() => moveModifier(objId, m.id, 1)}
        >
          <ArrowDown size={15} />
        </button>
        <button
          class="icon-btn small"
          title="Apply: bake it into the shape"
          aria-label="Apply"
          onClick={() => applyModifier(objId, m.id)}
        >
          <Check size={15} />
        </button>
        <button
          class="icon-btn small"
          aria-label="Remove"
          onClick={() => removeModifier(objId, m.id)}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div class="mod-body">
        {m.kind === 'subdivision' && (
          <Slider
            label="Smoothness"
            hint="Each level makes 4× more faces"
            value={m.levels}
            min={0}
            max={4}
            step={1}
            defaultValue={2}
            onChange={(v) => set({ levels: v })}
          />
        )}
        {m.kind === 'mirror' && (
          <>
            <div class="chips">
              {(['X', 'Y', 'Z'] as const).map((ax, i) => (
                <button
                  key={ax}
                  class={`chip ${m.axes[i] ? 'on' : ''}`}
                  onClick={() => {
                    const axes = [...m.axes] as [boolean, boolean, boolean];
                    axes[i] = !axes[i];
                    set({ axes });
                  }}
                >
                  Across {ax}
                </button>
              ))}
            </div>
            <Slider
              label="Join distance"
              value={m.merge}
              min={0}
              max={0.1}
              step={0.0005}
              defaultValue={0.001}
              format={(v) => `${(v * 1000).toFixed(1)} mm`}
              onChange={(v) => set({ merge: v })}
            />
          </>
        )}
        {m.kind === 'array' && (
          <>
            <Slider
              label="Copies"
              value={m.count}
              min={1}
              max={50}
              step={1}
              defaultValue={3}
              onChange={(v) => set({ count: v })}
            />
            {(['X', 'Y', 'Z'] as const).map((ax, i) => (
              <Slider
                key={ax}
                label={`Gap ${ax}`}
                hint={i === 0 ? '1 = side by side, touching' : undefined}
                value={m.relative[i]!}
                min={-3}
                max={3}
                step={0.01}
                defaultValue={i === 0 ? 1.1 : 0}
                onChange={(v) => {
                  const relative = [...m.relative] as [number, number, number];
                  relative[i] = v;
                  set({ relative });
                }}
              />
            ))}
          </>
        )}
        {m.kind === 'solidify' && (
          <Slider
            label="Thickness"
            value={m.thickness}
            min={-1}
            max={1}
            step={0.005}
            defaultValue={0.1}
            format={(v) => `${(v * 100).toFixed(1)} cm`}
            onChange={(v) => set({ thickness: v })}
          />
        )}
        {m.kind === 'bevel' && (
          <>
            <Slider
              label="Width"
              value={m.width}
              min={0.001}
              max={0.5}
              step={0.001}
              defaultValue={0.08}
              format={(v) => `${(v * 100).toFixed(1)} cm`}
              onChange={(v) => set({ width: v })}
            />
            <Slider
              label="Only edges sharper than"
              value={m.angle}
              min={0}
              max={180}
              step={1}
              defaultValue={30}
              format={(v) => `${Math.round(v)}°`}
              onChange={(v) => set({ angle: v })}
            />
          </>
        )}
        {m.kind === 'decimate' && (
          <Slider
            label="Keep"
            hint="Share of triangles to keep — great for game LODs"
            value={m.ratio}
            min={0.01}
            max={1}
            step={0.01}
            defaultValue={0.5}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ ratio: v })}
          />
        )}
        {m.kind === 'weld' && (
          <Slider
            label="Distance"
            value={m.distance}
            min={0}
            max={0.1}
            step={0.0005}
            defaultValue={0.001}
            format={(v) => `${(v * 1000).toFixed(1)} mm`}
            onChange={(v) => set({ distance: v })}
          />
        )}
        {m.kind === 'displace' && (
          <>
            <Slider
              label="Strength"
              value={m.strength}
              min={-1}
              max={1}
              step={0.005}
              defaultValue={0.15}
              onChange={(v) => set({ strength: v })}
            />
            <Slider
              label="Bump size"
              value={m.scale}
              min={0.02}
              max={5}
              step={0.01}
              defaultValue={0.5}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => set({ scale: v })}
            />
            <Slider
              label="Pattern"
              value={m.seed}
              min={1}
              max={100}
              step={1}
              defaultValue={1}
              onChange={(v) => set({ seed: v })}
            />
          </>
        )}
        {m.kind === 'triangulate' && (
          <p class="faint">
            Every face becomes triangles, exactly like a game engine would draw it.
          </p>
        )}
        {m.kind === 'subdivision' && m.levels >= 3 && (
          <p class="faint">
            Level {m.levels} is heavy: phones may slow down. 2 is enough while you work.
          </p>
        )}
      </div>
    </div>
  );
}
