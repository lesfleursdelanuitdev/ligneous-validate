// What ligneous.enrich() returns (check/enrich.go): the enricher's own tables,
// unchanged, each written with its field names once (check/compact.go, spec
// T24) and read back here into the same records. The row types mirror
// enricher/types.go in ligneous-gedcom-lib v0.3.1, with its JSON names. Index
// fields point into another table; -1 is "none". Fields the library leaves
// out when empty are optional here.

import type { Counts } from '../types';

export interface EnrichedIndividual {
  xref: string;
  /** The first NAME as written, trimmed, slashes kept. */
  full_name: string;
  full_name_lower: string;
  sex?: string;
  birth_date_index: number;
  birth_place_index: number;
  death_date_index: number;
  death_place_index: number;
  primary_surname_lower?: string;
  birth_country?: string;
  birth_country_lower?: string;
  death_country?: string;
  death_country_lower?: string;
  age_at_death?: number;
  occupation_values?: string[];
  nationality_values?: string[];
  religion?: string;
  /** _GENDER. */
  gender?: string;
}

export interface EnrichedFamily {
  xref: string;
  husband_xref?: string;
  wife_xref?: string;
  marriage_date_index: number;
  marriage_place_index: number;
  children_count: number;
}

export interface ParsedDate {
  /** As written. */
  original: string;
  type: string;
  calendar: string;
  /** 0 (left out) when the enricher read no year. */
  year?: number;
  month?: number;
  day?: number;
  end_year?: number;
  end_month?: number;
  end_day?: number;
  hash: string;
}

export interface ParsedPlace {
  /** As written, trimmed. */
  original: string;
  name: string;
  county?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  hash: string;
}

export interface EnrichedEvent {
  index: number;
  event_type: string;
  custom_type?: string;
  event_label?: string;
  date_index: number;
  place_index: number;
  value?: string;
  cause?: string;
  agency?: string;
  owner_xref: string;
  /** "INDI" or "FAM". */
  owner_type: string;
  sort_order: number;
}

/** A person's link to an event (role: "principal" in v0.3.1). */
export interface IndividualEventLink { individual_xref: string; event_index: number; role: string }
export interface FamilyEventLink { family_xref: string; event_index: number }

/** An attribute: OCCU, EDUC, FACT and the rest of INDIVIDUAL_ATTRIBUTE_STRUCTURE, and FAM FACT. */
export interface EnrichedAttribute {
  index: number;
  attribute_type: string;
  /** FACT and IDNO's TYPE. */
  custom_type?: string;
  value?: string;
  date_index: number;
  place_index: number;
  agency?: string;
  owner_xref: string;
  owner_type: string;
  /** Shared with the owner's events and residences: their order in the record. */
  sort_order: number;
}

/** A residence (RESI), kept apart from Events by the enricher. */
export interface EnrichedResidence {
  index: number;
  /** ADDR's ADR1, else ADDR. */
  address?: string;
  date_index: number;
  place_index: number;
  owner_xref: string;
  owner_type: string;
  sort_order: number;
}

export interface ParentChildEdge {
  parent_xref: string;
  child_xref: string;
  family_xref: string;
  /** "father" or "mother". */
  parent_type: string;
  relationship_type: string;
  /** PEDI as written (or from a mixed-parentage note). */
  pedigree?: string;
}

export interface FamilyChildEdge { family_xref: string; child_xref: string; birth_order: number }

export interface NameForm { individual_xref: string; name_type: string; is_primary: boolean; sort_order: number }
export interface NameFormGivenNameLink { name_form_index: number; given_name_index: number; position: number }
export interface NameFormSurnameLink { name_form_index: number; surname_index: number; position: number }
/** Deduplicated by lower case: `value` is the spelling first met in the file. */
export interface NameValue { value: string; lower: string; frequency: number }

/**
 * The tables, under EnrichedDocument's own field names. Spouses is left out
 * (T25); the timeline (T40) reads IndividualEvents, FamilyEvents, Attributes
 * and Residences.
 */
export interface Tables {
  Individuals: EnrichedIndividual[];
  Families: EnrichedFamily[];
  Dates: ParsedDate[];
  Places: ParsedPlace[];
  Events: EnrichedEvent[];
  IndividualEvents: IndividualEventLink[];
  FamilyEvents: FamilyEventLink[];
  Attributes: EnrichedAttribute[];
  Residences: EnrichedResidence[];
  ParentChild: ParentChildEdge[];
  FamilyChildren: FamilyChildEdge[];
  NameForms: NameForm[];
  NameFormGivenNames: NameFormGivenNameLink[];
  NameFormSurnames: NameFormSurnameLink[];
  GivenNames: NameValue[];
  Surnames: NameValue[];
}

export interface HomePointers {
  /** HEAD's own _HOME. */
  home: string;
  /** HEAD's own _ROOT. */
  root: string;
  /** A pointer to an INDI on the submitter record HEAD names. */
  submitter: string;
}

export interface Enriched {
  isGedcom: boolean;
  /** The parser's findings by severity (decoding and line problems; the validator doesn't run). */
  parseFindings: Counts;
  tables: Tables;
  /** individuals[i] is the line of tables.Individuals[i]; families likewise. */
  lines: { individuals: number[]; families: number[] };
  /** famc[i]: the FAMC pointers of tables.Individuals[i]'s record, in its order, as written. */
  famc: string[][];
  /** The header's home-person pointers as written (spec T26); "" when none. */
  home: HomePointers;
  /** The library failed (a recovered panic). */
  error?: string;
}

/** Each table, and the fields its first row must have, with their JSON types. */
const SHAPES: Record<keyof Tables, Record<string, 'string' | 'number' | 'boolean'>> = {
  Individuals: { xref: 'string', full_name: 'string', birth_date_index: 'number', birth_place_index: 'number', death_date_index: 'number', death_place_index: 'number' },
  Families: { xref: 'string', marriage_date_index: 'number', marriage_place_index: 'number' },
  Dates: { original: 'string', type: 'string' },
  Places: { original: 'string' },
  Events: { event_type: 'string', date_index: 'number', place_index: 'number', owner_xref: 'string', owner_type: 'string' },
  IndividualEvents: { individual_xref: 'string', event_index: 'number' },
  FamilyEvents: { family_xref: 'string', event_index: 'number' },
  Attributes: { attribute_type: 'string', date_index: 'number', place_index: 'number', owner_xref: 'string', owner_type: 'string', sort_order: 'number' },
  Residences: { date_index: 'number', place_index: 'number', owner_xref: 'string', owner_type: 'string', sort_order: 'number' },
  ParentChild: { parent_xref: 'string', child_xref: 'string', family_xref: 'string', relationship_type: 'string' },
  FamilyChildren: { family_xref: 'string', child_xref: 'string', birth_order: 'number' },
  NameForms: { individual_xref: 'string', name_type: 'string', is_primary: 'boolean' },
  NameFormGivenNames: { name_form_index: 'number', given_name_index: 'number', position: 'number' },
  NameFormSurnames: { name_form_index: 'number', surname_index: 'number', position: 'number' },
  GivenNames: { value: 'string' },
  Surnames: { value: 'string' },
};

export class EnrichShapeError extends Error {
  constructor(what: string) {
    super(`the file reader's answer is not in the expected shape: ${what}`);
    this.name = 'EnrichShapeError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.every(n => typeof n === 'number');

/**
 * One compact table read back into its records: a null is a field the plain
 * encoding leaves out. Every row must have a value for each column; of the
 * values, only the first row's required fields are type-checked.
 */
function records(name: string, table: unknown, fields: Record<string, 'string' | 'number' | 'boolean'>): unknown[] {
  if (!isObject(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    throw new EnrichShapeError(`tables.${name} is not {columns, rows}`);
  }
  const columns: unknown[] = table.columns;
  const rows: unknown[] = table.rows;
  if (!columns.every((c): c is string => typeof c === 'string' && c !== '__proto__')) {
    throw new EnrichShapeError(`tables.${name}.columns`);
  }
  const names = columns as string[];
  const n = names.length;
  if (rows.length > 0) {
    for (const [field, type] of Object.entries(fields)) {
      const at = names.indexOf(field);
      const first = rows[0];
      if (at < 0 || !Array.isArray(first) || typeof first[at] !== type) throw new EnrichShapeError(`tables.${name}: ${field}`);
    }
  }
  const out: Record<string, unknown>[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length !== n) throw new EnrichShapeError(`tables.${name} row ${i}`);
    const rec: Record<string, unknown> = {};
    for (let j = 0; j < n; j++) {
      const v: unknown = row[j];
      if (v !== null) rec[names[j]] = v;
    }
    out[i] = rec;
  }
  return out;
}

/**
 * Checks the parsed answer of ligneous.enrich() and returns it typed, each
 * table read back into its records. The top level is checked in full; every
 * row's length too, but of the values only the first row's required fields:
 * the rows come from our own wasm, built from the same Go types, and the
 * check catches a wasm built from another library version.
 */
export function readEnriched(json: unknown): Enriched {
  if (!isObject(json)) throw new EnrichShapeError('not an object');
  const { isGedcom, parseFindings, tables, lines, famc, home, error } = json;
  if (typeof isGedcom !== 'boolean') throw new EnrichShapeError('isGedcom');
  if (error !== undefined && typeof error !== 'string') throw new EnrichShapeError('error');
  if (!isObject(parseFindings) || !['errors', 'warnings', 'hints'].every(k => typeof parseFindings[k] === 'number')) {
    throw new EnrichShapeError('parseFindings');
  }
  if (!isObject(lines) || !numbers(lines.individuals) || !numbers(lines.families)) throw new EnrichShapeError('lines');
  if (!isObject(home) || typeof home.home !== 'string' || typeof home.root !== 'string' || typeof home.submitter !== 'string') {
    throw new EnrichShapeError('home');
  }
  if (!isObject(tables)) throw new EnrichShapeError('tables');
  const out: Record<string, unknown[]> = {};
  for (const [name, fields] of Object.entries(SHAPES)) out[name] = records(name, tables[name], fields);
  if (lines.individuals.length !== out.Individuals.length || lines.families.length !== out.Families.length) {
    throw new EnrichShapeError('lines do not match the rows');
  }
  if (!Array.isArray(famc) || famc.length !== out.Individuals.length ||
      !famc.every((l: unknown) => Array.isArray(l) && l.every(x => typeof x === 'string'))) {
    throw new EnrichShapeError('famc');
  }
  return {
    isGedcom,
    parseFindings: { errors: Number(parseFindings.errors), warnings: Number(parseFindings.warnings), hints: Number(parseFindings.hints) },
    // Checked above: every table's rows were read into records whose first has its fields.
    tables: out as unknown as Tables,
    lines: { individuals: lines.individuals, families: lines.families },
    // Checked above: one list of strings per person.
    famc: famc as string[][],
    home: { home: home.home, root: home.root, submitter: home.submitter },
    ...(error ? { error } : {}),
  };
}
