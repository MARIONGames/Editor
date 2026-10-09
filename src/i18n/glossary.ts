/** Editing words explained simply. Shown in the "Learn" dialog. */
export interface GlossaryEntry {
  term: string;
  aka?: string;
  meaning: string;
  where: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'Clip',
    meaning: 'One piece of your video: a video recording, a photo shown for a few seconds, a piece of text, or a song.',
    where: 'Clips are the colored blocks in the timeline at the bottom.',
  },
  {
    term: 'Timeline',
    meaning: 'Your whole video laid out from left (start) to right (end). Each row is a layer: pictures in the middle, text above, music below.',
    where: 'The strip at the bottom of the editor. Swipe it to move through your video.',
  },
  {
    term: 'Playhead',
    aka: 'the white line',
    meaning: 'Shows the moment you are looking at. Split, Text and Stickers happen at the white line.',
    where: 'The white vertical line in the middle of the timeline.',
  },
  {
    term: 'Cut',
    aka: 'Split',
    meaning: 'Cutting a clip divides it into two separate pieces at the white line, so you can delete, move or change one part.',
    where: 'Tap a clip, move the white line to the moment you want, then tap Split.',
  },
  {
    term: 'Trim',
    meaning: 'Shortening a clip by removing some of its beginning or end.',
    where: 'Tap a clip, then drag its left or right edge (the white handles).',
  },
  {
    term: 'Transition',
    meaning: 'The effect when one clip changes into the next — for example a smooth fade instead of a sudden jump.',
    where: 'Tap the small square between two clips in the timeline.',
  },
  {
    term: 'Aspect ratio',
    aka: 'Size / shape',
    meaning: 'The shape of your video: wide (16:9) for YouTube and TVs, tall (9:16) for phones, TikTok and Reels, square (1:1) for posts.',
    where: 'Tap Size when nothing is selected.',
  },
  {
    term: 'Resolution',
    meaning: 'How many pixels (tiny dots) the picture has. More pixels = sharper, but bigger files. 1080p is great for almost everything.',
    where: 'You choose it when you Export.',
  },
  {
    term: 'Frame rate',
    aka: 'FPS',
    meaning: 'How many pictures per second make up the video. 30 is standard; 60 is extra smooth.',
    where: 'Export → More options.',
  },
  {
    term: 'Export',
    aka: 'Save / render',
    meaning: 'Turning your project into a normal video or picture file you can share anywhere.',
    where: 'The Export button at the top right.',
  },
  {
    term: 'Project',
    meaning: 'Your work in progress. It remembers every edit and is saved automatically on this device. Your original files are never changed.',
    where: 'All your projects are on the home screen.',
  },
  {
    term: 'Layer',
    aka: 'Overlay',
    meaning: 'Something placed on top of something else — like text on a photo. Higher layers cover lower ones.',
    where: 'Photo editor → Layers. In videos, upper timeline rows are on top.',
  },
  {
    term: 'Exposure',
    meaning: 'How bright the whole picture is. Raise it for dark photos, lower it for washed-out ones.',
    where: 'Adjust → Light.',
  },
  {
    term: 'Contrast',
    meaning: 'The difference between the light and dark parts. More contrast looks punchy, less looks soft and flat.',
    where: 'Adjust → Light.',
  },
  {
    term: 'Saturation',
    meaning: 'How strong the colors are. Zero makes it black & white.',
    where: 'Adjust → Color.',
  },
  {
    term: 'White balance',
    aka: 'Warmth / Temperature',
    meaning: 'Fixes colors that look too blue or too orange because of the light where the photo was taken.',
    where: 'Adjust → Color → Warmth.',
  },
  {
    term: 'Filter',
    aka: 'Look / Preset',
    meaning: 'A ready-made combination of color settings that gives your picture a style, like “Film” or “Black & white”.',
    where: 'Select a clip → Filters.',
  },
  {
    term: 'Crop',
    meaning: 'Cutting away the edges of a picture to remove distractions or change its shape.',
    where: 'Select a photo or video → Crop.',
  },
  {
    term: 'Ken Burns effect',
    aka: 'Photo motion',
    meaning: 'A slow zoom or pan over a still photo so it feels alive in a video.',
    where: 'Select a photo in a video → Motion.',
  },
  {
    term: 'Keyframe',
    meaning: 'A saved position/size at a certain moment, so something can move from one keyframe to the next. Kinora’s Motion presets do this for you.',
    where: 'Select something → Motion.',
  },
  {
    term: 'Green screen',
    aka: 'Chroma key',
    meaning: 'Removing a plain background color (often green) so you can put something else behind the person.',
    where: 'Select a clip on top of another → Green screen.',
  },
  {
    term: 'Picture-in-picture',
    aka: 'PiP',
    meaning: 'A small video or photo shown on top of another one, like a reaction video in the corner.',
    where: 'Add → Overlay.',
  },
  {
    term: 'Fade in / fade out',
    meaning: 'Sound (or picture) starting quietly and getting louder, or slowly going silent at the end.',
    where: 'Select a clip with sound → Volume.',
  },
  {
    term: 'Ripple delete',
    meaning: 'When you delete a clip in the story row, the gap closes automatically so there is no black space. Kinora always does this for you.',
    where: 'Happens automatically.',
  },
  {
    term: 'B-roll',
    meaning: 'Extra footage shown over someone talking — the talking continues while viewers see related pictures.',
    where: 'Add → Overlay, then make it full size in Position.',
  },
  {
    term: 'Bitrate',
    meaning: 'How much data is used for each second of video. Higher = better quality and bigger file.',
    where: 'Export → Quality.',
  },
  {
    term: 'Codec',
    aka: 'H.264, VP9, AAC',
    meaning: 'The technical method used to squeeze video and sound into a file. Kinora picks the most compatible one for you.',
    where: 'Export → More options.',
  },
  {
    term: 'Undo / Redo',
    meaning: 'Undo takes back your last change. Redo puts it back. You can undo many steps.',
    where: 'The curved arrows at the top. Keyboard: Ctrl/⌘ + Z.',
  },
];
