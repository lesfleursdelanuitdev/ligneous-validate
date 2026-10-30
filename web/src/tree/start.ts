// The suggested starting person (spec Part 4 item 2, T26): the file's home
// person when the header names one, otherwise the person with the most
// relatives within 3 generations. Pure; the worker runs it on the whole tree.
//
// No value imports: Node runs this file as it is (scripts/enrich-times.mjs).

import type { GraphInput } from './graph';
import type { HomePointers } from './tables';

export type StartSuggestion =
  | { id: string; reason: 'home' | 'root' | 'submitter' }
  | { id: string; reason: 'most-relatives'; relatives: number };

/** "Within 3 generations", read as: at most 3 steps, a step to a parent, a child or a partner. */
const STEPS = 3;

/** The people who aren't placeholders, in file order. */
function realPeople(graph: GraphInput): string[] {
  return graph.people.filter(p => p._unknownPlaceholder !== true).map(p => p.id);
}

/**
 * How many relatives each person has within `steps` steps, each step to a
 * parent, a child or a partner. Each relative counts once; the person
 * themselves and placeholder partners never count, and the walk doesn't go
 * through a placeholder. One walk per person, each touching only that
 * person's relatives: O(people × relatives).
 */
export function relativesWithin(graph: GraphInput, steps: number): Map<string, number> {
  const ids = realPeople(graph);
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const edges: number[][] = ids.map(() => []);
  const link = (a: number | undefined, b: number | undefined) => {
    if (a === undefined || b === undefined || a === b) return;
    edges[a].push(b);
    edges[b].push(a);
  };
  for (const u of graph.unions) {
    const h = index.get(u.husb);
    const w = index.get(u.wife);
    link(h, w);
    for (const c of u.children) {
      const k = index.get(c.id);
      link(h, k);
      link(w, k);
    }
  }
  const seen = new Int32Array(ids.length).fill(-1);
  let frontier = new Int32Array(ids.length);
  let next = new Int32Array(ids.length);
  const out = new Map<string, number>();
  for (let s = 0; s < ids.length; s++) {
    seen[s] = s;
    frontier[0] = s;
    let size = 1;
    let count = 0;
    for (let d = 0; d < steps && size > 0; d++) {
      let n = 0;
      for (let i = 0; i < size; i++) {
        for (const t of edges[frontier[i]]) {
          if (seen[t] === s) continue;
          seen[t] = s;
          next[n++] = t;
          count++;
        }
      }
      [frontier, next] = [next, frontier];
      size = n;
    }
    out.set(ids[s], count);
  }
  return out;
}

/**
 * The person to start from: the header's _HOME, then _ROOT, then the
 * submitter's own INDI, the first that names a person in the file; otherwise
 * the person with the most relatives within 3 generations (the first in file
 * order on a tie). Null for a file with nobody in it.
 */
export function suggestStart(graph: GraphInput, home: HomePointers): StartSuggestion | null {
  const ids = realPeople(graph);
  const known = new Set(ids);
  for (const reason of ['home', 'root', 'submitter'] as const) {
    const id = home[reason];
    if (id && known.has(id)) return { id, reason };
  }
  let best: { id: string; reason: 'most-relatives'; relatives: number } | null = null;
  for (const [id, relatives] of relativesWithin(graph, STEPS)) {
    if (best === null || relatives > best.relatives) best = { id, reason: 'most-relatives', relatives };
  }
  return best;
}
