/**
 * Every tool's name and its plain-language explanation. The explanation is shown
 * on hover / long-press, at the top of the tool's panel, and read by screen readers.
 * Keeping them here makes the app easy to translate and keeps the wording consistent.
 */
export interface ToolText {
  label: string;
  hint: string;
}

export const TOOL_TEXT = {
  add: { label: 'Add', hint: 'Add photos, videos or music from your device' },
  addMedia: { label: 'Photos & videos', hint: 'Add more pictures or video clips to your story' },
  text: { label: 'Text', hint: 'Write a title, caption or any words on top of your picture' },
  stickers: { label: 'Stickers', hint: 'Add emoji stickers and shapes on top' },
  music: { label: 'Music', hint: 'Add a song or sound from your device' },
  canvas: { label: 'Size', hint: 'Choose the shape of your video or picture (wide, tall, square) and its background' },
  magic: { label: 'Magic', hint: 'One-tap helpers: make it look better, cut out the boring silent parts, and more' },
  layers: { label: 'Layers', hint: 'Everything on your picture, from bottom to top. Reorder, hide or lock things here' },

  split: { label: 'Split', hint: 'Cut the clip into two pieces at the white line — then you can delete the piece you don’t want' },
  delete: { label: 'Delete', hint: 'Remove this from your project (you can always undo)' },
  duplicate: { label: 'Copy', hint: 'Make an identical copy right after it' },
  adjust: { label: 'Adjust', hint: 'Fix light and color: brighter, darker, warmer, more colorful…' },
  filters: { label: 'Filters', hint: 'Give it a ready-made look with one tap' },
  crop: { label: 'Crop', hint: 'Cut away the edges, rotate or flip' },
  speed: { label: 'Speed', hint: 'Make it play faster (time-lapse) or slower (slow motion)' },
  volume: { label: 'Volume', hint: 'Make the sound louder or quieter, or fade it in and out' },
  animation: { label: 'Motion', hint: 'Make it move: fade in, pop, slide, or slowly zoom' },
  transition: { label: 'Transition', hint: 'Choose how one clip changes into the next one' },
  transform: { label: 'Position', hint: 'Move, resize and rotate. You can also drag it on the picture' },
  greenscreen: { label: 'Green screen', hint: 'Remove a solid background color (like a green screen) so what’s behind shows through' },
  replace: { label: 'Replace', hint: 'Swap this photo or video for another one, keeping all your edits' },
  editText: { label: 'Edit', hint: 'Change the words' },
  textStyle: { label: 'Style', hint: 'Font, color, outline and background of the text' },
  shape: { label: 'Style', hint: 'Color and outline of the shape' },
  overlay: { label: 'Overlay', hint: 'Put a photo or video on top of your clip (picture-in-picture)' },
} satisfies Record<string, ToolText>;

export type ToolId = keyof typeof TOOL_TEXT;

export const ADJUST_TEXT: Record<string, ToolText & { group: 'light' | 'color' | 'detail' | 'effects' }> = {
  exposure: { label: 'Exposure', hint: 'Overall brightness, like opening a camera’s eye wider', group: 'light' },
  brightness: { label: 'Brightness', hint: 'Lighten or darken the middle tones', group: 'light' },
  contrast: { label: 'Contrast', hint: 'Difference between light and dark parts. More = punchier', group: 'light' },
  highlights: { label: 'Highlights', hint: 'Only the bright parts. Lower it to bring back detail in a bright sky', group: 'light' },
  shadows: { label: 'Shadows', hint: 'Only the dark parts. Raise it to see more in dark areas', group: 'light' },
  whites: { label: 'Whites', hint: 'How bright the brightest parts get', group: 'light' },
  blacks: { label: 'Blacks', hint: 'How deep the darkest parts get', group: 'light' },
  temperature: { label: 'Warmth', hint: 'Make it warmer (orange) or cooler (blue)', group: 'color' },
  tint: { label: 'Tint', hint: 'Shift colors toward green or pink/magenta', group: 'color' },
  vibrance: { label: 'Vibrance', hint: 'Boost dull colors without overdoing skin tones', group: 'color' },
  saturation: { label: 'Saturation', hint: 'How colorful everything is. All the way down = black & white', group: 'color' },
  hue: { label: 'Hue', hint: 'Shift every color around the color wheel', group: 'color' },
  clarity: { label: 'Clarity', hint: 'Adds crunch and texture. Lower it for a soft, dreamy look', group: 'detail' },
  sharpen: { label: 'Sharpen', hint: 'Makes edges crisper', group: 'detail' },
  blur: { label: 'Blur', hint: 'Makes everything soft and out of focus', group: 'detail' },
  vignette: { label: 'Vignette', hint: 'Darkens the corners to draw attention to the middle', group: 'effects' },
  grain: { label: 'Grain', hint: 'Adds film-like texture', group: 'effects' },
  fade: { label: 'Fade', hint: 'A soft, washed-out vintage look', group: 'effects' },
};

export const ADJUST_GROUPS: { id: 'light' | 'color' | 'detail' | 'effects'; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'color', label: 'Color' },
  { id: 'detail', label: 'Detail' },
  { id: 'effects', label: 'Effects' },
];
