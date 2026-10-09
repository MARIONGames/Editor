import { defineConfig } from 'vite';
import { artifactPlugins } from './build/artifact-plugin.ts';
import { pwaPlugin } from './build/pwa-plugin.ts';

export default defineConfig(({ mode }) => {
  // `vite build --mode artifact` makes a demo for a sandboxed host page (see build/artifact-plugin.ts):
  // no service worker, fonts from Google Fonts, no source maps.
  const artifact = mode === 'artifact';
  return {
    // Relative base so the static build works from any sub-path (GitHub Pages, file hosting).
    base: './',
    publicDir: artifact ? false : 'public',
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'preact' },
    },
    build: {
      target: 'es2022',
      sourcemap: !artifact,
      // The demo ships readable JavaScript so anyone can inspect what runs; gzip keeps it small.
      minify: !artifact,
      cssMinify: true,
      outDir: artifact ? 'dist-artifact' : 'dist',
      chunkSizeWarningLimit: 900,
    },
    server: {
      host: true,
    },
    plugins: artifact
      ? artifactPlugins()
      : [pwaPlugin(['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'])],
  };
});
