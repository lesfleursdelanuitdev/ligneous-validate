import { existsSync, statSync } from 'node:fs';

/** The checker's size in bytes, for the build. Throws if it is missing or empty. */
export function wasmSize(file: URL): number {
  if (!existsSync(file)) throw new Error(`the checker is missing: ${file.pathname} (run scripts/build-wasm.sh)`);
  const size = statSync(file).size;
  if (!(size > 0)) throw new Error(`the checker is empty: ${file.pathname}`);
  return size;
}
