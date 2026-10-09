import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-preact';
import { moveLayer, removeClips, setTrackProps } from '../../model/ops';
import type { Clip, Project } from '../../model/types';
import { commit, select } from '../../state/actions';
import { project, selectionId } from '../../state/store';
import { thumbUrls } from '../editor/thumbs';

function layerName(p: Project, c: Clip): string {
  if (c.type === 'text') return `“${c.text.split('\n')[0]}”`;
  if (c.type === 'sticker') return `Sticker ${c.emoji}`;
  if (c.type === 'shape') return `Shape (${c.shape})`;
  return p.assets[c.assetId]?.name ?? 'Photo';
}

export function LayersPanel() {
  const p = project.value!;
  const sel = selectionId.value;
  const tracks = p.tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.kind !== 'audio' && t.clips.length);
  if (!tracks.length) return <div class="empty-panel">Nothing here yet. Add a photo, text or sticker.</div>;
  return (
    <div class="panel">
      <p class="faint">Top of the list is in front. Use the arrows to bring things forward or send them back.</p>
      <ul class="layer-list">
        {tracks
          .slice()
          .reverse()
          .map(({ t, i }) => {
            const c = t.clips[0]!;
            const thumb = c.type === 'media' ? thumbUrls(c.assetId)[0] : undefined;
            return (
              <li key={t.id} class={`layer ${c.id === sel ? 'on' : ''} ${t.hidden ? 'hidden' : ''}`}>
                <button class="layer-main" onClick={() => select(c.id)}>
                  <span class="layer-thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
                    {!thumb && (c.type === 'sticker' ? c.emoji : c.type === 'text' ? 'T' : '◆')}
                  </span>
                  <span class="layer-name">{layerName(p, c)}</span>
                </button>
                <button class="icon-btn small" aria-label="Bring forward" disabled={i === p.tracks.length - 1} onClick={() => commit('Bring forward', (q) => moveLayer(q, t.id, i + 1))}>
                  <ArrowUp size={16} />
                </button>
                <button class="icon-btn small" aria-label="Send backward" disabled={i === 0} onClick={() => commit('Send backward', (q) => moveLayer(q, t.id, i - 1))}>
                  <ArrowDown size={16} />
                </button>
                <button class="icon-btn small" aria-label={t.hidden ? 'Show' : 'Hide'} onClick={() => commit(t.hidden ? 'Show layer' : 'Hide layer', (q) => setTrackProps(q, t.id, { hidden: !t.hidden }))}>
                  {t.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button class="icon-btn small" aria-label={t.locked ? 'Unlock' : 'Lock'} onClick={() => commit(t.locked ? 'Unlock layer' : 'Lock layer', (q) => setTrackProps(q, t.id, { locked: !t.locked }))}>
                  {t.locked ? <Lock size={16} /> : <LockOpen size={16} />}
                </button>
                <button class="icon-btn small" aria-label="Delete" onClick={() => commit('Delete layer', (q) => removeClips(q, t.clips.map((x) => x.id)))}>
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
