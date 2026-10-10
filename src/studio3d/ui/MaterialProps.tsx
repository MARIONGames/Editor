import { useState } from 'preact/hooks';
import { Copy, ImagePlus, Plus, X } from 'lucide-preact';
import { peekUrl } from '../../engine/media/mediaStore';
import { ColorSwatches, Switch } from '../../ui/components/Controls';
import { Slider } from '../../ui/components/Slider';
import { MATERIAL_PRESETS } from '../model/materials';
import type { Material3D, MeshObj, Scene3D, TextureSlot } from '../model/types';
import { importTextureFlow } from '../io/import3d';
import {
  addMaterialSlot,
  applyMaterialPreset,
  assignSlotToFaces,
  makeMaterialUnique,
  setMaterialPresetOn,
  setTexture,
  updateMaterial,
} from '../state/actions3d';
import { activeObject, mode3d, scene3d } from '../state/store3d';
import { Group, NothingSelected } from './Properties';

const GROUPS = ['Basic', 'Metal', 'Glass & liquid', 'Special'] as const;

const SLOT_INFO: { slot: TextureSlot; name: string; hint: string }[] = [
  { slot: 'color', name: 'Color (albedo)', hint: 'The picture painted on the surface' },
  {
    slot: 'normal',
    name: 'Bumps (normal)',
    hint: 'Fake small details like scratches, pores or bricks',
  },
  { slot: 'roughness', name: 'Roughness', hint: 'White = rough/dull, black = glossy' },
  { slot: 'metalness', name: 'Metal', hint: 'White = metal, black = not metal' },
  { slot: 'ao', name: 'Shadows in cracks (AO)', hint: 'Darkens creases (ambient occlusion)' },
  { slot: 'emissive', name: 'Glow', hint: 'Parts that light up' },
  { slot: 'opacity', name: 'See-through mask', hint: 'Black = invisible (leaves, fences)' },
];

/** A small sphere-ish preview of a material made with CSS (no extra 3D render). */
export function matPreview(m: Partial<Material3D>): string {
  const c = m.color ?? '#c8c8cc';
  const glow =
    m.emissive && m.emissive !== '#000000' && (m.emissiveIntensity ?? 0) > 0 ? m.emissive : null;
  const metal = (m.metalness ?? 0) > 0.5;
  const rough = m.roughness ?? 0.5;
  const hi = metal ? 'rgba(255,255,255,0.95)' : `rgba(255,255,255,${0.75 - rough * 0.6})`;
  const glass = (m.transmission ?? 0) > 0.5;
  if (glow)
    return `radial-gradient(circle at 35% 30%, #fff 0%, ${glow} 35%, ${glow} 70%, rgba(0,0,0,0.4) 100%)`;
  if (glass)
    return `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0 8%, transparent 22%), radial-gradient(circle at 60% 70%, ${c}55 0%, ${c}22 60%, rgba(0,0,0,0.25) 100%)`;
  return `radial-gradient(circle at 32% 28%, ${hi} 0%, transparent ${metal ? 20 : 34}%), radial-gradient(circle at 50% 50%, ${c} 0%, ${c} 55%, rgba(0,0,0,0.55) 100%), ${c}`;
}

function usageOf(s: Scene3D, id: string): number {
  let n = 0;
  for (const o of Object.values(s.objects)) if (o.kind === 'mesh' && o.materials.includes(id)) n++;
  return n;
}

export function MaterialProps() {
  const o = activeObject.value;
  const s = scene3d.value!;
  const [slot, setSlot] = useState(0);
  if (!o || o.kind !== 'mesh')
    return (
      <NothingSelected
        text={
          o
            ? 'Lights, cameras and imported models get their look elsewhere — pick a shape to give it a material.'
            : 'Select a shape to change how it looks: color, shine, metal, glass, glow.'
        }
      />
    );
  const slots = o.materials.length ? o.materials : [''];
  const si = Math.min(slot, slots.length - 1);
  const mat = s.materials[slots[si] ?? ''];
  const editing = mode3d.value === 'edit';
  const shared = mat ? usageOf(s, mat.id) > 1 : false;

  const pickPreset = (id: string) => {
    if (mat && !shared) setMaterialPresetOn(mat.id, id);
    else applyMaterialPreset(id);
  };

  return (
    <>
      {(slots.length > 1 || editing) && (
        <Group
          title="Material slots"
          right={
            <button
              class="icon-btn small"
              title="Add a slot (a second material on the same object)"
              onClick={() => addMaterialSlot(o.id)}
            >
              <Plus size={16} />
            </button>
          }
        >
          <div class="slot-list">
            {slots.map((id, i) => {
              const m = s.materials[id];
              return (
                <button
                  key={`${id}-${i}`}
                  class={`slot-row ${i === si ? 'on' : ''}`}
                  onClick={() => setSlot(i)}
                >
                  <span class="mat-dot" style={{ background: m ? matPreview(m) : '#888' }} />
                  <span class="grow">{m?.name ?? 'No material'}</span>
                </button>
              );
            })}
          </div>
          {editing && (
            <button class="btn small block" onClick={() => assignSlotToFaces(o.id, si)}>
              Use this slot on the selected faces
            </button>
          )}
        </Group>
      )}

      <Group title="Pick a look" right={mat && shared ? <SharedBadge o={o} slot={si} /> : null}>
        {GROUPS.map((g) => (
          <div key={g} class="preset-group">
            <div class="field-label">{g}</div>
            <div class="mat-presets">
              {MATERIAL_PRESETS.filter((p) => p.group === g).map((p) => (
                <button
                  key={p.id}
                  class="mat-preset"
                  title={p.hint}
                  onClick={() => pickPreset(p.id)}
                  data-coach={`mat-${p.id}`}
                >
                  <span class="mat-ball" style={{ background: matPreview(p.props) }} />
                  <span class="mat-name">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </Group>

      {mat ? (
        <MaterialEditor mat={mat} />
      ) : (
        <p class="faint">This slot has no material yet: pick a look above.</p>
      )}
    </>
  );
}

function SharedBadge(props: { o: MeshObj; slot: number }) {
  return (
    <button
      class="chip small"
      title="Other objects use this material too. Make a copy just for this one."
      onClick={() => makeMaterialUnique(props.o.id, props.slot)}
    >
      <Copy size={13} /> Shared — make unique
    </button>
  );
}

function MaterialEditor(props: { mat: Material3D }) {
  const m = props.mat;
  const set = (patch: Partial<Material3D>, key?: string) => updateMaterial(m.id, patch, key);
  const s = scene3d.value!;
  return (
    <>
      <Group title={<span>Material: {m.name}</span>}>
        <div class="field-label">Color</div>
        <ColorSwatches value={m.color} onChange={(c) => set({ color: c }, 'color')} />
        <Slider
          label="Metal"
          hint="Metals reflect their surroundings in their own color"
          value={m.metalness}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          onChange={(v) => set({ metalness: v }, 'metal')}
        />
        <Slider
          label="Roughness"
          hint="Low = shiny and sharp reflections, high = dull"
          value={m.roughness}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0.5}
          onChange={(v) => set({ roughness: v }, 'rough')}
        />
        <Slider
          label="Clear coat"
          hint="A glossy varnish on top (car paint, lacquer)"
          value={m.clearcoat}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          onChange={(v) => set({ clearcoat: v }, 'coat')}
        />
        <Slider
          label="Fabric sheen"
          hint="Soft velvet-like edges"
          value={m.sheen}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          onChange={(v) => set({ sheen: v }, 'sheen')}
        />
      </Group>
      <Group title="Glass & glow">
        <Slider
          label="Glass"
          hint="Light passes through and bends (transmission)"
          value={m.transmission}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          onChange={(v) => set({ transmission: v }, 'trans')}
        />
        {m.transmission > 0 && (
          <Slider
            label="Bend (IOR)"
            hint="Water 1.33 · glass 1.5 · diamond 2.42"
            value={m.ior}
            min={1}
            max={2.5}
            step={0.01}
            defaultValue={1.5}
            onChange={(v) => set({ ior: v }, 'ior')}
          />
        )}
        <Slider
          label="See-through"
          hint="Fades the whole object (opacity)"
          value={1 - m.opacity}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          onChange={(v) => set({ opacity: 1 - v }, 'opacity')}
        />
        <div class="field-label">Glow color</div>
        <ColorSwatches
          value={m.emissive}
          colors={[
            '#000000',
            '#ffffff',
            '#ffd59a',
            '#ff2bd6',
            '#3fd0ff',
            '#3ddc84',
            '#ff4d4d',
            '#7c5cff',
          ]}
          onChange={(c) => set({ emissive: c }, 'emissive')}
        />
        {m.emissive !== '#000000' && (
          <Slider
            label="Glow strength"
            value={m.emissiveIntensity}
            min={0}
            max={20}
            step={0.1}
            defaultValue={1}
            onChange={(v) => set({ emissiveIntensity: v }, 'emissive-int')}
          />
        )}
        <Switch
          label="Both sides"
          hint="Show the back of thin surfaces like leaves or paper"
          checked={m.doubleSided}
          onChange={(v) => set({ doubleSided: v })}
        />
      </Group>
      <Group title="Textures (images)">
        {SLOT_INFO.map((t) => {
          const texId = m.maps[t.slot];
          const ref = texId ? s.textures[texId] : undefined;
          const url = ref ? peekUrl(ref.assetId) : undefined;
          return (
            <div key={t.slot} class="tex-row" title={t.hint}>
              <span class="tex-thumb" style={url ? { backgroundImage: `url(${url})` } : undefined}>
                {!url && <ImagePlus size={16} />}
              </span>
              <span class="grow tex-name">
                {t.name}
                <small>{ref?.name ?? t.hint}</small>
              </span>
              {ref ? (
                <button
                  class="icon-btn small"
                  aria-label={`Remove ${t.name}`}
                  onClick={() => setTexture(m.id, t.slot, null)}
                >
                  <X size={16} />
                </button>
              ) : (
                <button class="btn small" onClick={() => void importTextureFlow(m.id, t.slot)}>
                  Add…
                </button>
              )}
            </div>
          );
        })}
        {Object.keys(m.maps).length > 0 && (
          <>
            <Slider
              label="Texture repeats"
              value={m.uvScale[0]}
              min={0.1}
              max={20}
              step={0.1}
              defaultValue={1}
              format={(v) => `${v.toFixed(1)}×`}
              onChange={(v) => set({ uvScale: [v, v] }, 'uv')}
            />
            {m.maps.normal && (
              <Slider
                label="Bump strength"
                value={m.normalStrength}
                min={0}
                max={3}
                step={0.05}
                defaultValue={1}
                onChange={(v) => set({ normalStrength: v }, 'normal')}
              />
            )}
          </>
        )}
      </Group>
    </>
  );
}
