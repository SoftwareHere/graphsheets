import { defineConfig } from 'vite';

// The app's source page lives in src/index.html. `npm run build` writes the
// finished site to dist/ and then copies it to the repo root (see
// scripts/copy-build.mjs), which is what GitHub Pages serves.
export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
