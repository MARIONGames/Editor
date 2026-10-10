import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Box, Download, Film, Image as ImageIcon } from 'lucide-preact';
import { Dialog } from '../../ui/components/Dialog';
import { Segmented, Switch } from '../../ui/components/Controls';
import { saveFile, type SaveOutcome } from '../../platform/host';
import { toast } from '../../state/store';
import { emit } from '../../state/events';
import { ExportCancelled, type ExportResult } from '../../engine/export/videoExport';
import { exportModel, renderPicture, renderVideo, type ModelFormat } from '../io/export3d';
import { gameReadyReport } from '../magic3d';
import { dialog3d, scene3d, selection3d, time3d } from '../state/store3d';
import { KEYMAP3D } from './shortcuts3d';
import { viewportRef } from './viewportRef';

export function Dialogs3D() {
  const d = dialog3d.value;
  if (!d) return null;
  const close = () => (dialog3d.value = null);
  if (d.type === 'keymap') return <KeymapDialog onClose={close} />;
  if (d.type === 'game-check') return <GameCheckDialog onClose={close} />;
  return <ExportDialog3D onClose={close} />;
}

function KeymapDialog(props: { onClose: () => void }) {
  const groups = [...new Set(KEYMAP3D.map((k) => k.group))];
  return (
    <Dialog
      title="3D keyboard shortcuts"
      subtitle="Blender users: most keys work the way you expect."
      onClose={props.onClose}
      wide
    >
      <div class="keymap-cols">
        {groups.map((g) => (
          <div key={g}>
            <h4 class="keymap-group">{g}</h4>
            <table class="shortcuts">
              <tbody>
                {KEYMAP3D.filter((k) => k.group === g).map((k) => (
                  <tr key={k.what}>
                    <td>
                      {k.keys.map((key, i) => (
                        <span key={key}>
                          {i > 0 && ' + '}
                          <kbd class="kbd">{key}</kbd>
                        </span>
                      ))}
                    </td>
                    <td>{k.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function GameCheckDialog(props: { onClose: () => void }) {
  const s = scene3d.value!;
  const r = useMemo(() => gameReadyReport(s), [s]);
  const issues = r.rows.reduce((n, row) => n + row.issues.length, 0);
  return (
    <Dialog
      title="Game-ready check"
      subtitle="What Unity, Unreal or Godot would think of your models."
      onClose={props.onClose}
      wide
    >
      <div class="gc-summary">
        <div>
          <strong>{r.totalTris.toLocaleString()}</strong>
          <span>triangles</span>
        </div>
        <div>
          <strong>{r.materials}</strong>
          <span>materials</span>
        </div>
        <div>
          <strong>{r.textures}</strong>
          <span>textures</span>
        </div>
        <div class={issues ? 'warn' : 'ok'}>
          <strong>{issues}</strong>
          <span>{issues === 1 ? 'thing to look at' : 'things to look at'}</span>
        </div>
      </div>
      <p class="faint">
        Rough budgets: mobile props under 5k triangles, PC/console heroes 30–100k, whole mobile
        scenes under 300k.
      </p>
      {r.rows.map((row) => (
        <div key={row.name} class="gc-row">
          <div class="row">
            <strong class="grow">{row.name}</strong>
            <span class="faint">
              {row.tris.toLocaleString()} tris · {row.verts.toLocaleString()} verts
            </span>
          </div>
          {row.issues.length ? (
            <ul class="gc-issues">
              {row.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : (
            <p class="gc-ok">Looks good ✓</p>
          )}
        </div>
      ))}
      {!r.rows.length && (
        <p class="muted">
          No editable shapes in this scene. Imported models are exported exactly as they came in.
        </p>
      )}
    </Dialog>
  );
}

type Kind = 'picture' | 'video' | 'model';

async function save(blob: Blob, name: string): Promise<void> {
  const r: SaveOutcome = await saveFile(blob, name);
  if (r === 'saved') toast(`Saved ${name}`, 'success');
  else if (r === 'declined') toast('Not saved.', 'info');
  else if (r === 'too-large') toast('That file is too large to save from here.', 'error');
  else if (r === 'busy') toast('Too many saves at once — try again in a moment.', 'error');
  else toast('Saving isn’t available here. Open Kinora in its own tab to download.', 'error');
}

function fileBase(name: string): string {
  return (
    name
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'kinora-3d'
  );
}

function ExportDialog3D(props: { onClose: () => void }) {
  const s = scene3d.value!;
  const hasAnim = s.order.some((id) => s.objects[id]!.anim || s.objects[id]!.kind === 'model');
  const [kind, setKind] = useState<Kind>('picture');
  const [scale, setScale] = useState(1);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [vformat, setVformat] = useState<'mp4' | 'webm'>('mp4');
  const [vquality, setVquality] = useState<'standard' | 'high' | 'max'>('high');
  const [mformat, setMformat] = useState<ModelFormat>('glb');
  const [onlySel, setOnlySel] = useState(false);
  const [anims, setAnims] = useState(true);
  const [printing, setPrinting] = useState(true);
  const [busy, setBusy] = useState<{ progress: number; message: string } | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    blob: Blob;
    name: string;
    details?: string;
  } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => preview && URL.revokeObjectURL(preview.url), [preview]);
  const base = fileBase(s.name);
  const vp = viewportRef.current;

  const run = async () => {
    if (!vp) return;
    setPreview(null);
    try {
      if (kind === 'picture') {
        setBusy({ progress: 0.5, message: 'Rendering your picture…' });
        await new Promise((r) => setTimeout(r, 30));
        const blob = await renderPicture(vp, s, { scale, format, time: time3d.peek() });
        setPreview({
          url: URL.createObjectURL(blob),
          blob,
          name: `${base}.${format === 'png' ? 'png' : 'jpg'}`,
        });
        emit('3d:rendered', { kind: 'image' });
      } else if (kind === 'video') {
        abort.current = new AbortController();
        const bitrate = { standard: 6e6, high: 14e6, max: 30e6 }[vquality] * scale * scale;
        const r: ExportResult = await renderVideo(
          vp,
          s,
          { format: vformat, bitrate, scale },
          (p, m) => setBusy({ progress: p, message: m }),
          abort.current.signal,
        );
        setPreview({
          url: URL.createObjectURL(r.blob),
          blob: r.blob,
          name: `${base}.${r.ext}`,
          details: r.details,
        });
        emit('3d:rendered', { kind: 'video' });
      } else {
        setBusy({ progress: 0.5, message: 'Packing your model…' });
        const r = await exportModel(s, {
          format: mformat,
          only: onlySel ? selection3d.peek().ids : undefined,
          animations: anims,
          forPrinting: printing,
        });
        if (r.skipped.length) toast(`Left out: ${r.skipped.join(', ')}`, 'info', undefined, 6000);
        setBusy(null);
        emit('3d:rendered', { kind: 'model' });
        await save(r.blob, `${base}.${r.ext}`);
      }
    } catch (err) {
      if (!(err instanceof ExportCancelled))
        toast(err instanceof Error ? err.message : 'Export failed.', 'error', undefined, 6000);
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const W = Math.round(s.render.width * scale);
  const H = Math.round(s.render.height * scale);
  const frames = Math.round((s.anim.end - s.anim.start) * s.render.fps);

  return (
    <Dialog
      title="Export"
      subtitle={
        kind === 'model'
          ? 'A file other apps and game engines can open.'
          : s.render.camera
            ? 'Rendered through your camera.'
            : 'Rendered from your current view (add a camera to frame a shot).'
      }
      onClose={() => {
        abort.current?.abort();
        props.onClose();
      }}
      footer={
        busy ? (
          <div class="export-progress">
            <div class="bar">
              <span style={{ width: `${Math.round(busy.progress * 100)}%` }} />
            </div>
            <span class="faint">{busy.message}</span>
            {kind === 'video' && (
              <button class="btn small" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
        ) : preview ? (
          <div class="row">
            <button class="btn" onClick={() => setPreview(null)}>
              Back
            </button>
            <span class="grow" />
            <button class="btn primary" onClick={() => void save(preview.blob, preview.name)}>
              <Download size={18} /> Save
            </button>
          </div>
        ) : (
          <button class="btn primary block" onClick={() => void run()} data-coach="export3d-go">
            {kind === 'picture'
              ? 'Render picture'
              : kind === 'video'
                ? `Render video (${frames} frames)`
                : `Export ${mformat.toUpperCase()}`}
          </button>
        )
      }
    >
      {preview ? (
        <div class="export3d-preview">
          {preview.blob.type.startsWith('video') ? (
            <video src={preview.url} controls autoPlay loop muted playsInline />
          ) : (
            <img src={preview.url} alt="Your render" />
          )}
          <p class="faint">
            {preview.name}
            {preview.details ? ` · ${preview.details}` : ''} ·{' '}
            {(preview.blob.size / 1e6).toFixed(1)} MB
          </p>
        </div>
      ) : (
        <>
          <div class="export-kinds">
            <button
              class={`export-kind ${kind === 'picture' ? 'on' : ''}`}
              onClick={() => setKind('picture')}
            >
              <ImageIcon size={22} />
              <strong>Picture</strong>
              <span>PNG or JPEG</span>
            </button>
            <button
              class={`export-kind ${kind === 'video' ? 'on' : ''}`}
              onClick={() => setKind('video')}
              disabled={!hasAnim}
              title={hasAnim ? '' : 'Animate something first (Animate tab)'}
            >
              <Film size={22} />
              <strong>Video</strong>
              <span>{hasAnim ? 'MP4 or WebM' : 'Nothing moves yet'}</span>
            </button>
            <button
              class={`export-kind ${kind === 'model' ? 'on' : ''}`}
              onClick={() => setKind('model')}
            >
              <Box size={22} />
              <strong>3D model</strong>
              <span>GLB, OBJ, STL, USDZ</span>
            </button>
          </div>
          {kind !== 'model' && (
            <div class="field">
              <div class="field-label">
                Size: {W} × {H}
              </div>
              <Segmented
                value={scale}
                ariaLabel="Size"
                options={[
                  { value: 0.5, label: 'Half' },
                  { value: 1, label: 'Full' },
                  { value: 2, label: 'Double' },
                ]}
                onChange={setScale}
              />
            </div>
          )}
          {kind === 'picture' && (
            <div class="field">
              <Segmented
                value={format}
                ariaLabel="Format"
                options={[
                  { value: 'png', label: 'PNG (best)' },
                  { value: 'jpeg', label: 'JPEG (smaller)' },
                ]}
                onChange={setFormat}
              />
              {s.render.transparent && format === 'png' && (
                <p class="faint">Transparent background is on (Render tab).</p>
              )}
            </div>
          )}
          {kind === 'video' && (
            <>
              <div class="field">
                <Segmented
                  value={vquality}
                  ariaLabel="Quality"
                  options={[
                    { value: 'standard', label: 'Standard' },
                    { value: 'high', label: 'High' },
                    { value: 'max', label: 'Maximum' },
                  ]}
                  onChange={setVquality}
                />
              </div>
              <div class="field">
                <Segmented
                  value={vformat}
                  ariaLabel="Format"
                  options={[
                    { value: 'mp4', label: 'MP4 (plays everywhere)' },
                    { value: 'webm', label: 'WebM' },
                  ]}
                  onChange={setVformat}
                />
              </div>
              <p class="faint">
                {(s.anim.end - s.anim.start).toFixed(1)} s at {s.render.fps} fps. Change the length
                in the Animate tab.
              </p>
            </>
          )}
          {kind === 'model' && (
            <>
              <div class="model-formats">
                {(
                  [
                    [
                      'glb',
                      'GLB',
                      'Best for games (Unity, Unreal, Godot), the web and Blender. Materials, textures and animation included.',
                    ],
                    ['gltf', 'glTF', 'Same as GLB, as readable text.'],
                    ['obj', 'OBJ', 'The classic: shapes only, opens anywhere.'],
                    ['stl', 'STL', 'For 3D printing.'],
                    ['usdz', 'USDZ', 'Augmented reality on iPhone and iPad.'],
                  ] as [ModelFormat, string, string][]
                ).map(([f, name, hint]) => (
                  <button
                    key={f}
                    class={`model-format ${mformat === f ? 'on' : ''}`}
                    onClick={() => setMformat(f)}
                  >
                    <strong>{name}</strong>
                    <span>{hint}</span>
                  </button>
                ))}
              </div>
              <Switch label="Only what is selected" checked={onlySel} onChange={setOnlySel} />
              {(mformat === 'glb' || mformat === 'gltf') && (
                <Switch label="Include animation" checked={anims} onChange={setAnims} />
              )}
              {mformat === 'stl' && (
                <Switch
                  label="Ready for 3D printing"
                  hint="Millimeters, Z pointing up — what slicers expect"
                  checked={printing}
                  onChange={setPrinting}
                />
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
