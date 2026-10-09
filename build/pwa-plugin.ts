import type { Plugin } from 'vite';

/**
 * Tiny, dependency-free PWA plugin.
 * At build time it emits `sw.js` with a precache list of every emitted file, so the
 * app shell works offline after the first visit. Cache name changes on every build.
 */
export function pwaPlugin(extraFiles: string[] = []): Plugin {
  return {
    name: 'kinora-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        // Text fonts are cached on first use; only the UI font is precached.
        .filter((f) => !f.endsWith('.woff2') || /Inter-[0-9]+-latin-/.test(f))
        .map((f) => `./${f}`);
      const precache = Array.from(new Set(['./', ...files, ...extraFiles.map((f) => `./${f}`)]));
      const version = Date.now().toString(36);
      const source = SW_TEMPLATE.replace('__VERSION__', version).replace(
        '__PRECACHE__',
        JSON.stringify(precache),
      );
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

const SW_TEMPLATE = `/* Kinora service worker (generated) */
const CACHE = 'kinora-__VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kinora-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first for the page so updates arrive quickly; cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./').then((r) => r || caches.match('./index.html'))),
    );
    return;
  }
  // Hashed assets: cache first.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});
`;
