/** Live preview audio: one AudioContext, scheduling and stopping the mix. */
import type { Project } from '../../model/types';
import { peekAudio } from './library';
import { createMasterChain, scheduleAudio } from './mixer';

type AudioCtor = typeof AudioContext;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: AudioBufferSourceNode[] = [];

  /** Creates/resumes the context. Call from a user gesture (iOS requirement). */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      const Ctor: AudioCtor | undefined =
        globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return null;
      }
      this.master = createMasterChain(this.ctx).input;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /**
   * Starts the mix at timeline time `from`.
   * Returns the performance.now() timestamp at which `from` will be heard.
   */
  start(p: Project, from: number): number {
    this.stop();
    const ctx = this.ensure();
    const lead = 0.06;
    if (!ctx || !this.master) return performance.now() + lead * 1000;
    const when = ctx.currentTime + lead;
    this.nodes = scheduleAudio(ctx, this.master, p, {
      from,
      when,
      getBuffer: (id) => peekAudio(id),
      allowStretch: true,
    });
    let perfAtWhen = performance.now() + lead * 1000;
    try {
      const ts = ctx.getOutputTimestamp?.();
      if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
        perfAtWhen = ts.performanceTime + (when - ts.contextTime) * 1000;
      }
    } catch {
      /* keep estimate */
    }
    return perfAtWhen;
  }

  stop(): void {
    for (const n of this.nodes) {
      try {
        n.stop();
        n.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.nodes = [];
  }

  setMuted(muted: boolean): void {
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }
}
