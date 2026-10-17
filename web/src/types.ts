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

/** The kinds of repair, in the library's catalogue order (repair/options.go). */
export type Fix =
  | 'encoding' | 'bom' | 'line-endings' | 'blank-lines' | 'leading-space' | 'long-lines' | 'trailer'
  | 'broken-links' | 'empty-families' | 'submitter';

/** One kind of repair the file could use (available), did use (applied) or skipped. */
export interface FixInfo {
  fix: Fix;
  /** "format" changes how the file is written; "data" changes the family data. */
  kind: 'format' | 'data';
  /** Available: the lines it changes with every fix applied. Applied: the lines it changed. */
  lines: number;
  /** Nothing else can be done unless this is chosen too. */
  required: boolean;
  reason?: string;
}

export interface Change {
  /** 1-based line in the original file; 0 is the whole file. */
  line: number;
  what: string;
  fix?: Fix;
  /** For the data kinds: the lines nested under a removed line. */
  removed?: string[];
}

export interface RepairOut {
  changes: Change[];
  left: string[];
  before: Counts;
  after: Counts;
  /** Missing only in answers from older checkers (and in some tests' fakes). */
  available?: FixInfo[];
  applied?: FixInfo[];
  skipped?: FixInfo[];
  error?: string;
}

/** What the page asks the repair for; fixes left out (undefined) means every format kind. */
export interface RepairOptions {
  fixes?: Fix[];
  submitterName?: string;
}

export interface PlanOut {
  available: FixInfo[];
  error?: string;
}

export type ToWorker =
  | { type: 'check'; bytes: ArrayBuffer }
  | { type: 'repair'; bytes: ArrayBuffer; before?: Counts; options?: RepairOptions }
  | { type: 'plan'; bytes: ArrayBuffer };

export type FromWorker =
  | { type: 'status'; text: string }
  | { type: 'ready' }
  /** How much of the checker has downloaded, 0-99 (whole percent). */
  | { type: 'download'; percent: number }
  /** A stage the Go checker has reached, sent while it is still running. */
  | { type: 'stage'; job: 'check' | 'repair'; stage: string }
  | { type: 'result'; result: Result }
  | { type: 'repaired'; data: ArrayBuffer; info: RepairOut }
  /** The kinds of fix the file could use, from planRepair(). */
  | { type: 'planned'; info: PlanOut }
  | { type: 'error'; message: string };
