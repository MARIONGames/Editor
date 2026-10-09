/** Colour helpers shared by the UI, rasterisers and the renderer. */

export type RGBA = [number, number, number, number];

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and 'transparent' into 0..1 RGBA. */
export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    if (h.length === 6) return [n(0), n(2), n(4), 1];
    if (h.length === 8) return [n(0), n(2), n(4), n(6)];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    const [r = 0, g = 0, b = 0, a = 1] = parts;
    return [r / 255, g / 255, b / 255, a];
  }
  return [0, 0, 0, 1];
}

const hex2 = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0');

export function toHex([r, g, b, a]: RGBA, withAlpha = a < 1): string {
  return '#' + hex2(r) + hex2(g) + hex2(b) + (withAlpha ? hex2(a) : '');
}

/** Relative luminance (sRGB, approximate) 0..1 */
export function luminance(color: string): number {
  const [r, g, b] = parseColor(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return toHex([c[0], c[1], c[2], alpha], true);
}

/** A readable text colour (black or white) on top of `color`. */
export function contrastText(color: string): string {
  return luminance(color) > 0.55 ? '#111111' : '#ffffff';
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}
