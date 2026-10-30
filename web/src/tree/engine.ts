// The chart engine's input types, mirrored from @ligneous/visualization-engine
// src/types.ts (DescendancyPerson, UnionChild, UnionRecord; branch
// engine-v0.1.0, 2026-10-30), with only the fields the conversion fills. The
// viewer can't install the engine yet (spec T6); once it does, import the
// engine's own types instead. These are the shared shape of spec Part 2: a
// change to them is agreed with the engine first, never made on one side.

/** Engine: DescendancyPerson. */
export interface DescendancyPerson {
  id: string;
  /** GEDCOM xref (e.g. @I123@); often same as id in builder. */
  xref?: string | null;
  firstName: string;
  lastName: string;
  birthYear?: number | null;
  deathYear?: number | null;
  birthPlace?: string | null;
  deathPlace?: string | null;
  isLiving?: boolean;
  /** Display gender from data (e.g. "Male", "Female", "Unknown") for default icon. */
  gender?: string | null;
  /** Pedigree: muted placeholder card for a missing father/mother/parent slot. */
  _unknownPlaceholder?: boolean;
}

/** Engine: UnionChild. The engine treats pedi "birth" as the birth family. */
export interface UnionChild {
  id: string;
  pedi: string;
}

/** Engine: UnionRecord. husb renders left, wife right; both always hold an id. */
export interface UnionRecord {
  id?: string;
  husb: string;
  wife: string;
  children: UnionChild[];
}

/** Engine: GraphInput (src/graph/GraphSnapshot.ts), what a converter hands to the engine. */
export interface GraphInput {
  readonly people: readonly DescendancyPerson[];
  readonly unions: readonly UnionRecord[];
  /**
   * Each person's parent families (FAMC) in the order their own record lists them: the
   * engine's birth-family rule (T20) takes the first birth family in it, else the first.
   */
  readonly famcOrder?: ReadonlyMap<string, readonly string[]>;
}
