import { useEffect } from 'preact/hooks';
import { preview } from '../../engine/preview';
import {
  addText,
  deleteSelected,
  duplicateSelected,
  redo,
  select,
  splitAtPlayhead,
  undo,
} from '../../state/actions';
import { emit } from '../../state/events';
import { duration, panel, playhead, project, selectionId, zoom } from '../../state/store';
import { dialog, openDialog } from '../dialogs/dialogState';
import { clampZoom } from './Transport';

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useEditorShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog.peek()) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      if (mod && key.toLowerCase() === 'z') {
        if (typing(e)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key.toLowerCase() === 'y') {
        if (typing(e)) return;
        e.preventDefault();
        redo();
        return;
      }
      if (typing(e)) return;
      const p = project.peek();
      if (!p) return;
      const isVideo = p.kind === 'video';
      if (mod && key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && key.toLowerCase() === 'e') {
        e.preventDefault();
        openDialog({ type: 'export' });
        return;
      }
      if (mod && key.toLowerCase() === 'b' && isVideo) {
        e.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (mod || e.altKey) return;
      switch (key) {
        case ' ':
          if (!isVideo) return;
          e.preventDefault();
          preview.toggle();
          emit('playback:played', {});
          return;
        case 's':
        case 'S':
          if (!isVideo) return;
          e.preventDefault();
          splitAtPlayhead();
          return;
        case 'Delete':
        case 'Backspace':
          if (selectionId.peek()) {
            e.preventDefault();
            deleteSelected();
          }
          return;
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!isVideo) return;
          e.preventDefault();
          const step = e.shiftKey ? 1 : 1 / (p.fps || 30);
          preview.pause();
          preview.seek(playhead.peek() + (key === 'ArrowLeft' ? -step : step));
          return;
        }
        case 'Home':
          preview.seek(0);
          return;
        case 'End':
          preview.seek(duration.peek());
          return;
        case '+':
        case '=':
          zoom.value = clampZoom(zoom.peek() * 1.4);
          return;
        case '-':
        case '_':
          zoom.value = clampZoom(zoom.peek() / 1.4);
          return;
        case 't':
        case 'T':
          e.preventDefault();
          addText('title');
          panel.value = 'text';
          return;
        case 'Escape':
          if (panel.peek()) panel.value = null;
          else select(null);
          return;
        case '?':
          openDialog({ type: 'shortcuts' });
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['Space'], what: 'Play / pause' },
  { keys: ['S'], what: 'Split the clip at the white line' },
  { keys: ['Delete'], what: 'Delete the selected item' },
  { keys: ['Ctrl/⌘', 'Z'], what: 'Undo' },
  { keys: ['Ctrl/⌘', 'Shift', 'Z'], what: 'Redo' },
  { keys: ['Ctrl/⌘', 'D'], what: 'Copy (duplicate) the selected item' },
  { keys: ['←', '→'], what: 'Move one frame (hold Shift: one second)' },
  { keys: ['Home', 'End'], what: 'Jump to the start / end' },
  { keys: ['+', '−'], what: 'Zoom the timeline in / out' },
  { keys: ['Ctrl/⌘', 'Scroll'], what: 'Zoom the timeline, or resize the selected item on the picture' },
  { keys: ['T'], what: 'Add text' },
  { keys: ['Esc'], what: 'Close the panel / deselect' },
  { keys: ['Ctrl/⌘', 'E'], what: 'Export' },
  { keys: ['?'], what: 'Show these shortcuts' },
];
