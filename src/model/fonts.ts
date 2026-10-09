/** Fonts bundled with Kinora (see src/styles/fonts.css). */

export type FontCategory = 'clean' | 'bold' | 'elegant' | 'fun' | 'handwritten' | 'mono';

export interface FontDef {
  family: string;
  /** Plain-language description shown in the font picker. */
  label: string;
  category: FontCategory;
  weights: number[];
  italic?: boolean;
}

export const FONTS: FontDef[] = [
  { family: 'Inter', label: 'Clean', category: 'clean', weights: [400, 500, 600, 700, 800] },
  { family: 'Poppins', label: 'Friendly', category: 'clean', weights: [400, 600, 800] },
  { family: 'Montserrat', label: 'Strong', category: 'bold', weights: [800, 900] },
  { family: 'Bebas Neue', label: 'Tall titles', category: 'bold', weights: [400] },
  { family: 'Anton', label: 'Meme', category: 'bold', weights: [400] },
  { family: 'Playfair Display', label: 'Elegant', category: 'elegant', weights: [700], italic: true },
  { family: 'DM Serif Display', label: 'Classic', category: 'elegant', weights: [400] },
  { family: 'Dancing Script', label: 'Wedding', category: 'handwritten', weights: [700] },
  { family: 'Pacifico', label: 'Summer', category: 'fun', weights: [400] },
  { family: 'Lobster', label: 'Retro', category: 'fun', weights: [400] },
  { family: 'Bangers', label: 'Comic', category: 'fun', weights: [400] },
  { family: 'Fredoka', label: 'Rounded', category: 'fun', weights: [600] },
  { family: 'Permanent Marker', label: 'Marker', category: 'handwritten', weights: [400] },
  { family: 'Caveat', label: 'Handwriting', category: 'handwritten', weights: [700] },
  { family: 'Space Mono', label: 'Typewriter', category: 'mono', weights: [400, 700] },
];

export const DEFAULT_FONT = 'Poppins';

export function fontDef(family: string): FontDef {
  return FONTS.find((f) => f.family === family) ?? FONTS[0]!;
}

/** Closest available weight for a family. */
export function nearestWeight(family: string, weight: number): number {
  const def = fontDef(family);
  let best = def.weights[0]!;
  for (const w of def.weights) if (Math.abs(w - weight) < Math.abs(best - weight)) best = w;
  return best;
}

/** CSS font shorthand usable by canvas `ctx.font`. */
export function cssFont(family: string, weight: number, sizePx: number, italic = false): string {
  const w = nearestWeight(family, weight);
  const fallback =
    fontDef(family).category === 'mono'
      ? 'ui-monospace, monospace'
      : fontDef(family).category === 'elegant'
        ? 'Georgia, serif'
        : 'system-ui, sans-serif';
  return `${italic ? 'italic ' : ''}${w} ${sizePx}px "${family}", ${fallback}`;
}
