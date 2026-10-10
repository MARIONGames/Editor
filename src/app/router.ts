/**
 * Hash routing (#/edit/<id> for photo/video projects, #/3d/<id> for 3D scenes) so
 * refreshing keeps your work open and the phone's back button returns home.
 */
import { effect } from '@preact/signals';
import { closeProject, openProject } from '../state/actions';
import { route, type Route } from '../state/store';

/** The 3D studio (and three.js) load only when a 3D scene is opened. */
const load3d = () => import('../studio3d/state/actions3d');

/** Some embedded/sandboxed contexts refuse history changes; the app works without them. */
function safeHistory(kind: 'push' | 'replace', url: string): void {
  try {
    if (kind === 'push') history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  } catch {
    /* ignore */
  }
}

function parse(hash: string): Route {
  const m = /^#\/edit\/([\w-]+)/.exec(hash);
  if (m) return { name: 'editor', projectId: m[1]! };
  const m3 = /^#\/3d\/([\w-]+)/.exec(hash);
  if (m3) return { name: 'studio3d', sceneId: m3[1]! };
  return { name: 'home' };
}

function hashOf(r: Route): string {
  return r.name === 'editor'
    ? `#/edit/${r.projectId}`
    : r.name === 'studio3d'
      ? `#/3d/${r.sceneId}`
      : '#/';
}

export function initRouter(): void {
  const initial = parse(location.hash);
  if (initial.name === 'editor')
    void openProject(initial.projectId).then((ok) => !ok && safeHistory('replace', '#/'));
  if (initial.name === 'studio3d')
    void load3d().then((m) =>
      m.openScene(initial.sceneId).then((ok) => !ok && safeHistory('replace', '#/')),
    );

  let applying = false;
  effect(() => {
    const r = route.value;
    if (applying) return;
    const target = hashOf(r);
    if (location.hash !== target && !(target === '#/' && location.hash === '')) {
      safeHistory(r.name === 'home' ? 'replace' : 'push', target);
    }
  });

  window.addEventListener('popstate', () => {
    const next = parse(location.hash);
    const cur = route.peek();
    applying = true;
    try {
      void (async () => {
        if (
          cur.name === 'studio3d' &&
          !(next.name === 'studio3d' && next.sceneId === cur.sceneId)
        ) {
          const m = await load3d();
          if (next.name === 'studio3d') {
            await m.openScene(next.sceneId);
            return;
          }
          await m.closeScene();
        }
        if (next.name === 'home' && cur.name === 'editor') void closeProject();
        else if (
          next.name === 'editor' &&
          (cur.name !== 'editor' || cur.projectId !== next.projectId)
        )
          void openProject(next.projectId);
        else if (next.name === 'studio3d' && cur.name !== 'studio3d')
          void (await load3d()).openScene(next.sceneId);
      })();
    } finally {
      applying = false;
    }
  });
}
