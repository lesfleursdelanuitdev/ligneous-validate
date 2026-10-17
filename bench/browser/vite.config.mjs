// Bundles read-gedcom for the benchmark worker with the site's own Vite.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  logLevel: 'warn',
  build: {
    outDir: here + '../build',
    emptyOutDir: false,
    minify: true,
    lib: {
      entry: here + 'rg-entry.js',
      name: 'readGedcomBundle',
      formats: ['iife'],
      fileName: () => 'read-gedcom.bundle.js',
    },
  },
});
