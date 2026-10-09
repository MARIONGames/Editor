/**
 * Live preview: owns the render loop, the playback clock, video-element sync and
 * preview audio. UI components talk to the singleton `preview`.
 */
import { effect } from '@preact/signals';
import { projectDuration } from '../model/ops';
import type { Asset, MediaClip, Project } from '../model/types';
import {
  compareOriginal,
  editingTextId,
  playhead,
  playing,
  project,
  selectionId,
} from '../state/store';
import { AudioEngine } from './audio/audioEngine';
import { loadAudio, onAudioDecoded, warmStretch } from './audio/library';
import { onImageDecoded, peekImage } from './media/images';
import { onMediaReady } from './media/mediaStore';
import { VideoPool } from './media/videoPool';
import { fontsVersion } from './render/rasterize';
import type { MediaFrame, MediaProvider, Renderer } from './render/renderer';

class PreviewProvider implements MediaProvider {
  readonly pool = new VideoPool();
  maxImageDim = 4096;
  playing = false;

  frame(clip: MediaClip, asset: Asset, _sourceTime: number): MediaFrame | null {
    if (asset.kind === 'image') {
      const bmp = peekImage(asset.id, this.maxImageDim);
      return bmp ? { source: bmp, width: bmp.width, height: bmp.height, frameId: `${bmp.width}`, isStatic: true } : null;
    }
    const pv = this.pool.get(clip.id, asset.id);
    if (!pv || pv.el.readyState < 2 || !pv.el.videoWidth) return null;
    return {
      source: pv.el,
      width: pv.el.videoWidth,
      height: pv.el.videoHeight,
      frameId: this.playing ? `${pv.frame}:${pv.el.currentTime}` : pv.frame,
      isStatic: false,
    };
  }

  /** Puts every needed <video> at the right moment (and playing/paused). */
  sync(p: Project, t: number, isPlaying: boolean): void {
    this.playing = isPlaying;
    const needed = new Set<string>();
    for (const track of p.tracks) {
      if (track.kind === 'audio' || track.hidden) continue;
      for (const clip of track.clips) {
        if (clip.type !== 'media') continue;
        const asset = p.assets[clip.assetId];
        if (!asset || asset.kind !== 'video') continue;
        const end = clip.start + clip.duration;
        const activeNow = t >= clip.start && t < end;
        const upcoming = isPlaying && clip.start > t && clip.start - t < 1.2;
        if (!activeNow && !upcoming) continue;
        const pv = this.pool.get(clip.id, asset.id);
        if (!pv) continue;
        needed.add(clip.id);
        const srcT = activeNow ? clip.in + (t - clip.start) * clip.speed : clip.in;
        if (activeNow && isPlaying) {
          this.pool.play(pv, clip.speed);
          const drift = pv.el.currentTime - srcT;
          if (!pv.seeking && Math.abs(drift) > 0.15) this.pool.seek(pv, srcT + 0.03 * clip.speed);
        } else {
          this.pool.pause(pv);
          const frameTol = 0.5 / (p.fps || 30);
          if (Math.abs(pv.el.currentTime - srcT) > frameTol || pv.pendingSeek !== null) this.pool.seek(pv, srcT);
        }
      }
    }
    this.pool.retain(needed);
  }
}

class Preview {
  readonly provider = new PreviewProvider();
  readonly audio = new AudioEngine();
  private renderer: Renderer | null = null;
  private raf = 0;
  private dirty = true;
  private anchorPerf = 0;
  private anchorT = 0;
  /** Extra hook called after each rendered frame (e.g. gizmo overlay). */
  afterRender: (() => void) | null = null;

  constructor() {
    this.provider.pool.onFrame = () => this.requestRender();
    onImageDecoded(() => this.requestRender());
    onMediaReady(() => this.requestRender());
    onAudioDecoded(() => {
      if (playing.peek()) this.restartAudio();
    });
    effect(() => {
      // Re-render when anything visual changes.
      void project.value;
      void compareOriginal.value;
      void fontsVersion.value;
      void editingTextId.value;
      void selectionId.value;
      void playhead.value;
      void playing.value;
      this.requestRender();
    });
    let lastProject: Project | null = null;
    effect(() => {
      const p = project.value;
      if (p && p !== lastProject) {
        lastProject = p;
        this.prefetchAudio(p);
        if (playing.peek()) this.restartAudio();
      }
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && playing.peek()) this.pause();
      });
    }
  }

  attach(renderer: Renderer | null): void {
    this.renderer = renderer;
    if (renderer) {
      this.provider.maxImageDim = Math.min(renderer.maxTextureSize, isLowMemoryDevice() ? 2048 : 4096);
      renderer.onRestored = () => this.requestRender();
    }
    this.requestRender();
  }

  /** Renders the current frame synchronously (e.g. right before reading the canvas). */
  renderNow(): void {
    this.dirty = true;
    this.renderFrame();
  }

  requestRender(): void {
    this.dirty = true;
    if (!this.raf && typeof requestAnimationFrame !== 'undefined') {
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  private loop = (): void => {
    this.raf = 0;
    const p = project.peek();
    if (playing.peek() && p) {
      const dur = projectDuration(p);
      let t = this.anchorT + (performance.now() - this.anchorPerf) / 1000;
      if (t < this.anchorT) t = this.anchorT;
      if (t >= dur) {
        t = dur;
        playhead.value = dur;
        this.pause();
      } else {
        playhead.value = t;
      }
      this.dirty = true;
    }
    this.renderFrame();
    if (playing.peek()) this.raf = requestAnimationFrame(this.loop);
  };

  private renderFrame(): void {
    const p = project.peek();
    if (this.dirty && this.renderer && p) {
      this.dirty = false;
      const t = playhead.peek();
      // Show the very last frame instead of black at the end.
      const rt = Math.min(t, Math.max(0, projectDuration(p) - 1 / (p.fps || 30)));
      this.provider.sync(p, rt, playing.peek());
      try {
        this.renderer.render(p, p.kind === 'photo' ? 0 : rt, this.provider, {
          original: compareOriginal.peek(),
          checker: p.background.color === 'transparent',
          // While paused, show the selected item fully (not mid-animation) so you can see what you edit.
          staticClipId: playing.peek() ? null : selectionId.peek(),
        });
      } catch (err) {
        console.error('Render failed', err);
      }
      this.afterRender?.();
    }
  }

  /* --------------------------------------------------------------- playback */

  play(): void {
    const p = project.peek();
    if (!p || p.kind === 'photo') return;
    const dur = projectDuration(p);
    if (dur <= 0) return;
    let from = playhead.peek();
    if (from >= dur - 0.05) from = 0;
    this.audio.ensure();
    this.provider.pool.unlock();
    this.anchorT = from;
    this.anchorPerf = this.audio.start(p, from);
    playhead.value = from;
    playing.value = true;
    this.requestRender();
  }

  pause(): void {
    if (!playing.peek()) return;
    playing.value = false;
    this.audio.stop();
    this.provider.pool.pauseAll();
    this.requestRender();
  }

  toggle(): void {
    if (playing.peek()) this.pause();
    else this.play();
  }

  seek(t: number): void {
    const p = project.peek();
    if (!p) return;
    const dur = projectDuration(p);
    const nt = Math.max(0, Math.min(dur, t));
    playhead.value = nt;
    if (playing.peek()) {
      this.anchorT = nt;
      this.anchorPerf = this.audio.start(p, nt);
    }
    this.requestRender();
  }

  private restartAudio(): void {
    const p = project.peek();
    if (!p || !playing.peek()) return;
    const t = playhead.peek();
    this.anchorT = t;
    this.anchorPerf = this.audio.start(p, t);
  }

  private prefetchAudio(p: Project): void {
    for (const t of p.tracks) {
      if (t.muted) continue;
      for (const c of t.clips) {
        if (c.type !== 'media') continue;
        const a = p.assets[c.assetId];
        if (!a || !(a.kind === 'audio' || (a.kind === 'video' && a.hasAudio))) continue;
        void loadAudio(a.id).then(() => warmStretch(c));
      }
    }
  }

  stopAll(): void {
    this.pause();
    this.provider.pool.releaseAll();
  }
}

function isLowMemoryDevice(): boolean {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (mem !== undefined && mem <= 4) || /iPhone|iPad|Android/i.test(navigator.userAgent);
}

export const preview = new Preview();
