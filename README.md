# Kinora

**Pro-quality photo & video editing. Ridiculously easy.**

Kinora is a photo and video editor that runs entirely in your web browser — on
phones, tablets and computers. It is designed so that someone who has never
edited anything (and doesn't know what a "cut" is) can finish their first
project in a few minutes, while the results look professional: GPU rendering in
16-bit colour, full-resolution exports and high-quality encoders.

Everything happens on your device. No account, no upload, no watermark.

## What you can do

**Start from a goal** — *Edit a photo*, *Make a video*, *Photo slideshow*,
*Quick trim*, *Make a meme* or a **template** (Birthday, Travel diary, Vlog
intro, Love story, Recipe steps, Big sale, Quote). Kinora sets up the size,
tracks and look for you.

**Video**
- Magnetic "story" timeline: drag to reorder, drag the edges to trim, *Split* at
  the white line, delete without leaving gaps.
- Text with 16 one-tap styles (Title, Caption, Meme, Neon, Movie…), 15 bundled
  fonts, outline, shadow/glow, background box, entrance/exit/loop animations.
- Emoji stickers and shapes, picture-in-picture overlays, blend modes.
- 18 transitions (fade, dip, slide, push, wipe, zoom, circle, blur, spin).
- Photo motion (Ken Burns), speed changes with natural-sounding voices
  (pitch-preserving time-stretch), volume, fades, automatic crossfades.
- Music with waveform, beat detection.
- Export MP4 (H.264 + AAC) or WebM (VP9 + Opus) up to 4K, 24–60 fps, with
  presets in plain language ("Social media", "Best quality", "Small file").

**Photo**
- 18 adjustments: exposure, brightness, contrast, highlights, shadows, whites,
  blacks, warmth, tint, vibrance, saturation, hue, clarity, sharpen, blur,
  vignette, grain, fade — with explanations under every slider.
- 23 filter looks with a strength slider.
- Crop with aspect presets, rotate, mirror, straighten.
- Layers: text, stickers, shapes and extra photos; reorder, hide, lock.
- Export JPEG, PNG (with transparency) or WebP at full resolution.

**Magic (one tap, always undoable)**
- *Auto-enhance* — natural light and colour correction from the picture's histograms.
- *Remove silent parts* — cuts the pauses out of talking videos.
- *Beat sync* — times your photos to the rhythm of the music.
- *Fit for TikTok / YouTube / Instagram* — change shape with a blurred background fill.
- *Green screen* — remove a background colour (chroma key).

**Learning built in**
- A short interactive tour that waits for you to actually do each step.
- Every tool explains itself (hover on desktop, press-and-hold on touch).
- "Your video, step by step" checklist and a *Next step* suggestion.
- A searchable glossary of editing words ("What is a cut? A transition?").

## Run it

Requirements: Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173 (also reachable from your phone on the same Wi-Fi)
```

Other scripts:

```bash
npm run check      # TypeScript (strict)
npm test           # unit tests (Vitest)
npm run build      # production build in dist/ (static files, host anywhere)
npm run preview    # serve the production build
npm run test:e2e   # end-to-end tests in Chromium (Playwright)
```

The production build is a static site with a service worker, so it works
offline and can be installed to a phone's home screen ("Add to Home Screen").

## Browser support

Chrome / Edge 94+, Safari 16.4+, Firefox 130+ on desktop; Chrome on Android;
Safari on iOS 16.4+. WebGL 2 is required. Video export uses WebCodecs when
available and falls back to real-time recording otherwise.

## Documentation

- [Product vision, name and design principles](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development plan](docs/DEVELOPMENT_PLAN.md)

## Project layout

```
src/
  model/     project data model and pure editing operations (unit-tested)
  state/     signals store, undo/redo, actions, autosave
  engine/    WebGL2 renderer, media import, playback, audio, exporters
  magic/     auto-enhance, silence removal, beat detection
  coach/     tour, checklist, next-step suggestions
  ui/        home screen, editor, timeline, panels, dialogs
  i18n/      every tool name/explanation and the glossary
tests/       unit (Vitest) and end-to-end (Playwright) tests
docs/        product, architecture and plan
```

## Credits

Bundled fonts are under the SIL Open Font License — see
[src/assets/fonts/LICENSE.md](src/assets/fonts/LICENSE.md). Video muxing and
decoding use [mediabunny](https://mediabunny.dev) (MPL-2.0); icons are
[Lucide](https://lucide.dev) (ISC).
