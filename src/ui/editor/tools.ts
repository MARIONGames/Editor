/** Which tools are offered, depending on the project and what is selected. */
import {
  ArrowLeftRight,
  Copy,
  Crop,
  Gauge,
  Image as ImageIcon,
  Layers,
  Move,
  Music,
  Pencil,
  PictureInPicture2,
  Plus,
  Ratio,
  Replace,
  Scissors,
  Shapes,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Trash2,
  Type,
  Volume2,
  Wand2,
  Zap,
  Palette,
  Pipette,
} from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { findClip } from '../../model/ops';
import type { Clip, Project } from '../../model/types';
import { TOOL_TEXT, type ToolText } from '../../i18n/tools';
import {
  deleteSelected,
  duplicateSelected,
  openPanel,
  replaceMedia,
  select,
  splitAtPlayhead,
} from '../../state/actions';
import { editingTextId, panel, project, selectionId, type PanelId } from '../../state/store';
import { addMediaFlow, addMusicFlow } from '../home/flows';
import { ACCEPT_AUDIO, ACCEPT_IMAGE, ACCEPT_VISUAL, pickFiles } from '../components/filePicker';

export interface ToolDef {
  id: string;
  text: ToolText;
  icon: LucideIcon;
  run: () => void;
  active?: boolean;
  danger?: boolean;
  magic?: boolean;
  coach?: string;
}

const panelTool = (id: PanelId, text: ToolText, icon: ToolDef['icon'], coach?: string): ToolDef => ({
  id,
  text,
  icon,
  run: () => openPanel(id),
  active: panel.value === id,
  coach,
});

/** Photo projects: tools that edit "the photo" select the base layer first. */
function basePhotoTool(id: PanelId, text: ToolText, icon: ToolDef['icon'], coach?: string): ToolDef {
  return {
    id,
    text,
    icon,
    coach,
    active: panel.value === id,
    run: () => {
      const p = project.peek();
      const sel = p ? findClip(p, selectionId.peek())?.clip : null;
      // "Edit the photo" tools work on the photo unless another photo is selected.
      if (p && sel?.type !== 'media') {
        const base = p.tracks.find((t) => t.clips[0]?.type === 'media')?.clips[0];
        if (base) select(base.id);
      }
      openPanel(id);
    },
  };
}

export function rootTools(p: Project): ToolDef[] {
  if (p.kind === 'photo') {
    return [
      basePhotoTool('adjust', TOOL_TEXT.adjust, SlidersHorizontal, 'tool-adjust'),
      basePhotoTool('filters', TOOL_TEXT.filters, Palette, 'tool-filters'),
      basePhotoTool('crop', TOOL_TEXT.crop, Crop),
      panelTool('text', TOOL_TEXT.text, Type, 'tool-text'),
      panelTool('stickers', TOOL_TEXT.stickers, Smile),
      { id: 'add', text: { label: 'Add photo', hint: 'Put another photo on top (collage, logo, picture-in-picture)' }, icon: ImageIcon, run: () => void addMediaFlow() },
      panelTool('magic', TOOL_TEXT.magic, Sparkles, 'tool-magic'),
      panelTool('canvas', TOOL_TEXT.canvas, Ratio),
      panelTool('layers', TOOL_TEXT.layers, Layers),
    ].map((t) => (t.id === 'magic' ? { ...t, magic: true } : t));
  }
  return [
    { id: 'add', text: TOOL_TEXT.add, icon: Plus, run: () => void addMediaFlow(), coach: 'tool-add' },
    panelTool('text', TOOL_TEXT.text, Type, 'tool-text'),
    { id: 'music', text: TOOL_TEXT.music, icon: Music, run: () => void addMusicFlow(), coach: 'tool-music' },
    panelTool('stickers', TOOL_TEXT.stickers, Smile),
    { ...panelTool('magic', TOOL_TEXT.magic, Sparkles, 'tool-magic'), magic: true },
    panelTool('canvas', TOOL_TEXT.canvas, Ratio),
    {
      id: 'overlay',
      text: TOOL_TEXT.overlay,
      icon: PictureInPicture2,
      run: () => void addMediaFlow('overlay'),
    },
  ];
}

export function clipTools(p: Project, clip: Clip): ToolDef[] {
  const loc = findClip(p, clip.id);
  const isVideoProject = p.kind === 'video';
  const onMain = loc?.track.kind === 'main';
  const tools: ToolDef[] = [];
  const split: ToolDef = { id: 'split', text: TOOL_TEXT.split, icon: Scissors, run: splitAtPlayhead, coach: 'tool-split' };
  const copy: ToolDef = { id: 'copy', text: TOOL_TEXT.duplicate, icon: Copy, run: duplicateSelected };
  const del: ToolDef = { id: 'delete', text: TOOL_TEXT.delete, icon: Trash2, run: deleteSelected, danger: true, coach: 'tool-delete' };
  const position = panelTool('transform', TOOL_TEXT.transform, Move);
  const motion = panelTool('animation', TOOL_TEXT.animation, Zap);

  if (clip.type === 'media') {
    const asset = p.assets[clip.assetId];
    const isAudio = asset?.kind === 'audio';
    const isVideo = asset?.kind === 'video';
    if (isVideoProject) tools.push(split);
    if (!isAudio) {
      tools.push(panelTool('adjust', TOOL_TEXT.adjust, SlidersHorizontal, 'tool-adjust'));
      tools.push(panelTool('filters', TOOL_TEXT.filters, Palette, 'tool-filters'));
    }
    if (isVideo || isAudio) tools.push(panelTool('speed', TOOL_TEXT.speed, Gauge));
    if (isAudio || (isVideo && asset?.hasAudio)) tools.push(panelTool('volume', TOOL_TEXT.volume, Volume2));
    if (!isAudio) tools.push(panelTool('crop', TOOL_TEXT.crop, Crop));
    if (!isAudio && isVideoProject) tools.push(motion);
    if (onMain && loc && loc.clipIndex > 0) tools.push(panelTool('transition', TOOL_TEXT.transition, ArrowLeftRight));
    if (!isAudio) tools.push(position);
    // Green screen only makes sense for something on top of something else.
    if (!isAudio && !onMain && !(p.kind === 'photo' && loc?.trackIndex === 0)) {
      tools.push(panelTool('greenscreen', TOOL_TEXT.greenscreen, Pipette));
    }
    tools.push({
      id: 'replace',
      text: TOOL_TEXT.replace,
      icon: Replace,
      run: async () => {
        const files = await pickFiles({ accept: isAudio ? ACCEPT_AUDIO : p.kind === 'photo' ? ACCEPT_IMAGE : ACCEPT_VISUAL });
        if (files[0]) void replaceMedia(clip.id, files[0]);
      },
    });
    tools.push(copy, del);
    return tools;
  }
  if (clip.type === 'text') {
    tools.push({
      id: 'edit',
      text: { label: 'Edit text', hint: 'Change the words, font and colors' },
      icon: Pencil,
      active: panel.value === 'text',
      run: () => {
        editingTextId.value = clip.id;
        openPanel('text');
      },
      coach: 'tool-edit-text',
    });
  } else if (clip.type === 'sticker') {
    tools.push({ ...panelTool('stickers', { label: 'Change', hint: 'Pick a different sticker' }, Smile) });
  } else if (clip.type === 'shape') {
    tools.push(panelTool('shape', TOOL_TEXT.shape, Shapes));
  }
  if (isVideoProject) tools.push(motion);
  tools.push(position);
  if (isVideoProject) tools.push(split);
  tools.push(copy, del);
  return tools;
}

export const MagicIcon = Wand2;
