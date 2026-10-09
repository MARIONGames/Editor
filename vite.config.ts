import { defineConfig, type Plugin } from 'vite';
import { pwaPlugin } from './build/pwa-plugin.ts';

/** The artifact page links the same families from Google Fonts, so the bundled faces are left out. */
function noBundledFonts(): Plugin {
  return {
    name: 'kinora:no-bundled-fonts',
    enforce: 'pre',
    load(id) {
      if (id.split('?')[0]!.endsWith('/src/styles/fonts.css')) return '/* fonts load from Google Fonts */';
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  // `vite build --mode artifact` makes a self-contained demo for a sandboxed host page:
  // no service worker, fonts from Google Fonts, no source maps.
  const artifact = mode === 'artifact';
  return {
    // Relative base so the static build works from any sub-path (GitHub Pages, file hosting).
    base: './',
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'preact' },
    },
    build: {
      target: 'es2022',
      sourcemap: !artifact,
      outDir: artifact ? 'dist-artifact' : 'dist',
      chunkSizeWarningLimit: 900,
    },
    server: {
      host: true,
    },
    plugins: artifact
      ? [noBundledFonts()]
      : [pwaPlugin(['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'])],
  };
});
