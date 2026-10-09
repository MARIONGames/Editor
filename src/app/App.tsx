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
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
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
