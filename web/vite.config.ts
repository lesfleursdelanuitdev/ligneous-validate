import { defineConfig } from 'vite';

// Run from the repo root as `vite build web`: this folder is the root.
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  worker: { format: 'es' },
});
