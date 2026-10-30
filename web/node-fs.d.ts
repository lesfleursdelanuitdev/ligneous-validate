// The few Node APIs web/vite.config.ts and the unit tests use; the repo has no @types/node.
declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean;
  export function statSync(path: string | URL): { size: number };
  export function readFileSync(path: string | URL): Uint8Array;
  export function writeFileSync(path: string | URL, data: Uint8Array | string): void;
}

declare module 'node:zlib' {
  export function gunzipSync(data: Uint8Array): Uint8Array;
  export function gzipSync(data: Uint8Array | string, options?: { level?: number }): Uint8Array;
}
