/** Physically based materials and one-tap presets. */
import { uid } from '../../util/id';
import type { Material3D } from './types';

export function createMaterial(patch: Partial<Material3D> = {}): Material3D {
  return {
    id: uid('mat'),
    name: 'Material',
    color: '#c8c8cc',
    metalness: 0,
    roughness: 0.5,
    emissive: '#000000',
    emissiveIntensity: 1,
    opacity: 1,
    transmission: 0,
    ior: 1.5,
    clearcoat: 0,
    clearcoatRoughness: 0.1,
    sheen: 0,
    doubleSided: false,
    maps: {},
    uvScale: [1, 1],
    normalStrength: 1,
    ...patch,
  };
}

export interface MaterialPreset {
  id: string;
  name: string;
  group: 'Basic' | 'Metal' | 'Glass & liquid' | 'Special';
  hint: string;
  props: Partial<Material3D>;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: 'clay',
    name: 'Clay',
    group: 'Basic',
    hint: 'Soft, matte — great for checking shapes',
    props: { color: '#d9cfc4', roughness: 0.85 },
  },
  {
    id: 'plastic',
    name: 'Plastic',
    group: 'Basic',
    hint: 'Shiny toy plastic',
    props: { color: '#e63946', roughness: 0.28, clearcoat: 0.4, clearcoatRoughness: 0.2 },
  },
  {
    id: 'matte',
    name: 'Matte paint',
    group: 'Basic',
    hint: 'Flat wall paint',
    props: { color: '#f1faee', roughness: 0.95 },
  },
  {
    id: 'rubber',
    name: 'Rubber',
    group: 'Basic',
    hint: 'Dark and grippy',
    props: { color: '#1d1d22', roughness: 0.9 },
  },
  {
    id: 'ceramic',
    name: 'Ceramic',
    group: 'Basic',
    hint: 'Glazed pottery',
    props: { color: '#f4f1ea', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 },
  },
  {
    id: 'wood',
    name: 'Wood',
    group: 'Basic',
    hint: 'Warm varnished wood color',
    props: { color: '#8b5a2b', roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.3 },
  },
  {
    id: 'fabric',
    name: 'Fabric',
    group: 'Basic',
    hint: 'Velvet-like cloth with a soft sheen',
    props: { color: '#3d5a80', roughness: 0.9, sheen: 1 },
  },
  {
    id: 'skin',
    name: 'Skin',
    group: 'Basic',
    hint: 'A soft, warm skin tone',
    props: { color: '#e0ac8a', roughness: 0.55, sheen: 0.3 },
  },
  {
    id: 'steel',
    name: 'Steel',
    group: 'Metal',
    hint: 'Brushed steel',
    props: { color: '#b4b8bd', metalness: 1, roughness: 0.35 },
  },
  {
    id: 'chrome',
    name: 'Chrome',
    group: 'Metal',
    hint: 'Mirror-like metal',
    props: { color: '#f2f3f5', metalness: 1, roughness: 0.05 },
  },
  {
    id: 'gold',
    name: 'Gold',
    group: 'Metal',
    hint: 'Polished gold',
    props: { color: '#ffc85a', metalness: 1, roughness: 0.18 },
  },
  {
    id: 'copper',
    name: 'Copper',
    group: 'Metal',
    hint: 'Warm copper',
    props: { color: '#e08d5a', metalness: 1, roughness: 0.25 },
  },
  {
    id: 'aluminium',
    name: 'Aluminium',
    group: 'Metal',
    hint: 'Light, slightly rough metal',
    props: { color: '#d4d7db', metalness: 1, roughness: 0.45 },
  },
  {
    id: 'car-paint',
    name: 'Car paint',
    group: 'Metal',
    hint: 'Metallic paint with a glossy top coat',
    props: {
      color: '#1f6feb',
      metalness: 0.6,
      roughness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    },
  },
  {
    id: 'glass',
    name: 'Glass',
    group: 'Glass & liquid',
    hint: 'Clear glass',
    props: { color: '#ffffff', roughness: 0.02, transmission: 1, ior: 1.5 },
  },
  {
    id: 'frosted',
    name: 'Frosted glass',
    group: 'Glass & liquid',
    hint: 'Blurry, milky glass',
    props: { color: '#ffffff', roughness: 0.4, transmission: 1, ior: 1.5 },
  },
  {
    id: 'tinted-glass',
    name: 'Tinted glass',
    group: 'Glass & liquid',
    hint: 'Colored glass bottle',
    props: { color: '#58b368', roughness: 0.05, transmission: 0.9, ior: 1.52 },
  },
  {
    id: 'water',
    name: 'Water',
    group: 'Glass & liquid',
    hint: 'Clear water',
    props: { color: '#d8f3ff', roughness: 0.02, transmission: 1, ior: 1.33 },
  },
  {
    id: 'neon',
    name: 'Neon',
    group: 'Special',
    hint: 'Glows by itself',
    props: { color: '#111111', emissive: '#ff2bd6', emissiveIntensity: 4, roughness: 0.4 },
  },
  {
    id: 'lamp',
    name: 'Light bulb',
    group: 'Special',
    hint: 'Warm glowing light',
    props: { color: '#ffffff', emissive: '#ffd59a', emissiveIntensity: 6 },
  },
  {
    id: 'hologram',
    name: 'Hologram',
    group: 'Special',
    hint: 'See-through glowing blue',
    props: {
      color: '#3fd0ff',
      emissive: '#3fd0ff',
      emissiveIntensity: 1.5,
      opacity: 0.45,
      roughness: 0.2,
      doubleSided: true,
    },
  },
];

export function presetMaterial(id: string, name?: string): Material3D {
  const p = MATERIAL_PRESETS.find((x) => x.id === id) ?? MATERIAL_PRESETS[0]!;
  return createMaterial({ name: name ?? p.name, ...p.props });
}

/** Material props a preset changes (used to apply a preset onto an existing material). */
export function presetPatch(id: string): Partial<Material3D> {
  const p = MATERIAL_PRESETS.find((x) => x.id === id);
  const base = createMaterial();
  return {
    color: base.color,
    metalness: base.metalness,
    roughness: base.roughness,
    emissive: base.emissive,
    emissiveIntensity: base.emissiveIntensity,
    opacity: base.opacity,
    transmission: base.transmission,
    ior: base.ior,
    clearcoat: base.clearcoat,
    clearcoatRoughness: base.clearcoatRoughness,
    sheen: base.sheen,
    doubleSided: base.doubleSided,
    ...(p?.props ?? {}),
  };
}
