import { defineConfig } from 'vite';
import { pwaPlugin } from './build/pwa-plugin';

export default defineConfig({
  // Relative base so the static build works from any sub-path (GitHub Pages, file hosting).
  base: './',
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
  plugins: [
    pwaPlugin(['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable.png']),
  ],
});
