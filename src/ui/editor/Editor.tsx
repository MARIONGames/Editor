import { useEffect } from 'preact/hooks';
import { isCompact, panel, project } from '../../state/store';
import { PanelHost } from '../panels/PanelHost';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { ToolDock } from './ToolDock';
import { TopBar } from './TopBar';
import { Transport } from './Transport';
import { useEditorShortcuts } from './shortcuts';
import { useDropImport } from './dropImport';

export function Editor() {
  const p = project.value;
  const compact = isCompact.value;
  const open = panel.value !== null;
  useEditorShortcuts();
  const dropping = useDropImport();
  useEffect(() => {
    document.body.classList.add('in-editor');
    return () => document.body.classList.remove('in-editor');
  }, []);
  if (!p) return <div class="editor-loading">Opening your project…</div>;
  const isVideo = p.kind === 'video';
  return (
    <div class={`editor ${compact ? 'compact' : 'wide'} ${isVideo ? 'is-video' : 'is-photo'} ${open ? 'panel-open' : ''}`}>
      <TopBar />
      <div class="editor-body">
        {!compact && <ToolDock vertical />}
        <div class="editor-center">
          <Stage />
          {isVideo && <Transport />}
          {isVideo && <Timeline />}
          {compact && <ToolDock />}
        </div>
        {!compact && <PanelHost />}
      </div>
      {compact && <PanelHost />}
      {dropping && (
        <div class="drop-overlay">
          <div>Drop photos, videos or music to add them</div>
        </div>
      )}
    </div>
  );
}
