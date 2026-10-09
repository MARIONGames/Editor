/**
 * `vite build --mode artifact` packages Kinora as a demo page for a sandboxed host
 * (a claude.ai artifact). The host serves page content only, runs scripts from a few CDNs
 * and takes stylesheets from Google Fonts, so this build:
 *  - leaves out the bundled font files: the page links the same families from Google Fonts;
 *  - loads mediabunny from jsDelivr, at the installed version, instead of bundling it;
 *  - emits `page.html`, the page content that boots the app (template: artifact-page.html).
 */
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { FONTS } from '../src/model/fonts.ts';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

/** One Google Fonts request for every family and weight Kinora offers. */
export function googleFontsUrl(): string {
  const families = FONTS.map((f) => {
    const name = f.family.replace(/ /g, '+');
    const weights = [...f.weights].sort((a, b) => a - b);
    return f.italic
      ? `family=${name}:ital,wght@${[...weights.map((w) => `0,${w}`), ...weights.map((w) => `1,${w}`)].join(';')}`
      : `family=${name}:wght@${weights.join(';')}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

export function artifactPlugins(): Plugin[] {
  const { version } = JSON.parse(read('node_modules/mediabunny/package.json')) as { version: string };
  const mediabunny = `https://cdn.jsdelivr.net/npm/mediabunny@${version}/dist/bundles/mediabunny.min.mjs`;
  return [
    {
      name: 'kinora:artifact-sources',
      enforce: 'pre',
      resolveId(id) {
        return id === 'mediabunny' ? { id: mediabunny, external: true } : null;
      },
      load(id) {
        return id.split('?')[0]!.endsWith('/src/styles/fonts.css') ? '/* fonts load from Google Fonts */' : null;
      },
    },
    {
      name: 'kinora:artifact-page',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const files = Object.values(bundle);
        const entry = files.find((f) => f.type === 'chunk' && f.isEntry);
        if (!entry) return this.error('artifact build: no entry chunk');
        const css = files.filter((f) => f.type === 'asset' && f.fileName.endsWith('.css'));
        const page = read('build/artifact-page.html')
          .replace('%GOOGLE_FONTS%', googleFontsUrl().replace(/&/g, '&amp;'))
          .replace('%STYLESHEETS%', css.map((f) => `<link rel="stylesheet" href="${f.fileName}" />`).join('\n'))
          .replace('%ENTRY%', entry.fileName);
        this.emitFile({ type: 'asset', fileName: 'page.html', source: page });
      },
    },
  ];
}
