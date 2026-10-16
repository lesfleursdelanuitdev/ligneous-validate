// The one Node API web/vite.config.ts uses; the repo has no @types/node.
declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean;
  export function statSync(path: string | URL): { size: number };
}
