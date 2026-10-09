import { Pause, Play, ZoomIn, ZoomOut, Eye } from 'lucide-preact';
import { formatTime } from '../../model/time';
import { preview } from '../../engine/preview';
import { compareOriginal, duration, isCompact, playhead, playing, zoom } from '../../state/store';
import { emit } from '../../state/events';

export function clampZoom(z: number): number {
  return Math.max(8, Math.min(1200, z));
}

export function Transport() {
  const compact = isCompact.value;
  const isPlaying = playing.value;
  return (
    <div class="transport">
      <button
        class="play-btn"
        onClick={() => {
          preview.toggle();
          if (!isPlaying) emit('playback:played', {});
        }}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        data-coach="play"
      >
        {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
      </button>
      <div class="time" aria-live="off">
        <span class="time-now">{formatTime(playhead.value)}</span>
        <span class="time-sep">/</span>
        <span class="time-total">{formatTime(duration.value)}</span>
      </div>
      <div class="transport-right">
        <button
          class={`icon-btn small ${compareOriginal.value ? 'active' : ''}`}
          title="Hold to see the original (before your changes)"
          aria-label="Hold to compare with the original"
          onPointerDown={() => (compareOriginal.value = true)}
          onPointerUp={() => (compareOriginal.value = false)}
          onPointerLeave={() => (compareOriginal.value = false)}
          onPointerCancel={() => (compareOriginal.value = false)}
        >
          <Eye size={18} />
        </button>
        {!compact && (
          <>
            <button class="icon-btn small" aria-label="Zoom out timeline" title="Zoom out (-)" onClick={() => (zoom.value = clampZoom(zoom.value / 1.5))}>
              <ZoomOut size={18} />
            </button>
            <input
              class="range zoom-range"
              type="range"
              min={Math.log(8)}
              max={Math.log(1200)}
              step={0.01}
              value={Math.log(zoom.value)}
              aria-label="Timeline zoom"
              onInput={(e) => (zoom.value = clampZoom(Math.exp(Number((e.target as HTMLInputElement).value))))}
            />
            <button class="icon-btn small" aria-label="Zoom in timeline" title="Zoom in (+)" onClick={() => (zoom.value = clampZoom(zoom.value * 1.5))}>
              <ZoomIn size={18} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
