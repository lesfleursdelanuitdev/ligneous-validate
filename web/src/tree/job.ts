// The worker's enrich job: runs ligneous.enrich() on the file and builds the
// tree (spec Part 4 item 9: the graph is built in the worker), with the same
// progress and error handling as check. Kept out of worker.ts so it can be
// tested without the wasm.

import { buildGraph } from './graph';
import { splitTree } from './parts';
import { suggestStart } from './start';
import { readEnriched } from './tables';
import { timelineFor, timelineSource } from './timeline';
import type { TimelineSource } from './timeline';
import type { FromWorker, ToWorker, TreeResult } from '../types';

export interface EnrichApi {
  enrich(bytes: Uint8Array, progress?: (stage: string) => void): string;
}

/** The stage posted while the tree is built from the tables, after Go's own stages. */
export const STAGE_GRAPH = 'graph';

function failed(message: string): TreeResult {
  return {
    isGedcom: false,
    parseFindings: { errors: 0, warnings: 0, hints: 0 },
    graph: { people: [], unions: [], famcOrder: new Map(), famsOrder: new Map() },
    details: { people: new Map(), families: new Map() },
    problems: { duplicatePeople: [], duplicateFamilies: [] },
    start: null,
    error: message,
  };
}

/** The wasm's own failure answer, {"error": …} and nothing else (wasm/main.go errJSON). */
function errorOnly(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null || !('error' in json) || 'tables' in json) return undefined;
  return typeof json.error === 'string' ? json.error : undefined;
}

/**
 * Reads the file into a tree and posts it: `tree-part` messages (parts.ts),
 * then `enriched` with the rest and the number of parts. Each stage is posted
 * while the job is still running. Any failure (a recovered panic in Go, a
 * crash in the wasm, an answer in the wrong shape) posts an empty tree with
 * the error, as check posts an empty result.
 *
 * Returns the file's timeline source (T40), built after the tree is posted,
 * so the page has its chart first; null when the read failed.
 */
export function runEnrich(api: EnrichApi, bytes: Uint8Array, post: (msg: FromWorker) => void, thisYear: number): TimelineSource | null {
  post({ type: 'status', text: 'Reading the file…' });
  let result: TreeResult;
  let timeline: (() => TimelineSource) | null = null;
  try {
    const json: unknown = JSON.parse(api.enrich(bytes, stage => post({ type: 'stage', job: 'enrich', stage })));
    const enriched = errorOnly(json) ?? readEnriched(json);
    if (typeof enriched === 'string' || enriched.error !== undefined) {
      result = failed(typeof enriched === 'string' ? enriched : enriched.error ?? '');
    } else {
      post({ type: 'stage', job: 'enrich', stage: STAGE_GRAPH });
      const tree = buildGraph(enriched, { thisYear });
      result = { isGedcom: enriched.isGedcom, parseFindings: enriched.parseFindings, ...tree, start: suggestStart(tree.graph, enriched.home) };
      timeline = () => timelineSource(enriched, tree);
    }
  } catch (err) {
    result = failed(String(err));
  }
  const { parts, summary } = splitTree(result);
  for (const part of parts) post({ type: 'tree-part', part });
  post({ type: 'enriched', summary });
  try {
    return timeline ? timeline() : null;
  } catch {
    return null; // the tree is shown; timelineFor then says no file has been read
  }
}

/** Answers a page's request for one person's timeline from the last file read. */
export function runTimeline(source: TimelineSource | null, msg: Extract<ToWorker, { type: 'timeline' }>, post: (msg: FromWorker) => void): void {
  const { id, request } = msg;
  if (!source) {
    post({ type: 'timeline', request, id, events: [], error: 'no file has been read' });
    return;
  }
  post({ type: 'timeline', request, id, events: timelineFor(id, source, { hideLiving: msg.hideLiving }) });
}
