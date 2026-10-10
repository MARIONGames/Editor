import { useEffect, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact';
import { route, settings } from '../state/store';
import { Home } from '../ui/home/Home';
import { Editor } from '../ui/editor/Editor';
import { Toasts, BusyOverlay } from '../ui/components/Toasts';
import { DialogHost } from '../ui/dialogs/DialogHost';
import { CoachLayer } from '../coach/CoachLayer';

export function App() {
  const theme = settings.value.theme;
  useEffect(() => {
    const el = document.documentElement;
    // Only clear a theme we set ourselves: a host page may set its own.
    if (theme === 'system') {
      if (el.dataset.kinoraTheme) {
        el.removeAttribute('data-theme');
        delete el.dataset.kinoraTheme;
      }
    } else {
      el.setAttribute('data-theme', theme);
      el.dataset.kinoraTheme = '1';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    const light =
      theme === 'light' ||
      (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    meta?.setAttribute('content', light ? '#f4f4f8' : '#0e0f13');
  }, [theme]);

  return (
    <>
      {route.value.name === 'home' ? (
        <Home />
      ) : route.value.name === 'studio3d' ? (
        <LazyStudio3D />
      ) : (
        <Editor />
      )}
      <DialogHost />
      <CoachLayer />
      <BusyOverlay />
      <Toasts />
    </>
  );
}

/** The 3D studio (with three.js) is downloaded only when someone opens a 3D scene. */
let studioModule: Promise<FunctionComponent> | null = null;
function loadStudio(): Promise<FunctionComponent> {
  studioModule ??= import('../studio3d/ui/Studio3D').then((m) => m.Studio3D);
  return studioModule;
}

function LazyStudio3D() {
  const [Comp, setComp] = useState<FunctionComponent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadStudio()
      .then((c) => alive && setComp(() => c))
      .catch(() => {
        studioModule = null;
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (failed)
    return (
      <div class="editor-loading">
        Couldn’t load the 3D studio. Check your connection and reload.
      </div>
    );
  return Comp ? <Comp /> : <div class="editor-loading">Opening the 3D studio…</div>;
}
