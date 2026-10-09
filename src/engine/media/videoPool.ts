/**
 * Pool of muted <video> elements used for live preview. Each visible video clip
 * gets its own element (two pieces of one video can be on screen at once during a
 * transition). Sound is played separately through Web Audio.
 */
import { peekUrl } from './mediaStore';

export interface PooledVideo {
  el: HTMLVideoElement;
  assetId: string;
  /** Increments every time a new frame is presented (drives GPU re-uploads). */
  frame: number;
  seeking: boolean;
  pendingSeek: number | null;
  lastUsed: number;
  playing: boolean;
  wantPlay: boolean;
}

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

const MAX_ELEMENTS = 10;

export class VideoPool {
  private items = new Map<string, PooledVideo>();
  private container: HTMLElement | null = null;
  private tick = 0;
  /** Called whenever a new frame is ready to be drawn. */
  onFrame: (() => void) | null = null;

  private host(): HTMLElement {
    if (!this.container) {
      const c = document.createElement('div');
      c.setAttribute('aria-hidden', 'true');
      // Some mobile browsers stop decoding videos that are not in the document.
      c.style.cssText =
        'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(c);
      this.container = c;
    }
    return this.container;
  }

  get(clipId: string, assetId: string): PooledVideo | null {
    this.tick++;
    let pv = this.items.get(clipId);
    if (pv && pv.assetId !== assetId) {
      this.release(clipId);
      pv = undefined;
    }
    if (pv) {
      pv.lastUsed = this.tick;
      return pv;
    }
    const url = peekUrl(assetId);
    if (!url) return null;
    const el = document.createElement('video') as VideoWithRVFC;
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.preload = 'auto';
    el.disablePictureInPicture = true;
    el.src = url;
    const item: PooledVideo = {
      el,
      assetId,
      frame: 0,
      seeking: false,
      pendingSeek: null,
      lastUsed: this.tick,
      playing: false,
      wantPlay: false,
    };
    const bump = () => {
      item.frame++;
      this.onFrame?.();
    };
    el.addEventListener('loadeddata', bump);
    el.addEventListener('seeked', () => {
      item.seeking = false;
      bump();
      if (item.pendingSeek !== null) {
        const t = item.pendingSeek;
        item.pendingSeek = null;
        this.seek(item, t);
      }
    });
    if (el.requestVideoFrameCallback) {
      const loop = () => {
        bump();
        if (this.items.get(clipId) === item) el.requestVideoFrameCallback!(loop);
      };
      el.requestVideoFrameCallback(loop);
    } else {
      el.addEventListener('timeupdate', bump);
    }
    this.host().appendChild(el);
    this.items.set(clipId, item);
    this.evict();
    return item;
  }

  /** Precise seek that coalesces requests while one is in flight. */
  seek(item: PooledVideo, time: number): void {
    const el = item.el;
    const t = Math.max(0, Math.min(time, (el.duration || time + 1) - 0.001));
    if (item.seeking) {
      item.pendingSeek = t;
      return;
    }
    if (Math.abs(el.currentTime - t) < 0.001 && el.readyState >= 2) return;
    item.seeking = true;
    try {
      el.currentTime = t;
    } catch {
      item.seeking = false;
    }
  }

  play(item: PooledVideo, rate: number): void {
    item.wantPlay = true;
    if (Math.abs(item.el.playbackRate - rate) > 0.001) item.el.playbackRate = rate;
    if (item.el.paused && !item.playing) {
      item.playing = true;
      item.el.play().catch(() => {
        item.playing = false;
      });
    }
  }

  pause(item: PooledVideo): void {
    item.wantPlay = false;
    item.playing = false;
    if (!item.el.paused) item.el.pause();
  }

  pauseAll(): void {
    for (const item of this.items.values()) this.pause(item);
  }

  /** Pause and drop elements whose clips are not in `active`. */
  retain(active: Set<string>): void {
    for (const [id, item] of this.items) {
      if (!active.has(id)) this.pause(item);
    }
    this.evict(active);
  }

  private evict(keep?: Set<string>): void {
    if (this.items.size <= MAX_ELEMENTS) return;
    const sorted = [...this.items.entries()]
      .filter(([id]) => !keep?.has(id))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.items.size > MAX_ELEMENTS && sorted.length) {
      const [id] = sorted.shift()!;
      this.release(id);
    }
  }

  release(clipId: string): void {
    const item = this.items.get(clipId);
    if (!item) return;
    this.items.delete(clipId);
    item.el.pause();
    item.el.removeAttribute('src');
    item.el.load();
    item.el.remove();
  }

  releaseAll(): void {
    for (const id of [...this.items.keys()]) this.release(id);
  }

  /** Must run inside a user gesture on iOS so later play() calls are allowed. */
  unlock(): void {
    for (const item of this.items.values()) {
      if (item.el.paused) {
        const p = item.el.play();
        p.then(() => {
          if (!item.wantPlay) item.el.pause();
        }).catch(() => undefined);
      }
    }
  }
}
