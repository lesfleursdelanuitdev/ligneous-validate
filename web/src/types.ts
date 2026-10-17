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
  /** Other kinds this one needs to do all it can (empty-families: broken-links). */
  needs?: Fix[];
}

/** One change a kind would make (repair.Plan): as its Change would say it, with its lines. */
export interface Unit {
  line: number;
  what: string;
  /** Removed lines under a removed line (data kinds), "" for a blank line, or the lines added. */
  lines?: string[];
}

export type Units = Partial<Record<Fix, Unit[]>>;

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
  /** What each kind would change if chosen with the fixes the plan was asked for. */
  units?: Units;
  error?: string;
}

export type ToWorker =
  /** `save`: check what Download edited file gives (the editor's Check again). */
  | { type: 'check'; bytes: ArrayBuffer; save?: boolean }
  /** `save`: work on what Download edited file gives, as the editor's Check again did. */
  | { type: 'repair'; bytes: ArrayBuffer; before?: Counts; options?: RepairOptions; save?: boolean }
  /** id: answers to an older request are dropped. */
  | { type: 'plan'; bytes: ArrayBuffer; options?: RepairOptions; id: number; save?: boolean }
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
  /** The preview of each kind of fix, from plan(). */
  | { type: 'planned'; info: PlanOut; id: number }
  | { type: 'saved'; data: ArrayBuffer; error?: string }
  | { type: 'error'; message: string };
