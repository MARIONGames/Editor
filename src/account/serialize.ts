/**
 * Projects and scenes as compact files for the cloud: JSON where binary arrays (3D
 * meshes, audio peaks) become base64, gzipped when the browser can.
 */

type TypedArray =
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array;

const CTORS: Record<string, new (b: ArrayBuffer) => TypedArray> = {
  Float32Array,
  Float64Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
};

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const name = v.constructor.name;
      if (CTORS[name])
        return { $ta: name, b: toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    return v;
  });
}

export function fromJson<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v: unknown) => {
    if (v && typeof v === 'object' && '$ta' in v && 'b' in v) {
      const o = v as { $ta: string; b: string };
      const Ctor = CTORS[o.$ta];
      if (Ctor) return new Ctor(fromB64(o.b).buffer);
    }
    return v;
  }) as T;
}

const canGzip =
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function pack(value: unknown): Promise<{ body: Blob; encoding: 'gzip' | '' }> {
  const text = new Blob([toJson(value)], { type: 'application/json' });
  if (!canGzip) return { body: text, encoding: '' };
  const gz = await new Response(text.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { body: gz, encoding: 'gzip' };
}

export async function unpack<T = unknown>(data: Blob, encoding: string): Promise<T> {
  let text: string;
  if (encoding === 'gzip') {
    if (!canGzip)
      throw new Error('This browser can’t open compressed cloud backups. Please update it.');
    text = await new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = await data.text();
  return fromJson<T>(text);
}

/** Thumbnails/waveforms of a video or song travel as one small file next to it. */
export async function packDerived(d: {
  thumbs: Blob[];
  thumbInterval: number;
  peaks?: Float32Array;
  rms?: Float32Array;
}): Promise<Blob> {
  const thumbs = await Promise.all(
    d.thumbs.map(async (b) => ({ type: b.type, b: toB64(new Uint8Array(await b.arrayBuffer())) })),
  );
  return (await pack({ thumbs, thumbInterval: d.thumbInterval, peaks: d.peaks, rms: d.rms })).body;
}

export async function unpackDerived(
  blob: Blob,
): Promise<{ thumbs: Blob[]; thumbInterval: number; peaks?: Float32Array; rms?: Float32Array }> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  const raw = await unpack<{
    thumbs: { type: string; b: string }[];
    thumbInterval: number;
    peaks?: Float32Array;
    rms?: Float32Array;
  }>(blob, gz ? 'gzip' : '');
  return {
    thumbs: raw.thumbs.map((t) => new Blob([fromB64(t.b)], { type: t.type })),
    thumbInterval: raw.thumbInterval,
    peaks: raw.peaks,
    rms: raw.rms,
  };
}
