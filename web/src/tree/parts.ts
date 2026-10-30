// The tree goes from the worker to the page in parts (spec T24: no freeze).
// One message holding a 70,000-person tree took one 358 ms task on the
// page's main thread to copy in. Parts of 10,000 records still gave one task
// of 64 ms; parts of 5,000 are short tasks, with the page free to draw (the
// progress bar) between them.
//
// No value imports: Node runs this file as it is.

import type { FamilyDetails, GraphPerson, GraphUnion, PersonDetails } from './graph';
import type { TreeResult } from '../types';

/** Records in one part. */
export const PART_SIZE = 5_000;

export type TreePart =
  | { kind: 'people'; rows: GraphPerson[] }
  | { kind: 'unions'; rows: GraphUnion[] }
  | { kind: 'personDetails'; rows: [string, PersonDetails][] }
  | { kind: 'familyDetails'; rows: [string, FamilyDetails][] };

/** Everything else of the tree, sent last, with the number of parts sent before it. */
export type TreeSummary = Omit<TreeResult, 'graph' | 'details'> & { parts: number };

function slices<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** The tree as parts of at most `size` records, each kind in order, then its summary. */
export function splitTree(r: TreeResult, size = PART_SIZE): { parts: TreePart[]; summary: TreeSummary } {
  if (!(size >= 1)) throw new RangeError(`part size ${size}`);
  const parts: TreePart[] = [
    ...slices(r.graph.people, size).map(rows => ({ kind: 'people' as const, rows })),
    ...slices(r.graph.unions, size).map(rows => ({ kind: 'unions' as const, rows })),
    ...slices([...r.details.people], size).map(rows => ({ kind: 'personDetails' as const, rows })),
    ...slices([...r.details.families], size).map(rows => ({ kind: 'familyDetails' as const, rows })),
  ];
  const { graph: _graph, details: _details, ...rest } = r;
  return { parts, summary: { ...rest, parts: parts.length } };
}

export interface TreeAssembler {
  /** Takes in one part, as it arrives (each is a short task). */
  add(part: TreePart): void;
  /** The whole tree, once the summary has come. Throws if a part is missing. */
  finish(summary: TreeSummary): TreeResult;
}

export function treeAssembler(): TreeAssembler {
  const people: GraphPerson[] = [];
  const unions: GraphUnion[] = [];
  const personDetails = new Map<string, PersonDetails>();
  const familyDetails = new Map<string, FamilyDetails>();
  let count = 0;
  return {
    add(part) {
      count++;
      switch (part.kind) {
        case 'people': for (const p of part.rows) people.push(p); break;
        case 'unions': for (const u of part.rows) unions.push(u); break;
        case 'personDetails': for (const [id, d] of part.rows) personDetails.set(id, d); break;
        case 'familyDetails': for (const [id, d] of part.rows) familyDetails.set(id, d); break;
      }
    },
    finish(summary) {
      if (count !== summary.parts) throw new Error(`the tree came in ${count} parts of ${summary.parts}`);
      const { parts: _parts, ...rest } = summary;
      return { ...rest, graph: { people, unions }, details: { people: personDetails, families: familyDetails } };
    },
  };
}
