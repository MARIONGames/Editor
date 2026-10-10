import {
  Box,
  Camera,
  Circle,
  Cone,
  Cylinder,
  FileUp,
  Globe,
  Grid3x3,
  Lamp,
  Lightbulb,
  LocateFixed,
  Pill,
  Pyramid,
  Square,
  Sun,
  Torus,
} from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import type { PrimitiveKind } from '../model/primitives';
import type { LightKind, Vec3 } from '../model/types';
import { addCamera, addEmpty, addLight, addPrimitive } from '../state/actions3d';
import { importModelsFlow } from '../io/import3d';
import { viewportRef } from './viewportRef';

const SHAPES: { kind: PrimitiveKind; name: string; icon: LucideIcon; hint: string }[] = [
  {
    kind: 'cube',
    name: 'Cube',
    icon: Box,
    hint: 'Boxes, buildings, furniture — the classic start',
  },
  { kind: 'sphere', name: 'Sphere', icon: Globe, hint: 'Balls, heads, planets' },
  { kind: 'cylinder', name: 'Cylinder', icon: Cylinder, hint: 'Cans, pillars, wheels' },
  { kind: 'cone', name: 'Cone', icon: Cone, hint: 'Party hats, trees, spikes' },
  { kind: 'torus', name: 'Torus', icon: Torus, hint: 'Donuts, rings, tires' },
  { kind: 'plane', name: 'Plane', icon: Square, hint: 'A flat square: floors, walls, signs' },
  {
    kind: 'capsule',
    name: 'Capsule',
    icon: Pill,
    hint: 'Rounded tubes: limbs, pills, game characters',
  },
  {
    kind: 'icosphere',
    name: 'Ico sphere',
    icon: Circle,
    hint: 'An even, triangle sphere: rocks, low-poly art',
  },
  { kind: 'pyramid', name: 'Pyramid', icon: Pyramid, hint: 'Four-sided pyramid' },
  {
    kind: 'grid',
    name: 'Grid',
    icon: Grid3x3,
    hint: 'A flat sheet with many squares — terrain, cloth',
  },
];

const LIGHTS: { type: LightKind; name: string; icon: LucideIcon; hint: string }[] = [
  { type: 'sun', name: 'Sun', icon: Sun, hint: 'Parallel light from far away, sharp shadows' },
  {
    type: 'point',
    name: 'Bulb',
    icon: Lightbulb,
    hint: 'Shines in every direction, like a bare bulb',
  },
  { type: 'spot', name: 'Spotlight', icon: Lamp, hint: 'A cone of light, like a stage light' },
  {
    type: 'area',
    name: 'Soft box',
    icon: Square,
    hint: 'Soft, flattering light from a panel (area light)',
  },
];

/** Where new things appear: on the floor, in the middle of the view. */
function spot(): Vec3 {
  const t = viewportRef.current?.viewTarget();
  return t ? [round(t.x), 0, round(t.z)] : [0, 0, 0];
}

const round = (x: number) => Math.round(x * 4) / 4;

export function AddMenu(props: { onDone?: () => void }) {
  const done = () => props.onDone?.();
  return (
    <div class="add-menu">
      <h4 class="add-title">Shapes</h4>
      <div class="add-grid">
        {SHAPES.map((s) => (
          <button
            key={s.kind}
            class="add-item"
            title={s.hint}
            data-coach={`add-${s.kind}`}
            onClick={() => {
              addPrimitive(s.kind, spot());
              done();
            }}
          >
            <s.icon size={24} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <h4 class="add-title">Lights &amp; camera</h4>
      <div class="add-grid">
        {LIGHTS.map((l) => (
          <button
            key={l.type}
            class="add-item"
            title={l.hint}
            onClick={() => {
              addLight(l.type);
              done();
            }}
          >
            <l.icon size={24} />
            <span>{l.name}</span>
          </button>
        ))}
        <button
          class="add-item"
          title="Adds a camera where you are looking from — renders are made through it"
          onClick={() => {
            addCamera(viewportRef.current?.viewTransform());
            done();
          }}
        >
          <Camera size={24} />
          <span>Camera</span>
        </button>
        <button
          class="add-item"
          title="An invisible handle: group things under it or animate around it (empty)"
          onClick={() => {
            addEmpty();
            done();
          }}
        >
          <LocateFixed size={24} />
          <span>Empty</span>
        </button>
      </div>
      <h4 class="add-title">From a file</h4>
      <button
        class="btn block"
        title="GLB, glTF, FBX, OBJ, STL or PLY — characters with animations included"
        onClick={() => {
          done();
          void importModelsFlow();
        }}
      >
        <FileUp size={18} /> Import a 3D model…
      </button>
      <p class="faint add-note">
        GLB / glTF, FBX, OBJ, STL and PLY. Rigged characters keep their animations.
      </p>
    </div>
  );
}
