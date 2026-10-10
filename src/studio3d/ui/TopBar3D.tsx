import { useState } from 'preact/hooks';
import {
  BookOpen,
  ChevronLeft,
  CircleHelp,
  Compass,
  Download,
  Keyboard,
  Redo2,
  Undo2,
} from 'lucide-preact';
import { isCompact, updateSettings } from '../../state/store';
import { openDialog } from '../../ui/dialogs/dialogState';
import {
  closeScene,
  enterEditMode,
  exitEditMode,
  redo3d,
  renameScene,
  undo3d,
} from '../state/actions3d';
import {
  canRedo3d,
  canUndo3d,
  dialog3d,
  history3d,
  historyVersion3d,
  mode3d,
  scene3d,
} from '../state/store3d';
import { startTour3d } from './Coach3D';

export function TopBar3D() {
  const s = scene3d.value!;
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  void historyVersion3d.value;
  const compact = isCompact.value;
  const mode = mode3d.value;
  return (
    <header class="topbar">
      <button
        class="icon-btn"
        aria-label="Back to home"
        title="Home (your work is saved)"
        onClick={() => void closeScene()}
      >
        <ChevronLeft size={24} />
      </button>
      <div class="project-name">
        {editing ? (
          <input
            class="input name-input"
            autoFocus
            value={s.name}
            maxLength={80}
            onBlur={(e) => {
              renameScene((e.target as HTMLInputElement).value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button class="name-btn" title="Rename" onClick={() => setEditing(true)}>
            {s.name}
          </button>
        )}
        {!compact && <span class="saved-pill">3D · saved on this device</span>}
      </div>
      {!compact && (
        <div class="segmented mode-switch" role="radiogroup" aria-label="Mode" data-coach="mode3d">
          <button
            role="radio"
            aria-checked={mode === 'object'}
            class={mode === 'object' ? 'on' : ''}
            title="Arrange whole objects (Tab)"
            onClick={() => exitEditMode()}
          >
            Objects
          </button>
          <button
            role="radio"
            aria-checked={mode === 'edit'}
            class={mode === 'edit' ? 'on' : ''}
            title="Edit the shape: points, edges, faces (Tab)"
            onClick={() => enterEditMode()}
          >
            Edit shape
          </button>
        </div>
      )}
      <div class="topbar-actions">
        <button
          class="icon-btn"
          onClick={undo3d}
          disabled={!canUndo3d.value}
          aria-label={history3d.undoLabel ? `Undo ${history3d.undoLabel}` : 'Undo'}
          title={history3d.undoLabel ? `Undo: ${history3d.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
        >
          <Undo2 size={21} />
        </button>
        <button
          class="icon-btn"
          onClick={redo3d}
          disabled={!canRedo3d.value}
          aria-label={history3d.redoLabel ? `Redo ${history3d.redoLabel}` : 'Redo'}
          title={history3d.redoLabel ? `Redo: ${history3d.redoLabel} (Ctrl+Shift+Z)` : 'Redo'}
        >
          <Redo2 size={21} />
        </button>
        <div class="help-wrap">
          <button class="icon-btn" aria-label="Help" title="Help" onClick={() => setMenu(!menu)}>
            <CircleHelp size={21} />
          </button>
          {menu && (
            <div class="menu help-menu" onPointerLeave={() => setMenu(false)}>
              <button
                onClick={() => {
                  setMenu(false);
                  updateSettings({ tour3dDone: false });
                  startTour3d();
                }}
              >
                <Compass size={16} /> Show me around
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  openDialog({ type: 'glossary' });
                }}
              >
                <BookOpen size={16} /> What does this word mean?
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  dialog3d.value = { type: 'keymap' };
                }}
              >
                <Keyboard size={16} /> Keyboard shortcuts
              </button>
            </div>
          )}
        </div>
        <button
          class="btn primary export-btn"
          data-coach="export3d"
          onClick={() => (dialog3d.value = { type: 'export' })}
        >
          <Download size={18} /> {compact ? '' : 'Export'}
        </button>
      </div>
    </header>
  );
}
