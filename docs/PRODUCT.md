# Kinora — Product Vision

> **Pro-quality photo & video editing. Ridiculously easy.**

## The name

**Kinora** was an 1890s "moving picture" viewer: you turned a handle and a reel
of photographs came to life, like a flip book. It is one of the earliest
"make pictures move" machines that *anyone* could use, with no training.

That is the whole idea of this product:

* **Kino** — cinema / motion (Greek *kinēma*, "movement").
* It works for photos **and** video (a Kinora literally turned photos into a movie).
* It is short, easy to say in most languages, and does not sound like jargon.

## Who it is for

| Persona | What they want | What usually stops them |
| --- | --- | --- |
| **The first-timer** (has never edited anything) | "Make my holiday clips into one nice video with music." | Doesn't know what *cut*, *trim*, *timeline*, *keyframe* or *export* mean. |
| **The casual creator** | Quick posts for TikTok / Reels / Shorts / Instagram. | Pro tools are slow to learn; phone apps are limited or full of ads/watermarks. |
| **The photo fixer** | Make a dark or dull photo look great, crop it, add text. | Photoshop is expensive and overwhelming. |
| **The teacher / small business** | Slideshows, announcements, product videos. | No time to learn. Needs it to work on any computer or phone. |

## Promise

1. **You can finish your first project in under 5 minutes** without reading anything.
2. **Every result looks professional by default** — good fonts, smooth transitions,
   correct colours, sharp exports at full resolution.
3. **Nothing is ever lost** — every change is saved on your device and can be undone.
4. **Private** — your photos and videos never leave your device. No account needed.
5. **Works everywhere** — phone, tablet, laptop, desktop; mouse, touch or keyboard.

## Design principles ("the Kinora rules")

1. **Say what it does, not what it's called.**
   Every tool is a plain verb with a one-line explanation.
   *Split* → "Cut this clip into two pieces at the white line."
   Jargon is allowed only together with its explanation (and is in the glossary).
2. **Start from a goal, not from an empty canvas.**
   The home screen asks *"What do you want to make?"* and sets everything up
   (aspect ratio, tracks, suggested steps) for that goal.
3. **Always show one obvious next step.**
   A friendly *Next step* suggestion and a first-project checklist guide the user.
4. **Touch the thing you want to change.**
   Drag text on the picture to move it, pinch to resize, drag a clip's edge to shorten it.
5. **Magic buttons, honest results.**
   One-tap *Auto-enhance*, *Remove silent parts*, *Sync photos to the beat*,
   *Fit for TikTok* — always previewed, always undoable.
6. **Pro quality under the hood.**
   GPU rendering in 16-bit float, exposure in linear light, high-quality scaling,
   full-resolution export, high bitrate encoders, dithered output (no banding).
7. **Progressive disclosure.**
   The simple controls come first; "More" reveals pro controls. Beginners are never
   shown 40 sliders at once, experts are never blocked.
8. **Forgiving.** Unlimited undo, auto-save, confirmations only when something
   cannot be undone (e.g. deleting a project).
9. **Teach by doing.** A short interactive tour that advances when the user actually
   does each step, "What is this?" on every tool, and a searchable glossary.
10. **Accessible.** Large targets (≥ 44 px), keyboard shortcuts, screen-reader labels,
    reduced-motion support, light & dark themes.

## Feature map

| Area | Beginner sees | Pro can reach |
| --- | --- | --- |
| Start | Goal cards (Edit a photo, Make a video, Slideshow, Quick trim, Templates) | Custom size / frame rate |
| Arrange | Magnetic "story" track (no gaps, drag to reorder) + auto-lanes for text & stickers | Multiple overlay & audio tracks, snapping |
| Cut | **Split** at the white line, drag edges to **trim**, **Delete** closes the gap | Frame-accurate stepping, duplicate, speed |
| Look | **Auto-enhance**, filters with intensity | Exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, hue, clarity, sharpen, blur, vignette, grain, fade |
| Words | Text styles (Title, Caption, Meme, Neon…) | Font, size, colour, outline, shadow, background box, spacing, animations |
| Motion | Transitions (Fade, Slide, Zoom…), photo motion (Ken Burns), text animations | Durations, apply to all |
| Sound | Add music, volume, fade in/out, **Remove silent parts** | Per-clip & per-track volume, speed with natural pitch |
| Magic | Auto-enhance, Remove silent parts, Beat-sync slideshow, Fit to platform | Chroma key (green screen) |
| Share | "Where will you share it?" presets | Resolution, frame rate, quality/bitrate, MP4/WebM, PNG/JPEG/WebP |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is built and
[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the roadmap.
