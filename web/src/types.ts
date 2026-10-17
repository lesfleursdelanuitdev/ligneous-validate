// Mirrors check/check.go, check/summary.go and check/repair.go.

export type Severity = 'error' | 'warning' | 'hint';
export type Group = 'format' | 'header' | 'links' | 'dates' | 'names';
export type Role = 'person' | 'child' | 'father' | 'mother' | 'family' | 'target';

export interface EncodingInfo {
  detected: string;
  declared: string;
  reason: string;
}

export interface Summary {
  people: number;
  families: number;
  sources: number;
  notes: number;
  media: number;
  years: [number, number] | null;
  program: string;
  programVersion: string;
  gedcomVersion: string;
  lines: number;
}

export interface Finding {
  code: string;
  severity: Severity;
  /** "" when the code has no catalog entry. */
  group: Group | '';
  title: string;
  meaning: string;
  howToFix: string;
  /** 0 means the whole file. */
  line: number;
  details: Record<string, string>;
  xrefs: string[];
  roles: Partial<Record<Role, string>>;
}

export interface Result {
  encoding: EncodingInfo;
  summary: Summary;
  findings: Finding[];
  names: Record<string, string>;
  text: string;
  isGedcom: boolean;
  /** Set when the checker failed (a recovered panic, or a crash in the worker). */
  error?: string;
  /** The raw file starts with a byte order mark. */
  bom?: boolean;
  /** Some line ends in a lone CR. */
  bareCR?: boolean;
}

export interface Counts {
  errors: number;
  warnings: number;
  hints: number;
}

export interface RepairOut {
  changes: { line: number; what: string }[];
  left: string[];
  before: Counts;
  after: Counts;
  error?: string;
}

export type ToWorker =
  | { type: 'check'; bytes: ArrayBuffer }
  | { type: 'repair'; bytes: ArrayBuffer; before?: Counts }
  /** The editor's Download edited file: UTF-8 with CHAR UTF-8, nothing else changed. */
  | { type: 'save'; bytes: ArrayBuffer };

export type FromWorker =
  | { type: 'status'; text: string }
  | { type: 'ready' }
  /** How much of the checker has downloaded, 0-99 (whole percent). */
  | { type: 'download'; percent: number }
  /** A stage the Go checker has reached, sent while it is still running. */
  | { type: 'stage'; job: 'check' | 'repair'; stage: string }
  | { type: 'result'; result: Result }
  | { type: 'repaired'; data: ArrayBuffer; info: RepairOut }
  | { type: 'saved'; data: ArrayBuffer; error?: string }
  | { type: 'error'; message: string };
