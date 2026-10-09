import { useEffect } from 'preact/hooks';
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
    const light = theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    meta?.setAttribute('content', light ? '#f4f4f8' : '#0e0f13');
  }, [theme]);

  return (
    <>
      {route.value.name === 'home' ? <Home /> : <Editor />}
      <DialogHost />
      <CoachLayer />
      <BusyOverlay />
      <Toasts />
    </>
  );
}
