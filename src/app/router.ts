/**
 * Hash routing (#/edit/<id>) so refreshing keeps your project open and the phone's
 * back button returns to the home screen.
 */
import { effect } from '@preact/signals';
import { closeProject, openProject } from '../state/actions';
import { route } from '../state/store';

function parse(hash: string): { name: 'home' } | { name: 'editor'; projectId: string } {
  const m = /^#\/edit\/([\w-]+)/.exec(hash);
  return m ? { name: 'editor', projectId: m[1]! } : { name: 'home' };
}

export function initRouter(): void {
  const initial = parse(location.hash);
  if (initial.name === 'editor') void openProject(initial.projectId).then((ok) => !ok && history.replaceState(null, '', '#/'));

  let applying = false;
  effect(() => {
    const r = route.value;
    if (applying) return;
    const target = r.name === 'editor' ? `#/edit/${r.projectId}` : '#/';
    if (location.hash !== target && !(target === '#/' && location.hash === '')) {
      if (r.name === 'editor') history.pushState(null, '', target);
      else history.replaceState(null, '', target);
    }
  });

  window.addEventListener('popstate', () => {
    const next = parse(location.hash);
    const cur = route.peek();
    applying = true;
    try {
      if (next.name === 'home' && cur.name === 'editor') void closeProject();
      else if (next.name === 'editor' && (cur.name !== 'editor' || cur.projectId !== next.projectId)) {
        void openProject(next.projectId);
      }
    } finally {
      applying = false;
    }
  });
}
