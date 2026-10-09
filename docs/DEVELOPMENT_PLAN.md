# Kinora — Development Plan

The plan is split into phases. Each phase ends with something a real user can
use end-to-end. Status: ✅ done · 🚧 in progress · ⏳ planned.

## Phase 0 — Foundations ✅

| Item | Status |
| --- | --- |
| Name, product vision, design principles ([PRODUCT.md](PRODUCT.md)) | ✅ |
| Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)) | ✅ |
| Tooling: Vite + TypeScript (strict) + Preact/signals, Vitest, Playwright | ✅ |
| CI (GitHub Actions): typecheck, unit tests, build | ✅ |
| Design tokens: dark/light themes, spacing, type scale, touch targets | ✅ |

## Phase 1 — "My first project" (MVP) ✅

Goal: a beginner can make and export a photo edit or a short video on a phone or PC.

| Area | Item | Status |
| --- | --- | --- |
| Model | Project / track / clip model, immutable ops, normaliser | ✅ |
| Model | Magnetic main track, auto-lanes, transitions overlap | ✅ |
| State | Signals store, undo/redo with coalescing + labels, autosave | ✅ |
| Engine | WebGL2 compositor, 16F pipeline, dithered output | ✅ |
| Engine | Develop shader: 17 adjustments + filter looks + chroma key | ✅ |
| Engine | Gaussian blur pyramid (blur, sharpen, clarity, blurred background) | ✅ |
| Engine | Transitions (13 types) and blend modes | ✅ |
| Engine | Text, sticker (emoji) and shape rasterisers | ✅ |
| Media | Import by picker, drag & drop and paste; probe, thumbnails, waveforms | ✅ |
| Media | IndexedDB storage of projects and original media | ✅ |
| Playback | Clock, pooled `<video>` sync, Web Audio scheduling, scrubbing | ✅ |
| UI | Home: goal cards, aspect-ratio picker, recent projects | ✅ |
| UI | Editor: responsive layout (phone / tablet / desktop) | ✅ |
| UI | Stage: select, move, pinch/scale, rotate, snapping guides | ✅ |
| UI | Timeline: centre playhead, pinch zoom, trim handles, split, reorder, lanes | ✅ |
| UI | Panels: adjust, filters, text, stickers, transitions, animation, speed, volume, crop, canvas, layers | ✅ |
| Export | Image (PNG / JPEG / WebP, full resolution) | ✅ |
| Export | Video (WebCodecs + mediabunny, MP4/WebM, progress, cancel) | ✅ |
| Export | Share sheet on mobile, download on desktop | ✅ |
| Coach | Interactive tour, "What is this?" hints, glossary, next-step chip, first-project checklist | ✅ |
| Platform | PWA (installable, offline app shell), keyboard shortcuts | ✅ |

## Phase 2 — Magic ✅ / 🚧

| Item | Status |
| --- | --- |
| Auto-enhance (histogram-based) for photos and clips | ✅ |
| Remove silent parts (RMS-based) | ✅ |
| Beat-sync slideshow (onset detection) | ✅ |
| Fit to platform with blurred background fill | ✅ |
| Green screen (chroma key) | ✅ |
| Templates (Birthday, Travel, Promo, Meme, Quote…) | ✅ |
| Voice-over recording (microphone) | ⏳ |
| On-device background removal (MediaPipe / ONNX segmentation, lazy-loaded) | ⏳ |
| On-device auto captions (Whisper via WebGPU/WASM, lazy-loaded) | ⏳ |
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

## Phase 4 — Scale & polish ⏳

* WebGPU renderer path (more effects, faster 4K).
* Streaming audio mixing for very long projects.
* Localisation (strings already centralised).
* Full accessibility audit (screen readers on timeline, high-contrast theme).
* Optional cloud sync / sharing links (opt-in, end-to-end encrypted).

## Quality bar (applies to every phase)

* `npm run check` (typecheck) and `npm test` (unit) pass; e2e smoke test passes.
* Every user-visible string is plain language and lives in `src/i18n`.
* Every edit is undoable and auto-saved.
* Works with touch only, mouse only, and keyboard only.
* Tested at 375 × 812 (phone), 820 × 1180 (tablet) and 1440 × 900 (desktop).

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Codec support varies (no AAC encoder in Firefox / Chromium on Linux) | Runtime capability detection; fall back to Opus / WebM. |
| Mobile memory limits with long 4K videos | Preview via `<video>`, decode only needed ranges, cap preview resolution. |
| iOS autoplay / audio unlock rules | Audio unlocked on first tap; preview videos are muted, audio via Web Audio. |
| WebGL context loss on mobile | Listen for `webglcontextlost/restored`, rebuild GPU resources. |
| Browser storage eviction | `navigator.storage.persist()`, warning when quota is low. |
