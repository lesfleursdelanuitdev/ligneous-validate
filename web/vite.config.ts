import { defineConfig } from 'vite';
import { wasmSize } from './wasm-size';

const WASM = new URL('./src/wasm/ligneous.wasm', import.meta.url);
const devSize = () => { try { return wasmSize(WASM); } catch { return 0; } };

// Run from the repo root as `vite build web`: this folder is the root.
export default defineConfig(({ command }) => ({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  worker: { format: 'es' },
  // The checker's size, for its download progress when the server gzips it
  // (Content-Length is then the compressed size). A build without the checker
  // fails here rather than baking in 0. The dev server only uses it for its
  // download progress, so there a missing checker gives 0 (and fails to load).
  define: { __WASM_SIZE__: JSON.stringify(command === 'build' ? wasmSize(WASM) : devSize()) },
}));
