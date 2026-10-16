import { existsSync, statSync } from 'node:fs';
import { defineConfig } from 'vite';

// The checker's size, for its download progress when the server gzips it
// (Content-Length is then the compressed size).
const wasm = new URL('./src/wasm/ligneous.wasm', import.meta.url);
const wasmSize = existsSync(wasm) ? statSync(wasm).size : 0;

// Run from the repo root as `vite build web`: this folder is the root.
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  worker: { format: 'es' },
  define: { __WASM_SIZE__: JSON.stringify(wasmSize) },
});
