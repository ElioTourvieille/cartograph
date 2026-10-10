// The shape the parser writes. Everything built after phase 3 reads this, so
// changing it is a contract change: bump SCHEMA_VERSION.

export const SCHEMA_VERSION = 2;

export type EdgeKind = "import" | "reexport" | "dynamic";

export type FileNode = {
  /** Posix path relative to the parsed directory. */
  path: string;
  /** The folder this file belongs to, as decided by the adapter. */
  folder: string;
  lines: number;
  /** sha256 of the file contents, hex. */
  hash: string;
  fanIn: number;
  fanOut: number;
};

/** One edge per (from, to) pair; `kinds` lists every way `from` reaches `to`. */
export type Edge = {
  from: string;
  to: string;
  kinds: EdgeKind[];
};

export type SkipReason =
  | "trop-volumineux"
  | "lien-symbolique"
  | "illisible"
  | "analyse-impossible";

export type SkippedFile = {
  path: string;
  reason: SkipReason;
  detail: string | null;
};

export type IgnoredDirectory = {
  path: string;
  reason: "dossier-exclu" | "lien-symbolique";
};

export type Outcome = "resolved" | "external" | "excluded" | "unresolved";

export type ExcludedReason = "ressource" | "dossier-exclu" | "fichier-ignore";

export type UnresolvedReason =
  | "fichier-introuvable"
  | "alias-sans-correspondance"
  | "introuvable-sous-baseurl"
  | "specifier-non-litteral"
  | "paquet-non-declare"
  | "paquet-interne-non-resolu";

export type Occurrence = {
  from: string;
  line: number;
  /** null when the specifier is not a literal string. */
  specifier: string | null;
  kind: EdgeKind;
};

export type ReasonGroup<R extends string> = {
  reason: R;
  count: number;
  examples: Occurrence[];
};

export type Tally = {
  seen: number;
  resolved: number;
  external: number;
  excluded: number;
  unresolved: number;
};

export type Coverage = {
  files: { found: number; parsed: number; skipped: number };
  skipped: SkippedFile[];
  ignoredDirectories: IgnoredDirectory[];
  imports: Tally;
  byKind: Record<EdgeKind, Tally>;
  excluded: ReasonGroup<ExcludedReason>[];
  unresolved: ReasonGroup<UnresolvedReason>[];
  externalPackages: { name: string; count: number }[];
  /** The tsconfig used to resolve imports, or null if none was usable. */
  tsconfig: string | null;
  tsconfigError: string | null;
};

export type ParseResult = {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Name of the parsed directory (not its absolute path). */
  root: string;
  adapter: string;
  files: FileNode[];
  edges: Edge[];
  coverage: Coverage;
};
