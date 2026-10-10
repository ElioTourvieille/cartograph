import {
  SCHEMA_VERSION,
  type Coverage,
  type Edge,
  type EdgeKind,
  type FileNode,
  type ParseResult,
  type Tally,
} from "./types.ts";

// Reads a result back from untrusted JSON and proves it has the contract's
// shape, and that the numbers inside it agree with each other. Throws with the
// path of the first thing that is wrong.

type Rec = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new Error(`Résultat invalide à ${path} : ${expected} attendu.`);
}

function rec(value: unknown, path: string): Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "objet");
  }
  return value as Rec;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "tableau");
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "chaîne");
  return value;
}

function int(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(path, "entier positif");
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  const s = str(value, path);
  if (!allowed.includes(s as T)) fail(path, allowed.join(" | "));
  return s as T;
}

const KINDS = ["import", "reexport", "dynamic"] as const;

function tally(value: unknown, path: string): Tally {
  const o = rec(value, path);
  const t: Tally = {
    seen: int(o.seen, `${path}.seen`),
    resolved: int(o.resolved, `${path}.resolved`),
    external: int(o.external, `${path}.external`),
    excluded: int(o.excluded, `${path}.excluded`),
    unresolved: int(o.unresolved, `${path}.unresolved`),
  };
  if (t.resolved + t.external + t.excluded + t.unresolved !== t.seen) {
    fail(path, "seen égal à la somme des quatre issues");
  }
  return t;
}

function occurrences(value: unknown, path: string) {
  return arr(value, path).map((item, i) => {
    const o = rec(item, `${path}[${i}]`);
    return {
      from: str(o.from, `${path}[${i}].from`),
      line: int(o.line, `${path}[${i}].line`),
      specifier: o.specifier === null ? null : str(o.specifier, `${path}[${i}].specifier`),
      kind: oneOf(o.kind, KINDS, `${path}[${i}].kind`),
    };
  });
}

function groups<R extends string>(value: unknown, reasons: readonly R[], path: string) {
  return arr(value, path).map((item, i) => {
    const o = rec(item, `${path}[${i}]`);
    return {
      reason: oneOf(o.reason, reasons, `${path}[${i}].reason`),
      count: int(o.count, `${path}[${i}].count`),
      examples: occurrences(o.examples, `${path}[${i}].examples`),
    };
  });
}

export function parseResult(input: unknown): ParseResult {
  const o = rec(input, "$");
  if (o.schemaVersion !== SCHEMA_VERSION) fail("$.schemaVersion", String(SCHEMA_VERSION));

  const files: FileNode[] = arr(o.files, "$.files").map((item, i) => {
    const f = rec(item, `$.files[${i}]`);
    return {
      path: str(f.path, `$.files[${i}].path`),
      folder: str(f.folder, `$.files[${i}].folder`),
      lines: int(f.lines, `$.files[${i}].lines`),
      hash: str(f.hash, `$.files[${i}].hash`),
      fanIn: int(f.fanIn, `$.files[${i}].fanIn`),
      fanOut: int(f.fanOut, `$.files[${i}].fanOut`),
    };
  });
  const known = new Set(files.map((f) => f.path));

  const edges: Edge[] = arr(o.edges, "$.edges").map((item, i) => {
    const e = rec(item, `$.edges[${i}]`);
    const from = str(e.from, `$.edges[${i}].from`);
    const to = str(e.to, `$.edges[${i}].to`);
    // An edge to a file that is not a node is the failure this phase exists to
    // prevent, so it is checked here, not trusted.
    if (!known.has(from)) fail(`$.edges[${i}].from`, "un fichier présent dans files");
    if (!known.has(to)) fail(`$.edges[${i}].to`, "un fichier présent dans files");
    const kinds: EdgeKind[] = arr(e.kinds, `$.edges[${i}].kinds`).map((k, j) =>
      oneOf(k, KINDS, `$.edges[${i}].kinds[${j}]`),
    );
    return { from, to, kinds };
  });

  const c = rec(o.coverage, "$.coverage");
  const cf = rec(c.files, "$.coverage.files");
  const byKind = rec(c.byKind, "$.coverage.byKind");
  const coverage: Coverage = {
    files: {
      found: int(cf.found, "$.coverage.files.found"),
      parsed: int(cf.parsed, "$.coverage.files.parsed"),
      skipped: int(cf.skipped, "$.coverage.files.skipped"),
    },
    skipped: arr(c.skipped, "$.coverage.skipped").map((item, i) => {
      const s = rec(item, `$.coverage.skipped[${i}]`);
      return {
        path: str(s.path, `$.coverage.skipped[${i}].path`),
        reason: oneOf(
          s.reason,
          ["trop-volumineux", "lien-symbolique", "illisible", "analyse-impossible"],
          `$.coverage.skipped[${i}].reason`,
        ),
        detail: s.detail === null ? null : str(s.detail, `$.coverage.skipped[${i}].detail`),
      };
    }),
    ignoredDirectories: arr(c.ignoredDirectories, "$.coverage.ignoredDirectories").map(
      (item, i) => {
        const d = rec(item, `$.coverage.ignoredDirectories[${i}]`);
        return {
          path: str(d.path, `$.coverage.ignoredDirectories[${i}].path`),
          reason: oneOf(
            d.reason,
            ["dossier-exclu", "lien-symbolique"],
            `$.coverage.ignoredDirectories[${i}].reason`,
          ),
        };
      },
    ),
    imports: tally(c.imports, "$.coverage.imports"),
    byKind: {
      import: tally(byKind.import, "$.coverage.byKind.import"),
      reexport: tally(byKind.reexport, "$.coverage.byKind.reexport"),
      dynamic: tally(byKind.dynamic, "$.coverage.byKind.dynamic"),
    },
    excluded: groups(
      c.excluded,
      ["ressource", "dossier-exclu", "fichier-ignore"],
      "$.coverage.excluded",
    ),
    unresolved: groups(
      c.unresolved,
      [
        "fichier-introuvable",
        "alias-sans-correspondance",
        "introuvable-sous-baseurl",
        "specifier-non-litteral",
        "paquet-non-declare",
        "paquet-interne-non-resolu",
      ],
      "$.coverage.unresolved",
    ),
    externalPackages: arr(c.externalPackages, "$.coverage.externalPackages").map((item, i) => {
      const p = rec(item, `$.coverage.externalPackages[${i}]`);
      return {
        name: str(p.name, `$.coverage.externalPackages[${i}].name`),
        count: int(p.count, `$.coverage.externalPackages[${i}].count`),
      };
    }),
    tsconfig: c.tsconfig === null ? null : str(c.tsconfig, "$.coverage.tsconfig"),
    tsconfigError:
      c.tsconfigError === null ? null : str(c.tsconfigError, "$.coverage.tsconfigError"),
  };

  if (coverage.files.parsed + coverage.files.skipped !== coverage.files.found) {
    fail("$.coverage.files", "parsed + skipped égal à found");
  }
  if (coverage.files.parsed !== files.length) {
    fail("$.coverage.files.parsed", "le nombre de fichiers dans files");
  }
  if (coverage.files.skipped !== coverage.skipped.length) {
    fail("$.coverage.files.skipped", "le nombre d'entrées dans skipped");
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    root: str(o.root, "$.root"),
    adapter: str(o.adapter, "$.adapter"),
    files,
    edges,
    coverage,
  };
}
