/**
 * Kinora 3D data model. Everything here is plain data (structured-clone friendly) so a
 * scene can be stored in IndexedDB and undo is just keeping old references.
 *
 * Units are meters, +Y is up (the glTF / game-engine convention).
 */

export type ID = string;
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/**
 * Polygon mesh (n-gons, not just triangles).
 * Face i uses the corners f[offset(i) .. offset(i) + fs[i]); corners run counter-clockwise
 * seen from outside. Arrays are never mutated in place: edits create new arrays and share
 * the ones they did not change.
 */
export interface MeshData {
  /** Vertex positions (x, y, z per vertex). */
  v: Float32Array;
  /** Vertex index of every face corner, faces concatenated. */
  f: Uint32Array;
  /** Number of corners of each face. */
  fs: Uint32Array;
  /** Texture coordinates per face corner (u, v per corner). Faces without UVs use NaN. */
  uv?: Float32Array;
  /** Material slot of each face (index into the object's material list). */
  m?: Uint16Array;
}

export interface Transform3 {
  /** Position. */
  p: Vec3;
  /** Rotation (XYZ Euler angles, radians). */
  r: Vec3;
  /** Scale. */
  s: Vec3;
}

export type Ease = 'constant' | 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'back' | 'bounce' | 'elastic';

export interface Keyframe {
  /** Time in seconds. */
  t: number;
  /** Value (vector channels have 3 numbers, scalar channels 1). */
  v: number[];
  /** How the value moves from this key to the next one. */
  e: Ease;
}

/**
 * Animated properties of an object, keyed by channel:
 * 'p' | 'r' | 's' (transform), 'light.intensity', 'camera.fov', and for rigged models
 * 'bone:<name>:r' / 'bone:<name>:p'.
 */
export type AnimChannels = Record<string, Keyframe[]>;

export type ModifierKind = 'mirror' | 'array' | 'solidify' | 'subdivision' | 'bevel' | 'decimate' | 'triangulate' | 'weld' | 'displace';

export interface ModifierBase {
  id: ID;
  kind: ModifierKind;
  enabled: boolean;
}
export interface MirrorModifier extends ModifierBase {
  kind: 'mirror';
  axes: [boolean, boolean, boolean];
  /** Vertices closer than this to the mirror plane are joined. */
  merge: number;
}
export interface ArrayModifier extends ModifierBase {
  kind: 'array';
  count: number;
  /** Offset between copies, relative to the object's size along each axis. */
  relative: Vec3;
  /** Extra offset in meters. */
  constant: Vec3;
}
export interface SolidifyModifier extends ModifierBase {
  kind: 'solidify';
  thickness: number;
}
export interface SubdivisionModifier extends ModifierBase {
  kind: 'subdivision';
  levels: number;
}
export interface BevelModifier extends ModifierBase {
  kind: 'bevel';
  width: number;
  /** Only edges sharper than this angle (degrees) are beveled. */
  angle: number;
}
export interface DecimateModifier extends ModifierBase {
  kind: 'decimate';
  /** Fraction of triangles to keep (0..1). */
  ratio: number;
}
export interface TriangulateModifier extends ModifierBase {
  kind: 'triangulate';
}
export interface WeldModifier extends ModifierBase {
  kind: 'weld';
  distance: number;
}
export interface DisplaceModifier extends ModifierBase {
  kind: 'displace';
  strength: number;
  /** Size of the bumps in meters. */
  scale: number;
  seed: number;
}
export type Modifier =
  | MirrorModifier
  | ArrayModifier
  | SolidifyModifier
  | SubdivisionModifier
  | BevelModifier
  | DecimateModifier
  | TriangulateModifier
  | WeldModifier
  | DisplaceModifier;

export type ShadeMode = 'flat' | 'smooth' | 'auto';

export interface ObjBase {
  id: ID;
  name: string;
  parent: ID | null;
  t: Transform3;
  visible: boolean;
  locked: boolean;
  anim?: AnimChannels;
}

export interface MeshObj extends ObjBase {
  kind: 'mesh';
  mesh: MeshData;
  /** Material per slot (face material index → material id). */
  materials: ID[];
  modifiers: Modifier[];
  shade: ShadeMode;
  /** Auto-smooth angle in degrees (used when shade = 'auto'). */
  smoothAngle: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

export type LightKind = 'sun' | 'point' | 'spot' | 'area';
export interface LightObj extends ObjBase {
  kind: 'light';
  light: {
    type: LightKind;
    color: string;
    /** Physical-ish intensity (sun: lux-like, point/spot: candela-like, area: nits-like). */
    intensity: number;
    /** Point/spot: how far the light reaches (0 = infinite). */
    range: number;
    /** Spot: cone angle (degrees). */
    angle: number;
    /** Spot: soft edge 0..1. */
    softness: number;
    /** Area: width/height in meters. */
    size: Vec2;
    shadow: boolean;
  };
}

export interface CameraObj extends ObjBase {
  kind: 'camera';
  camera: {
    /** Vertical field of view (degrees). */
    fov: number;
    near: number;
    far: number;
  };
}

export interface EmptyObj extends ObjBase {
  kind: 'empty';
  size: number;
}

/** An imported model kept as-is (rigged characters, animated props). */
export interface ModelObj extends ObjBase {
  kind: 'model';
  assetId: ID;
  /** Animation clip that plays on the timeline. */
  clip: { name: string | null; speed: number; loop: boolean; offset: number };
}

export type Obj3D = MeshObj | LightObj | CameraObj | EmptyObj | ModelObj;
export type ObjKind = Obj3D['kind'];

export type TextureSlot = 'color' | 'normal' | 'roughness' | 'metalness' | 'ao' | 'emissive' | 'opacity';

export interface Material3D {
  id: ID;
  name: string;
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  /** Glass-like see-through (0..1). */
  transmission: number;
  ior: number;
  /** Car-paint style top coat (0..1). */
  clearcoat: number;
  clearcoatRoughness: number;
  /** Fabric shine (0..1). */
  sheen: number;
  doubleSided: boolean;
  /** Texture maps (texture ids). */
  maps: Partial<Record<TextureSlot, ID>>;
  /** Texture repeats across the UVs. */
  uvScale: Vec2;
  normalStrength: number;
}

export interface TextureRef {
  id: ID;
  name: string;
  /** Image blob in the shared media store. */
  assetId: ID;
}

export interface Asset3D {
  id: ID;
  name: string;
  kind: 'model' | 'image' | 'hdri';
  mime: string;
  size: number;
}

export type EnvPreset = 'studio' | 'sunset' | 'overcast' | 'night' | 'hdri' | 'none';

export interface World3D {
  env: EnvPreset;
  /** HDRI asset when env = 'hdri'. */
  hdri: ID | null;
  envIntensity: number;
  /** Turns the environment around the vertical axis (degrees). */
  envRotation: number;
  /** What you see behind the scene. */
  background: 'env' | 'blur' | 'color';
  color: string;
  /** A soft shadow on an invisible floor (great for product shots). */
  floorShadow: boolean;
}

export interface RenderSettings3D {
  width: number;
  height: number;
  fps: number;
  exposure: number;
  tone: 'agx' | 'aces' | 'neutral' | 'none';
  shadows: boolean;
  /** Camera object used for renders (null = the view you are looking through). */
  camera: ID | null;
  transparent: boolean;
}

export interface Scene3D {
  schema: 1;
  id: ID;
  name: string;
  kind: '3d';
  objects: Record<ID, Obj3D>;
  /** Outliner order of every object (children are listed under their parent). */
  order: ID[];
  materials: Record<ID, Material3D>;
  textures: Record<ID, TextureRef>;
  assets: Record<ID, Asset3D>;
  world: World3D;
  render: RenderSettings3D;
  /** Animation range in seconds. */
  anim: { start: number; end: number };
  createdAt: number;
  updatedAt: number;
}
