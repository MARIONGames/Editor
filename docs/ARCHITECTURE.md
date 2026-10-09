# Kinora — Architecture

Kinora is a **100 % client-side** web application. Everything — decoding, effects,
rendering, audio mixing and encoding — runs in the browser on the user's device.
There is no server, no account and no upload. The build output is a set of static
files that can be hosted anywhere (GitHub Pages, Netlify, any CDN) and installed
as a PWA on phones and desktops.

## Technology choices

| Concern | Choice | Why |
| --- | --- | --- |
| Language | **TypeScript** (strict) | A large editor needs types to stay correct. |
| UI | **Preact + @preact/signals** | React-style components in ~4 kB; signals give fine-grained updates so the playhead can move 60×/s without re-rendering the timeline. |
| Build | **Vite** | Fast dev server, static production build, code-splitting (export code loads only when needed). |
| Rendering | **WebGL2** (16-bit float pipeline when available) | GPU speed for real-time preview *and* identical output for export. Works on every modern phone and desktop browser. |
| Video decode (preview) | `HTMLVideoElement` | Plays every format the browser supports, hardware accelerated, low memory. |
| Video decode (export, thumbnails) | **WebCodecs** via **mediabunny** | Frame-exact, faster than real time. Falls back to seeking a `<video>` element. |
| Encoding | **WebCodecs** `VideoEncoder`/`AudioEncoder` muxed by **mediabunny** (MP4 / WebM) | Pro-quality H.264 / VP9 / AV1 + AAC / Opus, controllable bitrate. Fallback: `MediaRecorder`. |
| Audio | **Web Audio API** (`AudioContext` for preview, `OfflineAudioContext` for export) | Sample-accurate mixing, fades, gain > 100 %; preview and export use the same mix code. |
| Storage | **IndexedDB** (projects + original media blobs) | Works offline, large quota, nothing leaves the device. |
| Icons | **lucide-preact** | Consistent, clear, tree-shaken SVG icons. |
| Tests | **Vitest** (unit) + **Playwright** (end-to-end in Chromium) | Model logic is pure and unit-tested; full flows are tested in a real browser. |

## High-level structure

```mermaid
flowchart LR
  subgraph UI["UI (Preact components)"]
    Home[Home & templates]
    Editor[Editor shell]
    Stage[Stage + gizmos]
    Timeline[Timeline]
    Panels[Tool panels / inspector]
    Coach[Coach: tour, hints, glossary]
    ExportUI[Export dialog]
  end

  subgraph State["State (signals)"]
    Store[(project, selection,\nplayhead, ui)]
    History[Undo / redo]
    Actions[Actions\n(plain-language commands)]
  end

  subgraph Model["Model (pure TS)"]
    Types[Types & schema]
    Ops[Immutable ops:\nsplit, trim, move,\nripple delete, ...]
    Geometry[Geometry & time math]
  end

  subgraph Engine["Engine"]
    Renderer[WebGL2 compositor]
    Effects[Develop shader,\nfilters, blur,\ntransitions, blend]
    Raster[Text / shape /\nsticker rasterizer]
    Playback[Playback clock\n+ video sync]
    Audio[Audio mixer]
    Media[Media: import, decode,\nthumbnails, waveforms]
    Exporter[Exporters:\nimage, video]
  end

  Storage[(IndexedDB)]
  Magic[Magic: auto-enhance,\nsilence removal,\nbeat sync]

  UI --> Actions --> Ops
  Actions --> History
  Ops --> Store
  Store --> UI
  Store --> Playback --> Renderer
  Renderer --> Effects
  Renderer --> Raster
  Playback --> Audio
  Media --> Storage
  Store -->|autosave| Storage
  Exporter --> Renderer
  Exporter --> Audio
  Magic --> Ops
```

### Layers and their rules

1. **`src/model`** — pure data and pure functions. No DOM, no globals, no I/O.
   Every edit is an immutable function `(project, …) => project` with structural
   sharing (unchanged tracks and clips keep their identity). This makes undo/redo
   trivial and the whole editing logic unit-testable in Node.
2. **`src/state`** — application state held in Preact signals, the history stack,
   and *actions*: user-level commands ("Split", "Delete", "Add text") that call
   model ops, record an undo step with a human-readable label, update selection
   and emit events for the coach.
3. **`src/engine`** — everything that touches media and the GPU: renderer,
   rasterizers, media import/decoding, playback, audio, exporters. The engine
   reads the project; it never mutates it.
4. **`src/ui`** — components. Components read signals and call actions. They never
   call model ops directly (so every user change is undoable and labelled).
5. **`src/coach`** and **`src/magic`** — the learning layer (tour, hints, glossary,
   next-step suggestions) and the "one-tap" features. Magic features analyse media
   and then apply ordinary model ops, so their results are normal, editable,
   undoable edits.

## Data model

```ts
Project {
  id, name, kind: 'video' | 'photo',
  width, height, fps,                 // output canvas
  background: { type: 'color', color } | { type: 'blur' },
  assets: Record<id, Asset>,          // metadata only; blobs live in IndexedDB
  tracks: Track[],                    // index 0 is drawn first (bottom)
}
Track  { id, kind: 'main' | 'overlay' | 'audio', clips: Clip[], muted, hidden, locked }
Clip   = MediaClip | TextClip | StickerClip | ShapeClip
ClipBase {
  id, start, duration,                // timeline position (seconds)
  transform { x, y, scale, rotation, flipX, flipY },   // x/y normalised 0..1
  opacity, blend,
  effects { adjust: Adjustments, filter?: { id, intensity }, chromaKey? },
  transition?  (main track: transition *into* this clip),
  animation?   { in, out, loop }      // overlays: fade, pop, slide, typewriter…
}
MediaClip  { assetId, in, speed, volume, fadeIn, fadeOut, crop, fit, motion }
TextClip   { text, style { font, size, weight, color, stroke, shadow, box, … } }
StickerClip{ emoji, size }
ShapeClip  { shape, width, height, fill, stroke }
```

### Track semantics (designed for beginners)

* **Main track ("Story")** is *magnetic*: clips are always packed back-to-back from
  0 s. Deleting a clip closes the gap, trimming ripples, dragging reorders.
  Beginners never see accidental black gaps. A transition overlaps the end of the
  previous clip with the start of the next (`start(n) = end(n-1) − transition`).
* **Overlay tracks** hold text, stickers, shapes and picture-in-picture. Users never
  manage them: *auto-lanes* put a new overlay on the first track that is free at
  that time, creating a new lane when needed, and empty lanes disappear.
* **Audio tracks** hold music and voice-overs, also auto-laned.
* **Photo projects** use the same model: every layer is a clip on its own overlay
  track at time 0 (track order = layer order), so photos get exactly the same
  renderer, effects, text and stickers as video.

Invariants are enforced by `normalizeProject()` after every op (pack the main
track, clamp transitions to half of the shorter neighbour, drop empty lanes,
clamp trims to the media length).

## Rendering pipeline

The same `Renderer` class draws the live preview and every exported frame, so
**what you see is exactly what you export**.

For a time `t` the compositor:

1. Clears an off-screen **RGBA16F** framebuffer (RGBA8 fallback) to the background.
2. Walks tracks bottom → top and finds the clips active at `t`
   (on the main track up to two clips during a transition).
3. For each clip:
   1. **Source** → texture: decoded video frame, image (mip-mapped for high-quality
      downscaling), or rasterised text / sticker / shape (cached per style + scale).
   2. **Effects** (only when non-neutral), rendered at the clip's on-screen
      resolution: optional blur pyramid (Gaussian, separable, downsampled for large
      radii) → **develop shader**: chroma key → sharpen / clarity (unsharp masks) →
      linearise → white balance → exposure → back to display gamma → brightness,
      contrast, highlights, shadows, whites, blacks → hue, saturation, vibrance →
      filter look (B&W mixer, split-toning, tone curve) → fade → vignette → grain.
   3. **Animation**: the clip's transform/opacity at local time (Ken Burns photo
      motion, in/out animations, loops).
   4. **Composite** with an affine transform, crop and opacity. Normal blending uses
      premultiplied-alpha GPU blending; other blend modes (multiply, screen,
      overlay, …) ping-pong between two framebuffers and blend in the shader.
4. Main-track transitions render the outgoing and incoming clips to two layer
   buffers and combine them with the transition shader (fade, dip, wipe, slide,
   push, zoom, circle, blur…).
5. Blits to the canvas with **ordered dithering** so 16-bit gradients don't band
   when quantised to 8 bits.

Preview renders at `stage size × devicePixelRatio` (adaptive on slow devices);
export renders at the chosen output resolution.

## Playback

* The clock is `performance.now()` while playing; audio is scheduled on the
  `AudioContext` timeline from the same anchor.
* Each visible video clip owns a pooled, muted `<video>` element. Every animation
  frame the engine computes the expected source time, plays/pauses elements, and
  re-seeks if drift exceeds ~0.15 s. When paused, scrubbing seeks precisely.
* Audio is decoded once per asset to an `AudioBuffer` and scheduled with
  `AudioBufferSourceNode`s with gain automation for volume and fades. Speed changes
  use a WSOLA time-stretch so voices keep their natural pitch — the exact same
  buffers are used by the exporter, so preview and export sound identical.

## Export

* **Image**: render once at full resolution → `canvas.toBlob()` (PNG / JPEG / WebP).
* **Video**: code-split module loaded on demand.
  1. Pick the best supported codec pair: H.264 + AAC in MP4 → H.264/VP9/AV1 + Opus →
     VP9 + Opus in WebM (checked with `isConfigSupported`).
  2. For each clip, a frame-exact iterator decodes exactly the frames needed
     (WebCodecs via mediabunny; fallback: seek a `<video>` element per frame).
  3. Render each output frame with the same `Renderer`, hand the canvas to the
     encoder with exact timestamps, respecting encoder back-pressure.
  4. Mix audio with `OfflineAudioContext` using the same mixer as preview, encode,
     mux, finalise. Progress + cancel throughout.
  5. Download or share (`navigator.share` with files on mobile).
* **Fallback** (no WebCodecs): real-time `MediaRecorder` capture of the canvas
  and the audio graph.

## Storage & persistence

IndexedDB database `kinora`:

| Store | Key | Value |
| --- | --- | --- |
| `projects` | project id | project JSON + small cover thumbnail |
| `media` | asset id | original `Blob` (never modified) |
| `derived` | asset id | thumbnails (filmstrip), waveform peaks |

Every change is auto-saved (debounced) and flushed on `pagehide`. The app asks for
persistent storage so the browser does not evict projects.

## The learning layer (coach)

* **Event bus**: actions emit semantic events (`media:added`, `clip:split`,
  `text:added`, `export:done`, …).
* **Tour**: a list of steps `{ target, title, body, until: event }`. A spotlight
  highlights the real control; the step completes when the user *does* the thing.
* **Hints**: every tool definition carries `label` + `hint` (plain language), shown
  on hover / long-press and at the top of its panel.
* **Next step**: rules over the project state suggest the single most useful next
  action ("Add music", "Add a title", "Export").
* **Glossary**: searchable definitions of every editing term the app uses.

## Magic features

All analysis happens locally, results are normal undoable edits:

* **Auto-enhance** — luminance/colour histograms → exposure, contrast, highlights,
  shadows, white balance and vibrance settings.
* **Remove silent parts** — RMS envelope of a clip's audio → silent ranges longer
  than a threshold → split + ripple delete.
* **Beat sync** — onset-strength envelope of the music → beat times → photo
  durations snapped to beats.
* **Fit to platform** — resize the canvas (9:16, 1:1, 4:5, 16:9) and re-fit clips;
  blurred background fills empty space.
* **Green screen** — chroma key in the develop shader.

## Directory layout

```
src/
  main.tsx              bootstrap
  app/                  app shell, routing, theme
  model/                types, defaults, ops, geometry, time math (pure)
  state/                signals store, history, actions, events, autosave
  engine/
    gl/                 WebGL2 helpers + shaders
    render/             renderer, rasterizers, animation
    media/              importer, storage, video pool, audio decode, waveforms
    playback.ts         preview clock and sync
    audio/              mixer, time-stretch
    export/             image & video exporters
  magic/                auto-enhance, silence detection, beat detection
  coach/                tour, hints, glossary, suggestions
  ui/                   components, home, editor, panels, timeline, stage, dialogs
  styles/               design tokens and component CSS
tests/
  unit/                 vitest
  e2e/                  playwright
```

## Browser support

Chrome / Edge 94+, Safari 16.4+, Firefox 130+ on desktop; Chrome on Android;
Safari on iOS 16.4+. Video export uses WebCodecs where available (all of the above
except older Firefox), with a real-time `MediaRecorder` fallback.
