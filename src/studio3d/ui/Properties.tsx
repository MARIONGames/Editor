import type { ComponentChildren } from 'preact';
import {
  Box,
  Clapperboard,
  Diamond,
  Globe,
  Image,
  Palette,
  Settings2,
  Sparkles,
} from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { ColorSwatches, Segmented, Switch } from '../../ui/components/Controls';
import { Slider } from '../../ui/components/Slider';
import { transformAt } from '../model/animation';
import { meshStats } from '../model/display';
import { evaluate } from '../model/modifiers';
import type {
  CameraObj,
  EmptyObj,
  LightObj,
  MeshObj,
  ModelObj,
  Obj3D,
  ShadeMode,
  Vec3,
} from '../model/types';
import { makeModelEditable } from '../io/import3d';
import {
  applyTransforms,
  clearParent,
  endGesture3d,
  insertKeys,
  patchObj,
  setOriginTo,
  setRenderCamera,
  setTransformValue,
  unhideAll,
} from '../state/actions3d';
import {
  activeObject,
  lookThrough,
  scene3d,
  selection3d,
  tab3d,
  time3d,
  type Tab3D,
} from '../state/store3d';
import { AnimateProps } from './AnimateProps';
import { MaterialProps } from './MaterialProps';
import { ModifierProps } from './ModifierProps';
import { NumberField } from './AdjustPanel';
import { RenderProps, WorldProps } from './WorldRenderProps';
import { viewportRef, viewVersion } from './viewportRef';

export const TAB_TITLES: Record<Tab3D, string> = {
  object: 'Object',
  material: 'Looks (material)',
  modifiers: 'Effects (modifiers)',
  animate: 'Animate',
  world: 'World & light',
  render: 'Render',
};

const TABS: { id: Tab3D; icon: LucideIcon; label: string }[] = [
  { id: 'object', icon: Box, label: 'Object' },
  { id: 'material', icon: Palette, label: 'Looks' },
  { id: 'modifiers', icon: Sparkles, label: 'Effects' },
  { id: 'animate', icon: Clapperboard, label: 'Animate' },
  { id: 'world', icon: Globe, label: 'World' },
  { id: 'render', icon: Image, label: 'Render' },
];

export function Properties(props: { embedded?: boolean }) {
  const tab = tab3d.value;
  return (
    <section class={`props3d ${props.embedded ? 'embedded' : ''}`} aria-label="Properties">
      <div class="props-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            class={tab === t.id ? 'on' : ''}
            title={TAB_TITLES[t.id]}
            data-coach={`tab-${t.id}`}
            onClick={() => (tab3d.value = t.id)}
          >
            <t.icon size={17} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div class="props-body scroll-y" onPointerUp={() => endGesture3d()}>
        {tab === 'object' && <ObjectProps />}
        {tab === 'material' && <MaterialProps />}
        {tab === 'modifiers' && <ModifierProps />}
        {tab === 'animate' && <AnimateProps />}
        {tab === 'world' && <WorldProps />}
        {tab === 'render' && <RenderProps />}
      </div>
    </section>
  );
}

export function Group(props: {
  title: ComponentChildren;
  children: ComponentChildren;
  right?: ComponentChildren;
}) {
  return (
    <div class="pgroup">
      <div class="pgroup-title">
        <span class="grow">{props.title}</span>
        {props.right}
      </div>
      {props.children}
    </div>
  );
}

export function NothingSelected(props: { text: string }) {
  const s = scene3d.value;
  const hidden = s ? s.order.filter((id) => !s.objects[id]!.visible).length : 0;
  return (
    <div class="empty-props">
      <p class="muted">{props.text}</p>
      <ul class="tips">
        <li>
          <strong>Look around:</strong> drag with one finger or the mouse. Two fingers (or
          right-drag) to slide, pinch or scroll to zoom.
        </li>
        <li>
          <strong>Pick something:</strong> click it. Shift+click adds to the selection.
        </li>
      </ul>
      {hidden > 0 && (
        <button class="btn small" onClick={unhideAll}>
          Show {hidden} hidden object{hidden === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

const AXES = ['X', 'Y', 'Z'] as const;
const AXIS_COLORS = ['#e2475c', '#5bc24f', '#3d8bff'];

function ObjectProps() {
  const o = activeObject.value;
  const n = selection3d.value.ids.length;
  void time3d.value;
  if (!o)
    return (
      <NothingSelected text="Nothing is selected. Click an object in the view or in the list above." />
    );
  return (
    <>
      {n > 1 && (
        <p class="faint multi-note">
          {n} objects selected — showing the active one (the last you clicked).
        </p>
      )}
      <TransformGroup o={o} />
      {o.kind === 'mesh' && <MeshGroup o={o} />}
      {o.kind === 'light' && <LightGroup o={o} />}
      {o.kind === 'camera' && <CameraGroup o={o} />}
      {o.kind === 'empty' && <EmptyGroup o={o} />}
      {o.kind === 'model' && <ModelGroup o={o} />}
      {o.parent && scene3d.value?.objects[o.parent] && (
        <Group title="Parent">
          <div class="row">
            <span class="grow">Follows {scene3d.value.objects[o.parent]!.name}</span>
            <button class="btn small" onClick={clearParent}>
              Unlink
            </button>
          </div>
        </Group>
      )}
    </>
  );
}

function TransformGroup(props: { o: Obj3D }) {
  const o = props.o;
  const t = time3d.value;
  const cur = transformAt(o, t);
  const rows: { ch: 'p' | 'r' | 's'; label: string; unit: string; scale: number; step: number }[] =
    [
      { ch: 'p', label: 'Position', unit: 'm', scale: 1, step: 0.01 },
      { ch: 'r', label: 'Rotation', unit: '°', scale: 180 / Math.PI, step: 1 },
      { ch: 's', label: 'Scale', unit: '×', scale: 1, step: 0.01 },
    ];
  return (
    <Group title="Where it is" right={<KeyButton o={o} />}>
      {rows.map((r) => {
        const keyed = !!o.anim?.[r.ch]?.length;
        const onKey = keyed && o.anim![r.ch]!.some((k) => Math.abs(k.t - t) < 1 / 240);
        return (
          <div class="tf-row" key={r.ch}>
            <span
              class={`tf-label ${keyed ? 'animated' : ''} ${onKey ? 'on-key' : ''}`}
              title={keyed ? 'Animated: changes here add a keyframe' : undefined}
            >
              {r.label}
            </span>
            <div class="tf-fields">
              {AXES.map((ax, i) => (
                <NumberField
                  key={ax}
                  label={ax}
                  color={AXIS_COLORS[i]}
                  value={(cur[r.ch] as Vec3)[i]!}
                  scale={r.scale}
                  step={r.step}
                  digits={r.ch === 'r' ? 1 : 3}
                  onChange={(v, final) => {
                    setTransformValue(o.id, r.ch, i as 0 | 1 | 2, v);
                    if (final) endGesture3d();
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
      <p class="faint tf-units">Meters · degrees · times the original size</p>
    </Group>
  );
}

function KeyButton(props: { o: Obj3D }) {
  const t = time3d.value;
  const has =
    props.o.anim &&
    Object.values(props.o.anim).some((keys) => keys.some((k) => Math.abs(k.t - t) < 1 / 240));
  return (
    <button
      class={`key-btn ${has ? 'on' : ''}`}
      title="Add a keyframe here (I) — remember this pose at this moment"
      onClick={() => insertKeys()}
    >
      <Diamond size={15} /> Key
    </button>
  );
}

function MeshGroup(props: { o: MeshObj }) {
  const o = props.o;
  const ev = evaluate(o.mesh, o.modifiers);
  const st = meshStats(ev);
  const base = meshStats(o.mesh);
  return (
    <>
      <Group title="Surface">
        <Segmented<ShadeMode>
          value={o.shade}
          ariaLabel="Shading"
          options={[
            { value: 'flat', label: 'Faceted', title: 'Every face is flat (low-poly look)' },
            {
              value: 'auto',
              label: 'Auto',
              title: 'Smooth, but sharp corners stay sharp (auto smooth)',
            },
            { value: 'smooth', label: 'Smooth', title: 'Everything smooth' },
          ]}
          onChange={(v) => patchObj<MeshObj>(o.id, { shade: v }, 'Shading')}
        />
        {o.shade === 'auto' && (
          <Slider
            label="Sharp above"
            value={o.smoothAngle}
            min={1}
            max={180}
            step={1}
            defaultValue={30}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) =>
              patchObj<MeshObj>(o.id, { smoothAngle: v }, 'Smoothing angle', 'smooth-angle')
            }
          />
        )}
        <Switch
          label="Casts shadows"
          checked={o.castShadow}
          onChange={(v) => patchObj<MeshObj>(o.id, { castShadow: v }, 'Shadows')}
        />
        <Switch
          label="Receives shadows"
          checked={o.receiveShadow}
          onChange={(v) => patchObj<MeshObj>(o.id, { receiveShadow: v }, 'Shadows')}
        />
      </Group>
      <Group title="Polygons">
        <div
          class="stats-grid"
          title="What game engines count: keep characters around 10–60k triangles, props under 5k"
        >
          <span>Triangles</span>
          <strong>{st.tris.toLocaleString()}</strong>
          <span>Faces</span>
          <strong>{st.faces.toLocaleString()}</strong>
          <span>Points</span>
          <strong>{st.verts.toLocaleString()}</strong>
        </div>
        {o.modifiers.length > 0 && (
          <p class="faint">Before effects: {base.tris.toLocaleString()} triangles.</p>
        )}
      </Group>
      <Group title="Origin & size">
        <div class="btn-row">
          <button
            class="btn small"
            title="Put the pivot point in the middle of the shape"
            onClick={() => setOriginTo('geometry')}
          >
            Pivot to center
          </button>
          <button
            class="btn small"
            title="Pivot at the bottom: perfect for things standing on the floor"
            onClick={() => setOriginTo('bottom')}
          >
            Pivot to bottom
          </button>
          <button
            class="btn small"
            title="Make the current size and rotation the new normal (Ctrl+A). Game engines like this."
            onClick={applyTransforms}
          >
            Apply size &amp; rotation
          </button>
        </div>
      </Group>
    </>
  );
}

function LightGroup(props: { o: LightObj }) {
  const o = props.o;
  const L = o.light;
  const set = (patch: Partial<LightObj['light']>, label = 'Change light', coalesce?: string) =>
    patchObj<LightObj>(o.id, { light: { ...L, ...patch } }, label, coalesce);
  const max = L.type === 'sun' ? 20 : L.type === 'area' ? 200 : 5000;
  return (
    <Group title="Light">
      <Segmented
        value={L.type}
        ariaLabel="Light type"
        options={[
          { value: 'sun', label: 'Sun' },
          { value: 'point', label: 'Bulb' },
          { value: 'spot', label: 'Spot' },
          { value: 'area', label: 'Soft box' },
        ]}
        onChange={(v) =>
          set(
            { type: v, intensity: v === 'sun' ? 3 : v === 'point' ? 300 : v === 'spot' ? 800 : 12 },
            'Light type',
          )
        }
      />
      <div class="field-label">Color</div>
      <ColorSwatches
        value={L.color}
        colors={[
          '#ffffff',
          '#fff1dc',
          '#ffd59a',
          '#ffb36b',
          '#dfe8ff',
          '#9ec5ff',
          '#ff6a88',
          '#7c5cff',
        ]}
        onChange={(c) => set({ color: c })}
      />
      <Slider
        label="Brightness"
        value={L.intensity}
        min={0}
        max={max}
        step={L.type === 'sun' ? 0.05 : 1}
        defaultValue={
          L.type === 'sun' ? 3 : L.type === 'point' ? 300 : L.type === 'spot' ? 800 : 12
        }
        onChange={(v) => set({ intensity: v }, 'Brightness', 'light-int')}
      />
      {(L.type === 'point' || L.type === 'spot') && (
        <Slider
          label="Reach"
          hint="0 = no limit"
          value={L.range}
          min={0}
          max={100}
          step={0.5}
          defaultValue={0}
          format={(v) => (v ? `${v} m` : 'no limit')}
          onChange={(v) => set({ range: v }, 'Light reach', 'light-range')}
        />
      )}
      {L.type === 'spot' && (
        <>
          <Slider
            label="Cone"
            value={L.angle}
            min={1}
            max={170}
            step={1}
            defaultValue={35}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => set({ angle: v }, 'Cone', 'light-angle')}
          />
          <Slider
            label="Soft edge"
            value={L.softness}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.3}
            onChange={(v) => set({ softness: v }, 'Soft edge', 'light-soft')}
          />
        </>
      )}
      {L.type === 'area' && (
        <>
          <Slider
            label="Width"
            value={L.size[0]}
            min={0.05}
            max={20}
            step={0.05}
            defaultValue={1}
            format={(v) => `${v.toFixed(2)} m`}
            onChange={(v) => set({ size: [v, L.size[1]] }, 'Light size', 'light-w')}
          />
          <Slider
            label="Height"
            value={L.size[1]}
            min={0.05}
            max={20}
            step={0.05}
            defaultValue={1}
            format={(v) => `${v.toFixed(2)} m`}
            onChange={(v) => set({ size: [L.size[0], v] }, 'Light size', 'light-h')}
          />
        </>
      )}
      {L.type !== 'area' && (
        <Switch
          label="Casts shadows"
          checked={L.shadow}
          onChange={(v) => set({ shadow: v }, 'Shadows')}
        />
      )}
    </Group>
  );
}

function CameraGroup(props: { o: CameraObj }) {
  const o = props.o;
  const s = scene3d.value!;
  const C = o.camera;
  const lens = 12 / Math.tan((C.fov * Math.PI) / 360);
  return (
    <Group title="Camera">
      <Slider
        label="Lens"
        hint="Small numbers see more (wide angle), big numbers zoom in (telephoto)"
        value={Math.round(lens)}
        min={10}
        max={200}
        step={1}
        defaultValue={33}
        format={(v) => `${Math.round(v)} mm`}
        onChange={(v) =>
          patchObj<CameraObj>(
            o.id,
            { camera: { ...C, fov: (Math.atan(12 / v) * 360) / Math.PI } },
            'Lens',
            'cam-lens',
          )
        }
      />
      <div class="btn-row">
        <button
          class={`btn small ${s.render.camera === o.id ? 'primary' : ''}`}
          disabled={s.render.camera === o.id}
          onClick={() => setRenderCamera(o.id)}
        >
          {s.render.camera === o.id ? 'Renders use this camera' : 'Render through this camera'}
        </button>
        <button class="btn small" onClick={() => (lookThrough.value = !lookThrough.peek())}>
          {lookThrough.value ? 'Stop looking through' : 'Look through it'}
        </button>
      </div>
    </Group>
  );
}

function EmptyGroup(props: { o: EmptyObj }) {
  return (
    <Group title="Empty">
      <Slider
        label="Display size"
        value={props.o.size}
        min={0.05}
        max={10}
        step={0.05}
        defaultValue={1}
        onChange={(v) => patchObj<EmptyObj>(props.o.id, { size: v }, 'Size', 'empty-size')}
      />
      <p class="faint">
        An empty is an invisible handle. Make it the parent of other objects to move or animate them
        together.
      </p>
    </Group>
  );
}

function ModelGroup(props: { o: ModelObj }) {
  const o = props.o;
  void viewVersion.value;
  const clips = clipNames(o);
  return (
    <Group title="Imported model">
      {clips.length > 0 ? (
        <>
          <div class="field-label">Animation</div>
          <div class="chips">
            <button
              class={`chip ${o.clip.name === null ? 'on' : ''}`}
              onClick={() =>
                patchObj<ModelObj>(o.id, { clip: { ...o.clip, name: null } }, 'Animation')
              }
            >
              None
            </button>
            {clips.map((c) => (
              <button
                key={c}
                class={`chip ${o.clip.name === c ? 'on' : ''}`}
                onClick={() =>
                  patchObj<ModelObj>(o.id, { clip: { ...o.clip, name: c } }, 'Animation')
                }
              >
                {c}
              </button>
            ))}
          </div>
          <Slider
            label="Speed"
            value={o.clip.speed}
            min={0.1}
            max={3}
            step={0.05}
            defaultValue={1}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) =>
              patchObj<ModelObj>(
                o.id,
                { clip: { ...o.clip, speed: v } },
                'Animation speed',
                'clip-speed',
              )
            }
          />
          <Switch
            label="Loop"
            checked={o.clip.loop}
            onChange={(v) => patchObj<ModelObj>(o.id, { clip: { ...o.clip, loop: v } }, 'Loop')}
          />
        </>
      ) : (
        <p class="faint">
          This model has no animations of its own. You can still move, turn and key it like any
          object.
        </p>
      )}
      <button
        class="btn small"
        title="Turn it into Kinora shapes you can edit point by point (rigs are removed)"
        onClick={() => void makeModelEditable(o.id)}
      >
        <Settings2 size={16} /> Make editable
      </button>
    </Group>
  );
}

function clipNames(o: ModelObj): string[] {
  return viewportRef.current?.clipNames(o.id) ?? [];
}
