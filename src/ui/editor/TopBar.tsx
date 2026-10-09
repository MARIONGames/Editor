import { useState } from 'preact/hooks';
import { ChevronLeft, CircleHelp, Download, Keyboard, BookOpen, Redo2, Undo2, Compass } from 'lucide-preact';
import { closeProject, redo, renameCurrent, undo } from '../../state/actions';
import { canRedo, canUndo, history, historyVersion, isCompact, project, updateSettings } from '../../state/store';
import { openDialog } from '../dialogs/dialogState';
import { startTour } from '../../coach/tour';

export function TopBar() {
  const p = project.value!;
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  void historyVersion.value;
  const compact = isCompact.value;
  return (
    <header class="topbar">
      <button class="icon-btn" aria-label="Back to home" title="Home (your work is saved)" onClick={() => void closeProject()}>
        <ChevronLeft size={24} />
      </button>
      <div class="project-name">
        {editing ? (
          <input
            class="input name-input"
            autoFocus
            value={p.name}
            maxLength={80}
            onBlur={(e) => {
              renameCurrent((e.target as HTMLInputElement).value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button class="name-btn" title="Rename" onClick={() => setEditing(true)}>
            {p.name}
          </button>
        )}
        {!compact && <span class="saved-pill">Saved on this device</span>}
      </div>
      <div class="topbar-actions">
        <button
          class="icon-btn"
          onClick={undo}
          disabled={!canUndo.value}
          aria-label={history.undoLabel ? `Undo ${history.undoLabel}` : 'Undo'}
          title={history.undoLabel ? `Undo: ${history.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
          data-coach="undo"
        >
          <Undo2 size={21} />
        </button>
        <button
          class="icon-btn"
          onClick={redo}
          disabled={!canRedo.value}
          aria-label={history.redoLabel ? `Redo ${history.redoLabel}` : 'Redo'}
          title={history.redoLabel ? `Redo: ${history.redoLabel} (Ctrl+Shift+Z)` : 'Redo'}
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
                  updateSettings({ tourDone: false });
                  startTour(p.kind);
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
                <BookOpen size={16} /> Editing words explained
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  openDialog({ type: 'shortcuts' });
                }}
              >
                <Keyboard size={16} /> Keyboard shortcuts
              </button>
            </div>
          )}
        </div>
        <button class="btn primary export-btn" onClick={() => openDialog({ type: 'export' })} data-coach="export">
          <Download size={18} /> {compact ? 'Export' : p.kind === 'photo' ? 'Export photo' : 'Export video'}
        </button>
      </div>
    </header>
  );
}
