# Kinora — Development Plan

The plan is split into phases. Each phase ends with something a real user can
use end-to-end. Status: ✅ done · 🚧 in progress · ⏳ planned.

## Phase 0 — Foundations ✅

| Item | Status |
| --- | --- |
| Name, product vision, design principles ([PRODUCT.md](PRODUCT.md)) | ✅ |
| Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)) | ✅ |
| Tooling: Vite + TypeScript (strict) + Preact/signals, Vitest, Playwright | ✅ |
| CI (GitHub Actions): typecheck, unit tests, build, end-to-end tests | ✅ |
| Design tokens: dark/light themes, spacing, type scale, touch targets | ✅ |

## Phase 1 — "My first project" (MVP) ✅

Goal: a beginner can make and export a photo edit or a short video on a phone or PC.

| Area | Item | Status |
| --- | --- | --- |
| Model | Project / track / clip model, immutable ops, normaliser (unit-tested) | ✅ |
| Model | Magnetic main track, auto-lanes, transitions overlap | ✅ |
| State | Signals store, undo/redo with coalescing + labels, autosave | ✅ |
| Engine | WebGL2 compositor, 16-bit float pipeline, dithered output, analytic anti-aliasing | ✅ |
| Engine | Develop shader: 18 adjustments + 23 filter looks + chroma key | ✅ |
| Engine | Gaussian blur pyramid (blur, sharpen, clarity, blurred background fill) | ✅ |
| Engine | 18 transitions and 13 blend modes | ✅ |
| Engine | Text (15 bundled fonts), emoji sticker and shape rasterisers | ✅ |
| Media | Import by picker, drag & drop and paste; probe, filmstrips, waveforms | ✅ |
| Media | IndexedDB storage of projects and original media | ✅ |
| Playback | Clock, pooled `<video>` sync, Web Audio scheduling, scrubbing | ✅ |
| Audio | Shared preview/export mixer, fades, automatic crossfades, WSOLA pitch-preserving speed | ✅ |
| UI | Home: goal cards, aspect-ratio picker ("match my video"), recent projects | ✅ |
| UI | Editor: responsive layout (phone bottom sheets / desktop inspector) | ✅ |
| UI | Stage: select, move, corner-scale, rotate handle, two-finger pinch/rotate, centre snapping | ✅ |
| UI | Timeline: centre playhead, pinch / Ctrl+wheel zoom, trim with snapping & ripple, split, reorder, lanes | ✅ |
| UI | Panels: adjust, filters (live previews), text, stickers & shapes, transitions, motion, speed, volume, crop, position, size/background, magic, layers, green screen | ✅ |
| Export | Image (PNG / JPEG / WebP, full resolution, "save this moment") | ✅ |
| Export | Video (WebCodecs + mediabunny, MP4/WebM, frame-exact decode, progress, cancel, low-memory streaming) | ✅ |
| Export | Real-time MediaRecorder fallback for browsers without WebCodecs | ✅ |
| Export | Share sheet on mobile, download on desktop | ✅ |
| Coach | Interactive tour, "What is this?" hints, glossary, next-step chip, first-project checklist | ✅ |
| Platform | PWA (installable, offline app shell), keyboard shortcuts, hash routing (back button) | ✅ |

## Phase 2 — Magic 🚧

| Item | Status |
| --- | --- |
| Auto-enhance (histogram-based) for photos and clips | ✅ |
| Remove silent parts (adaptive RMS threshold) | ✅ |
| Beat-sync slideshow (onset detection + tempo autocorrelation) | ✅ |
| Fit to platform with blurred background fill | ✅ |
| Green screen (chroma key with spill removal) | ✅ |
| Templates (Birthday, Travel diary, Vlog intro, Love story, Recipe steps, Big sale, Quote) | ✅ |
| Voice-over recording (microphone) | ⏳ |
| On-device background removal (segmentation model, lazy-loaded) | ⏳ |
| On-device auto captions (speech-to-text, lazy-loaded) | ⏳ |
| Smart reframe (subject-tracking crop for 9:16) | ⏳ |

## Phase 3 — Pro depth ⏳

* Keyframes for position / scale / rotation / opacity with easing presets.
* Tone curves (RGB + per channel) and HSL per colour band.
* Masks (shape, gradient, brush) and selective adjustments.
* Healing / clone brush and object eraser for photos.
* LUT import (`.cube`).
* Reverse, freeze frame, speed ramps.
* Audio: ducking under voice, noise reduction, EQ presets.
* Multi-select, grouping, copy / paste effects.
* GIF export; project backup files (`.kinora`) to move projects between devices.
* Animated GIF / sticker packs; more templates.

## Phase 4 — Scale & polish ⏳

* WebGPU renderer path (more effects, faster 4K).
* Decode and time-stretch in Web Workers; streaming audio mix for very long projects.
* Localisation (tool names, explanations and glossary are already centralised in `src/i18n`).
* Full accessibility audit (screen readers on the timeline, high-contrast theme).
* Optional cloud sync / sharing links (opt-in, end-to-end encrypted).

## Quality bar (applies to every phase)

* `npm run check` (typecheck), `npm test` (unit) and `npm run test:e2e` pass.
* Tool names, their explanations and the glossary are plain language and live in `src/i18n`.
* Every edit is undoable and auto-saved.
* Works with touch only, mouse only, and keyboard shortcuts.
* Checked at phone (390 × 844), tablet (820 × 1180) and desktop (1440 × 900) sizes.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Codec support varies (no AAC encoder in Firefox / Chromium on Linux) | Runtime capability detection; fall back to Opus / WebM. |
| Mobile memory limits with long 4K videos | Preview via `<video>`, decode only needed frames, cap preview resolution, stream exports to disk. |
| iOS autoplay / audio unlock rules | Audio unlocked on first tap; preview videos are muted, sound via Web Audio. |
| WebGL context loss on mobile | Listen for `webglcontextlost/restored`, rebuild GPU resources. |
| Browser storage eviction | `navigator.storage.persist()`, warning when saving fails. |
