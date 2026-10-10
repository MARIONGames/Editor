import { Download, Mountain } from 'lucide-preact';
import { ColorSwatches, Segmented, Switch } from '../../ui/components/Controls';
import { Slider } from '../../ui/components/Slider';
import type { EnvPreset, RenderSettings3D, World3D } from '../model/types';
import { importHdriFlow } from '../io/import3d';
import { patchRender, patchWorld } from '../state/actions3d';
import { dialog3d, scene3d, shading } from '../state/store3d';
import { NumberField } from './AdjustPanel';
import { Group } from './Properties';

const ENVS: { id: EnvPreset; name: string; css: string; hint: string }[] = [
  {
    id: 'studio',
    name: 'Studio',
    css: 'linear-gradient(180deg,#f4f4f4,#9a9a9a)',
    hint: 'Even, soft light — products and characters',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    css: 'linear-gradient(180deg,#2b3a67,#ff9e6d 60%,#3a2a2a)',
    hint: 'Warm, low sun',
  },
  {
    id: 'overcast',
    name: 'Cloudy',
    css: 'linear-gradient(180deg,#c9d1dc,#e6e9ee 55%,#5b5e63)',
    hint: 'Flat daylight with soft shadows',
  },
  {
    id: 'night',
    name: 'Night',
    css: 'linear-gradient(180deg,#03050d,#14203d 60%,#050505)',
    hint: 'Dark and moody with moonlight',
  },
  {
    id: 'none',
    name: 'None',
    css: 'linear-gradient(180deg,#222,#111)',
    hint: 'Only your own lights',
  },
];

export function WorldProps() {
  const s = scene3d.value!;
  const w = s.world;
  const set = (patch: Partial<World3D>, key?: string) => patchWorld(patch, key);
  return (
    <>
      {shading.value !== 'rendered' && (
        <p class="note">
          The view is in “{shading.value === 'solid' ? 'Clay' : 'Look'}” mode.{' '}
          <button class="link" onClick={() => (shading.value = 'rendered')}>
            Switch to Final
          </button>{' '}
          to see the world.
        </p>
      )}
      <Group title="Sky & surroundings">
        <p class="faint">The world lights everything and shows in reflections.</p>
        <div class="env-grid">
          {ENVS.map((e) => (
            <button
              key={e.id}
              class={`env-item ${w.env === e.id ? 'on' : ''}`}
              title={e.hint}
              onClick={() => set({ env: e.id })}
            >
              <span class="env-swatch" style={{ background: e.css }} />
              <span>{e.name}</span>
            </button>
          ))}
          <button
            class={`env-item ${w.env === 'hdri' ? 'on' : ''}`}
            title="Use any .hdr or .exr panorama (free ones at polyhaven.com)"
            onClick={() => void importHdriFlow()}
          >
            <span class="env-swatch hdri">
              <Mountain size={18} />
            </span>
            <span>
              {w.env === 'hdri' && w.hdri ? (s.assets[w.hdri]?.name ?? 'Your sky') : 'Your own…'}
            </span>
          </button>
        </div>
        {w.env !== 'none' && (
          <>
            <Slider
              label="Strength"
              value={w.envIntensity}
              min={0}
              max={4}
              step={0.01}
              defaultValue={1}
              onChange={(v) => set({ envIntensity: v }, 'env-int')}
            />
            <Slider
              label="Turn"
              value={w.envRotation}
              min={-180}
              max={180}
              step={1}
              defaultValue={0}
              format={(v) => `${Math.round(v)}°`}
              onChange={(v) => set({ envRotation: v }, 'env-rot')}
            />
          </>
        )}
      </Group>
      <Group title="Background">
        <Segmented<World3D['background']>
          value={w.background}
          ariaLabel="Background"
          options={[
            { value: 'env', label: 'Sky' },
            { value: 'blur', label: 'Blurred' },
            { value: 'color', label: 'Color' },
          ]}
          onChange={(v) => set({ background: v })}
        />
        {(w.background === 'color' || w.env === 'none') && (
          <ColorSwatches
            value={w.color}
            colors={[
              '#ffffff',
              '#f1eee9',
              '#d9dde3',
              '#20222b',
              '#0b0b0f',
              '#1d3557',
              '#ffd6e0',
              '#c7f0d8',
            ]}
            onChange={(c) => set({ color: c }, 'bg')}
          />
        )}
        <Switch
          label="Shadow on the floor"
          hint="Objects cast a soft shadow on an invisible ground"
          checked={w.floorShadow}
          onChange={(v) => set({ floorShadow: v })}
        />
      </Group>
    </>
  );
}

const SIZES: { name: string; w: number; h: number }[] = [
  { name: 'HD 16:9', w: 1920, h: 1080 },
  { name: '4K', w: 3840, h: 2160 },
  { name: 'Square', w: 1080, h: 1080 },
  { name: 'Vertical', w: 1080, h: 1920 },
  { name: '4:5', w: 1080, h: 1350 },
];

export function RenderProps() {
  const s = scene3d.value!;
  const r = s.render;
  const set = (patch: Partial<RenderSettings3D>, key?: string) => patchRender(patch, key);
  const cams = s.order.filter((id) => s.objects[id]!.kind === 'camera');
  return (
    <>
      <Group title="Picture size">
        <div class="chips">
          {SIZES.map((z) => (
            <button
              key={z.name}
              class={`chip ${r.width === z.w && r.height === z.h ? 'on' : ''}`}
              onClick={() => set({ width: z.w, height: z.h })}
            >
              {z.name}
            </button>
          ))}
        </div>
        <div class="tf-fields two">
          <NumberField
            label="W"
            value={r.width}
            min={16}
            max={8192}
            step={1}
            digits={0}
            unit="px"
            onChange={(v, f) => set({ width: Math.round(v) }, f ? undefined : 'w')}
          />
          <NumberField
            label="H"
            value={r.height}
            min={16}
            max={8192}
            step={1}
            digits={0}
            unit="px"
            onChange={(v, f) => set({ height: Math.round(v) }, f ? undefined : 'h')}
          />
        </div>
      </Group>
      <Group title="Camera">
        {cams.length ? (
          <div class="chips">
            {cams.map((id) => (
              <button
                key={id}
                class={`chip ${r.camera === id ? 'on' : ''}`}
                onClick={() => set({ camera: id })}
              >
                {s.objects[id]!.name}
              </button>
            ))}
          </div>
        ) : (
          <p class="faint">
            No camera yet: renders use the view you are looking at. Add → Camera to frame a shot.
          </p>
        )}
      </Group>
      <Group title="Color & light">
        <Segmented<RenderSettings3D['tone']>
          value={r.tone}
          ariaLabel="Tone mapping"
          options={[
            {
              value: 'agx',
              label: 'Filmic',
              title: 'AgX: natural, handles bright lights gracefully (recommended)',
            },
            { value: 'aces', label: 'Punchy', title: 'ACES: contrasty, saturated' },
            {
              value: 'neutral',
              label: 'Neutral',
              title: 'Khronos PBR Neutral: true product colors',
            },
            { value: 'none', label: 'Raw', title: 'No tone mapping' },
          ]}
          onChange={(v) => set({ tone: v })}
        />
        <Slider
          label="Exposure"
          value={r.exposure}
          min={0.1}
          max={4}
          step={0.01}
          defaultValue={1}
          onChange={(v) => set({ exposure: v }, 'exposure')}
        />
        <Switch
          label="Transparent background"
          hint="PNG with no background — for stickers, logos and compositing"
          checked={r.transparent}
          onChange={(v) => set({ transparent: v })}
        />
      </Group>
      <button class="btn primary block" onClick={() => (dialog3d.value = { type: 'export' })}>
        <Download size={18} /> Export picture, video or model…
      </button>
    </>
  );
}
