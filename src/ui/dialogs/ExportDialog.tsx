import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CircleCheck, Download, Image as ImageIcon, Share2, Sparkles, Zap, Gem, Mail } from 'lucide-preact';
import { projectDuration } from '../../model/ops';
import { formatDuration } from '../../model/time';
import type { Project } from '../../model/types';
import { exportImage, type ImageFormat } from '../../engine/export/imageExport';
import { canUseWebCodecs, ExportCancelled, exportVideo, hasAudibleClips, type ExportResult } from '../../engine/export/videoExport';
import { flushSave } from '../../state/persist';
import { emit } from '../../state/events';
import { playhead, project, toast } from '../../state/store';
import { preview } from '../../engine/preview';
import { inHostFrame, saveFile } from '../../platform/host';
import { Dialog } from '../components/Dialog';
import { Segmented, Switch } from '../components/Controls';
import { Slider } from '../components/Slider';
import { closeDialog } from './dialogState';

type Preset = 'best' | 'social' | 'small';

const PRESETS: { id: Preset; title: string; text: string; short: number; bpp: number; icon: typeof Gem }[] = [
  { id: 'social', title: 'Social media', text: 'TikTok, Instagram, YouTube, Facebook — sharp and quick to upload', short: 1080, bpp: 0.1, icon: Sparkles },
  { id: 'best', title: 'Best quality', text: 'The sharpest result — for keeping, TVs and editing later', short: 1080, bpp: 0.17, icon: Gem },
  { id: 'small', title: 'Small file', text: 'For WhatsApp, messages and email', short: 720, bpp: 0.06, icon: Mail },
];

const RESOLUTIONS = [
  { short: 480, label: '480p' },
  { short: 720, label: '720p (HD)' },
  { short: 1080, label: '1080p (Full HD)' },
  { short: 1440, label: '1440p (2K)' },
  { short: 2160, label: '2160p (4K)' },
];

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

function outputSize(p: Project, short: number): { w: number; h: number } {
  const s = short / Math.min(p.width, p.height);
  return { w: even(p.width * s), h: even(p.height * s) };
}

function fileName(p: Project, ext: string): string {
  const base = p.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'kinora';
  return `${base}.${ext}`;
}

async function download(blob: Blob, name: string): Promise<void> {
  const outcome = await saveFile(blob, name);
  if (outcome === 'saved') toast(`Saved “${name}”`, 'success');
  else if (outcome === 'declined') toast('Not saved.');
  else toast('Saving files isn’t available here. Open Kinora in its own browser tab to save.', 'error', undefined, 6000);
}

async function share(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare?.({ files: [file] })) return false;
  try {
    await nav.share({ files: [file], title: name });
    return true;
  } catch (err) {
    return (err as Error)?.name === 'AbortError';
  }
}

export function ExportDialog() {
  const p = project.value!;
  const isVideo = p.kind === 'video';
  const [preset, setPreset] = useState<Preset>('social');
  const [more, setMore] = useState(false);
  const [short, setShort] = useState(Math.min(1080, Math.min(p.width, p.height)));
  const [fps, setFps] = useState(p.fps || 30);
  const [quality, setQuality] = useState(100);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [audio, setAudio] = useState(true);
  const [imgFormat, setImgFormat] = useState<ImageFormat>(p.background.color === 'transparent' ? 'png' : 'jpeg');
  const [imgQuality, setImgQuality] = useState(92);
  const [imgScale, setImgScale] = useState(1);
  const [phase, setPhase] = useState<'setup' | 'working' | 'done' | 'error'>('setup');
  const [progress, setProgress] = useState({ f: 0, msg: '' });
  const [result, setResult] = useState<{ blob: Blob; name: string; details: string } | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const url = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const dur = projectDuration(p);
  const pr = PRESETS.find((x) => x.id === preset)!;
  const chosenShort = more ? short : Math.min(pr.short, Math.max(240, Math.min(p.width, p.height)));
  const size = outputSize(p, chosenShort);
  const bitrate = Math.min(60e6, Math.max(0.6e6, size.w * size.h * (more ? fps : 30) * pr.bpp * (more ? quality / 100 : 1)));
  const withAudio = audio && hasAudibleClips(p);
  const estBytes = ((bitrate + (withAudio ? 192000 : 0)) * dur) / 8;

  const start = async () => {
    preview.pause();
    await flushSave();
    setPhase('working');
    setProgress({ f: 0, msg: 'Getting ready…' });
    emit('export:started', { kind: isVideo ? 'video' : 'image' });
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      if (isVideo) {
        const r: ExportResult = await exportVideo(
          p,
          { width: size.w, height: size.h, fps: more ? fps : p.fps || 30, bitrate, format, includeAudio: audio },
          (f, msg) => setProgress({ f, msg }),
          ctrl.signal,
        );
        setResult({ blob: r.blob, name: fileName(p, r.ext), details: `${size.w}×${size.h} · ${r.details}` });
      } else {
        setProgress({ f: 0.5, msg: 'Creating your picture…' });
        const blob = await exportImage(p, { format: imgFormat, quality: imgQuality / 100, scale: imgScale });
        setResult({ blob, name: fileName(p, imgFormat === 'jpeg' ? 'jpg' : imgFormat), details: `${Math.round(p.width * imgScale)}×${Math.round(p.height * imgScale)} · ${imgFormat.toUpperCase()}` });
      }
      setPhase('done');
      emit('export:done', { kind: isVideo ? 'video' : 'image' });
    } catch (err) {
      if (err instanceof ExportCancelled) {
        setPhase('setup');
        return;
      }
      console.error(err);
      setError(err instanceof Error ? err.message : 'Something went wrong while exporting.');
      setPhase('error');
    }
  };

  const saveFrame = async () => {
    preview.pause();
    setPhase('working');
    setProgress({ f: 0.5, msg: 'Saving this moment as a photo…' });
    try {
      const blob = await exportImage(p, { format: 'png', quality: 1, scale: 1, time: playhead.peek() });
      setResult({ blob, name: fileName(p, 'png').replace('.png', ` ${formatDuration(playhead.peek())}.png`), details: `${p.width}×${p.height} · PNG` });
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the frame.');
      setPhase('error');
    }
  };

  const close = () => {
    abort.current?.abort();
    closeDialog();
  };

  if (phase === 'working') {
    return (
      <Dialog title={isVideo ? 'Creating your video' : 'Creating your picture'} onClose={close}>
        <div class="export-working">
          <div class="spinner big" />
          <div class="progress big">
            <div class="progress-fill" style={{ width: `${Math.round(progress.f * 100)}%` }} />
          </div>
          <p class="muted">
            {Math.round(progress.f * 100)}% — {progress.msg}
          </p>
          <p class="faint">Keep this tab open. Everything happens on your device — nothing is uploaded.</p>
          <button class="btn ghost" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        </div>
      </Dialog>
    );
  }

  if (phase === 'done' && result && url) {
    const canShare = typeof navigator.share === 'function' && !inHostFrame;
    return (
      <Dialog title="It’s ready! 🎉" subtitle={result.details} onClose={close}>
        <div class="export-done">
          {result.blob.type.startsWith('video') ? (
            <video src={url} controls playsInline class="export-preview" />
          ) : (
            <img src={url} alt="Your exported picture" class="export-preview" />
          )}
          <div class="row wrap-gap center">
            <button class="btn primary" onClick={() => void download(result.blob, result.name)}>
              <Download size={18} /> Save to device
            </button>
            {canShare && (
              <button
                class="btn"
                onClick={async () => {
                  const ok = await share(result.blob, result.name);
                  if (!ok) toast('Sharing is not available here — use “Save to device”.');
                }}
              >
                <Share2 size={18} /> Share
              </button>
            )}
          </div>
          <p class="faint center-text">
            <CircleCheck size={14} /> {result.name} · {(result.blob.size / 1e6).toFixed(1)} MB
          </p>
          <button class="btn ghost small" onClick={() => setPhase('setup')}>
            Change export settings
          </button>
        </div>
      </Dialog>
    );
  }

  if (phase === 'error') {
    return (
      <Dialog title="Export didn’t work" onClose={close} footer={<button class="btn primary" onClick={() => setPhase('setup')}>Try again</button>}>
        <p>{error}</p>
        <p class="faint">Tips: try “Small file”, or the WebM format under More options. Your project is safe.</p>
      </Dialog>
    );
  }

  if (!isVideo) {
    return (
      <Dialog
        title="Export photo"
        subtitle={`${p.width} × ${p.height} pixels`}
        onClose={close}
        footer={
          <button class="btn primary block" onClick={start}>
            <ImageIcon size={18} /> Create photo
          </button>
        }
      >
        <div class="field">
          <span class="field-label">File type</span>
          <Segmented
            value={imgFormat}
            onChange={setImgFormat}
            options={[
              { value: 'jpeg', label: 'JPEG', title: 'Smaller files. Best for photos.' },
              { value: 'png', label: 'PNG', title: 'Perfect quality, keeps transparency.' },
              { value: 'webp', label: 'WebP', title: 'Modern: small and high quality.' },
            ]}
          />
          <span class="faint">
            {imgFormat === 'jpeg' ? 'Best for sharing photos — small files.' : imgFormat === 'png' ? 'Perfect quality and see-through backgrounds. Bigger files.' : 'Small and sharp. Works in modern apps and browsers.'}
          </span>
        </div>
        {imgFormat !== 'png' && (
          <Slider label="Quality" value={imgQuality} min={50} max={100} defaultValue={92} format={(v) => `${Math.round(v)}%`} onChange={(v) => setImgQuality(v)} />
        )}
        <div class="field">
          <span class="field-label">Size</span>
          <Segmented
            value={imgScale}
            onChange={setImgScale}
            options={[
              { value: 1, label: `Full (${p.width}×${p.height})` },
              { value: 0.5, label: 'Half' },
              { value: 0.25, label: 'Quarter' },
            ]}
          />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Export video"
      subtitle={`${formatDuration(dur)} long`}
      onClose={close}
      wide
      footer={
        <>
          <span class="faint grow">
            {size.w}×{size.h} · about {estBytes > 1e9 ? `${(estBytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(estBytes / 1e6))} MB`}
          </span>
          <button class="btn primary" onClick={start} disabled={dur <= 0} data-coach="export-go">
            <Zap size={18} /> Create video
          </button>
        </>
      }
    >
      <div class="export-presets" role="radiogroup" aria-label="Where will you share it?">
        {PRESETS.map((x) => (
          <button key={x.id} role="radio" aria-checked={preset === x.id} class={`export-preset ${preset === x.id ? 'on' : ''}`} onClick={() => setPreset(x.id)}>
            <x.icon size={22} />
            <span class="grow">
              <strong>
                {x.title}
                {x.id === 'social' && <span class="badge magic">Recommended</span>}
              </strong>
              <span>{x.text}</span>
            </span>
          </button>
        ))}
      </div>
      <button class="btn small ghost" onClick={() => setMore(!more)}>
        {more ? 'Fewer options' : 'More options'}
      </button>
      {more && (
        <div class="export-more">
          <label class="field">
            <span class="field-label">Resolution</span>
            <select class="select" value={short} onChange={(e) => setShort(Number((e.target as HTMLSelectElement).value))}>
              {RESOLUTIONS.map((r) => (
                <option key={r.short} value={r.short}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <div class="field">
            <span class="field-label">Smoothness (frames per second)</span>
            <Segmented value={fps} onChange={setFps} options={[24, 25, 30, 60].map((v) => ({ value: v, label: String(v) }))} />
          </div>
          <Slider label="Quality" value={quality} min={40} max={250} defaultValue={100} format={(v) => `${Math.round(v)}%`} hint="Higher = sharper and bigger file" onChange={(v) => setQuality(v)} />
          <div class="field">
            <span class="field-label">File type</span>
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'mp4', label: 'MP4 (works everywhere)' },
                { value: 'webm', label: 'WebM' },
              ]}
            />
          </div>
          <Switch label="Include sound" checked={audio} onChange={setAudio} />
          <button class="btn small" onClick={saveFrame}>
            <ImageIcon size={16} /> Save the current moment as a photo
          </button>
          {!canUseWebCodecs() && <p class="faint">This browser will record the video in real time, so it takes as long as the video itself.</p>}
        </div>
      )}
    </Dialog>
  );
}
