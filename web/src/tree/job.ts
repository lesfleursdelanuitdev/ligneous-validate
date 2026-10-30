// The worker's enrich job: runs ligneous.enrich() on the file and builds the
// tree (spec Part 4 item 9: the graph is built in the worker), with the same
// progress and error handling as check. Kept out of worker.ts so it can be
// tested without the wasm.

import { buildGraph } from './graph';
import { readEnriched } from './tables';
import type { FromWorker, TreeResult } from '../types';

export interface EnrichApi {
  enrich(bytes: Uint8Array, progress?: (stage: string) => void): string;
}

/** The stage posted while the tree is built from the tables, after Go's own stages. */
export const STAGE_GRAPH = 'graph';

function failed(message: string): TreeResult {
  return {
    isGedcom: false,
    parseFindings: { errors: 0, warnings: 0, hints: 0 },
    graph: { people: [], unions: [] },
    details: { people: new Map(), families: new Map() },
    problems: { duplicatePeople: [], duplicateFamilies: [] },
    error: message,
  };
}

/** The wasm's own failure answer, {"error": …} and nothing else (wasm/main.go errJSON). */
function errorOnly(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null || !('error' in json) || 'tables' in json) return undefined;
  return typeof json.error === 'string' ? json.error : undefined;
}

/**
 * Reads the file into a tree and posts it as `enriched`. Each stage is posted
 * while the job is still running. Any failure (a recovered panic in Go, a
 * crash in the wasm, an answer in the wrong shape) posts an empty tree with
 * the error, as check posts an empty result.
 */
export function runEnrich(api: EnrichApi, bytes: Uint8Array, post: (msg: FromWorker) => void, thisYear: number): void {
  post({ type: 'status', text: 'Reading the file…' });
  let result: TreeResult;
  try {
    const json: unknown = JSON.parse(api.enrich(bytes, stage => post({ type: 'stage', job: 'enrich', stage })));
    const enriched = errorOnly(json) ?? readEnriched(json);
    if (typeof enriched === 'string' || enriched.error !== undefined) {
      result = failed(typeof enriched === 'string' ? enriched : enriched.error ?? '');
    } else {
      post({ type: 'stage', job: 'enrich', stage: STAGE_GRAPH });
      result = { isGedcom: enriched.isGedcom, parseFindings: enriched.parseFindings, ...buildGraph(enriched, { thisYear }) };
    }
  } catch (err) {
    result = failed(String(err));
  }
  post({ type: 'enriched', result });
}
