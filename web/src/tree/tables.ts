// What ligneous.enrich() returns (check/enrich.go): the enricher's own tables,
// unchanged. The row types mirror enricher/types.go in ligneous-gedcom-lib
// v0.3.1, with its JSON names. Index fields point into another table; -1 is
// "none". Fields the library leaves out when empty are optional here.

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

export interface IndividualEventLink { individual_xref: string; event_index: number; role: string }
export interface FamilyEventLink { family_xref: string; event_index: number }
export interface SpouseEdge { individual_xref: string; spouse_xref: string; family_xref: string }

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

/** The tables, under EnrichedDocument's own field names. */
export interface Tables {
  Individuals: EnrichedIndividual[];
  Families: EnrichedFamily[];
  Dates: ParsedDate[];
  Places: ParsedPlace[];
  Events: EnrichedEvent[];
  IndividualEvents: IndividualEventLink[];
  FamilyEvents: FamilyEventLink[];
  Spouses: SpouseEdge[];
  ParentChild: ParentChildEdge[];
  FamilyChildren: FamilyChildEdge[];
  NameForms: NameForm[];
  NameFormGivenNames: NameFormGivenNameLink[];
  NameFormSurnames: NameFormSurnameLink[];
  GivenNames: NameValue[];
  Surnames: NameValue[];
}

export interface Enriched {
  isGedcom: boolean;
  /** The parser's findings by severity (decoding and line problems; the validator doesn't run). */
  parseFindings: Counts;
  tables: Tables;
  /** individuals[i] is the line of tables.Individuals[i]; families likewise. */
  lines: { individuals: number[]; families: number[] };
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
  Spouses: { individual_xref: 'string', spouse_xref: 'string', family_xref: 'string' },
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
 * Checks the parsed answer of ligneous.enrich() and returns it typed. The top
 * level is checked in full; of each table, only the first row. The rows come
 * from our own wasm, built from the same Go types, and checking every row of
 * a big file (over a million) would cost more than the conversion. The
 * first-row check catches a wasm built from another library version.
 */
export function readEnriched(json: unknown): Enriched {
  if (!isObject(json)) throw new EnrichShapeError('not an object');
  const { isGedcom, parseFindings, tables, lines, error } = json;
  if (typeof isGedcom !== 'boolean') throw new EnrichShapeError('isGedcom');
  if (error !== undefined && typeof error !== 'string') throw new EnrichShapeError('error');
  if (!isObject(parseFindings) || !['errors', 'warnings', 'hints'].every(k => typeof parseFindings[k] === 'number')) {
    throw new EnrichShapeError('parseFindings');
  }
  if (!isObject(lines) || !numbers(lines.individuals) || !numbers(lines.families)) throw new EnrichShapeError('lines');
  if (!isObject(tables)) throw new EnrichShapeError('tables');
  const out: Record<string, unknown[]> = {};
  for (const [name, fields] of Object.entries(SHAPES)) {
    const rows = tables[name];
    if (!Array.isArray(rows)) throw new EnrichShapeError(`tables.${name} is not a list`);
    const first: unknown = rows[0];
    if (rows.length > 0) {
      if (!isObject(first)) throw new EnrichShapeError(`tables.${name}[0]`);
      for (const [field, type] of Object.entries(fields)) {
        if (typeof first[field] !== type) throw new EnrichShapeError(`tables.${name}[0].${field}`);
      }
    }
    out[name] = rows;
  }
  if (lines.individuals.length !== out.Individuals.length || lines.families.length !== out.Families.length) {
    throw new EnrichShapeError('lines do not match the rows');
  }
  return {
    isGedcom,
    parseFindings: { errors: Number(parseFindings.errors), warnings: Number(parseFindings.warnings), hints: Number(parseFindings.hints) },
    // Checked above: every table is a list whose first row has its fields.
    tables: out as unknown as Tables,
    lines: { individuals: lines.individuals, families: lines.families },
    ...(error ? { error } : {}),
  };
}
