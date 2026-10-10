import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import * as tsm from "ts-morph";
import { fallbackAdapter, folderOf, type ScopedFile } from "./adapter.ts";
import { ADAPTERS, adapterFor, WATCHED_CALLS } from "./adapters/index.ts";
import { extractFacts, extractImports, type RawImport } from "./extract.ts";
import type { FileFacts } from "./facts.ts";
import { computeFan } from "./metrics.ts";
import { resolveImport } from "./resolve.ts";
import {
  SCHEMA_VERSION,
  type Coverage,
  type Edge,
  type EdgeKind,
  type ExcludedReason,
  type FileNode,
  type FileRole,
  type Occurrence,
  type ParseResult,
  type ReasonGroup,
  type Route,
  type SkippedFile,
  type Tally,
  type UnresolvedReason,
} from "./types.ts";
import { walk } from "./walk.ts";

const MAX_FILE_BYTES = 1_000_000; // above this it is a bundle, not source
const MAX_EXAMPLES = 5;
const EDGE_KINDS: EdgeKind[] = ["import", "reexport", "dynamic"];

const posix = (p: string): string => p.replace(/\\/g, "/");
const emptyTally = (): Tally => ({
  seen: 0,
  resolved: 0,
  external: 0,
  excluded: 0,
  unresolved: 0,
});

type Parsed = {
  node: Omit<FileNode, "fanIn" | "fanOut">;
  imports: RawImport[];
  facts: FileFacts;
};

// Path in, data out. No network, no framework, nothing started.
export function parseRepository(
  dir: string,
  /** Told when each named stage starts; lets a caller report progress. */
  onStage?: (stage: "select" | "parse") => void,
): ParseResult {
  onStage?.("select");
  const root = posix(realpathSync(dir));
  const project = parsingProject();

  const { files: walked, packageFiles, configFiles, ignoredDirectories } = walk(root);
  const { declared, internal, packages } = readPackages(root, packageFiles);
  onStage?.("parse");
  const skipped: SkippedFile[] = [];
  const parsed: Parsed[] = [];

  for (const { path, isSymlink } of walked) {
    if (isSymlink) {
      skipped.push({ path, reason: "lien-symbolique", detail: null });
      continue;
    }
    const abs = `${root}/${path}`;
    let content: string;
    try {
      if (statSync(abs).size > MAX_FILE_BYTES) {
        skipped.push({
          path,
          reason: "trop-volumineux",
          detail: `plus de ${MAX_FILE_BYTES} octets`,
        });
        continue;
      }
      content = readFileSync(abs, "utf8");
    } catch (error) {
      skipped.push({ path, reason: "illisible", detail: message(error) });
      continue;
    }

    try {
      const source = project.createSourceFile(abs, content, { overwrite: true });
      const imports = extractImports(source);
      const facts = extractFacts(source, WATCHED_CALLS);
      project.removeSourceFile(source);
      parsed.push({
        node: {
          path,
          folder: folderOf(path),
          lines: countLines(content),
          hash: createHash("sha256").update(content).digest("hex"),
        },
        imports,
        facts,
      });
    } catch (error) {
      skipped.push({ path, reason: "analyse-impossible", detail: message(error) });
    }
  }

  // Resolution needs the full set of nodes, so it runs after every file is read.
  const host = project.getModuleResolutionHost();
  const configs = new ConfigResolvers(root, configFiles);
  const shared = {
    root,
    nodes: new Set(parsed.map((p) => p.node.path)),
    skipped: new Map(skipped.map((s) => [s.path, s])),
    declared,
    internal,
    host,
  };

  const total = emptyTally();
  const byKind: Record<EdgeKind, Tally> = {
    import: emptyTally(),
    reexport: emptyTally(),
    dynamic: emptyTally(),
  };
  const excluded = new Map<ExcludedReason, ReasonGroup<ExcludedReason>>();
  const unresolved = new Map<UnresolvedReason, ReasonGroup<UnresolvedReason>>();
  const external = new Map<string, number>();
  const edgeKinds = new Map<string, { from: string; to: string; kinds: Set<EdgeKind> }>();

  for (const { node, imports } of parsed) {
    // Each file is resolved with the tsconfig nearest above it: a nested app
    // keeps its own aliases, which the root's config knows nothing about.
    const ctx = { ...shared, ...configs.for(node.path) };
    for (const raw of imports) {
      const occurrence: Occurrence = {
        from: node.path,
        line: raw.line,
        specifier: raw.specifier,
        kind: raw.kind,
      };
      const result = resolveImport(raw.specifier, node.path, ctx);
      total.seen += 1;
      byKind[raw.kind].seen += 1;
      total[result.outcome] += 1;
      byKind[raw.kind][result.outcome] += 1;

      if (result.outcome === "resolved") {
        const key = `${node.path}\0${result.to}`;
        const edge = edgeKinds.get(key) ?? {
          from: node.path,
          to: result.to,
          kinds: new Set<EdgeKind>(),
        };
        edge.kinds.add(raw.kind);
        edgeKinds.set(key, edge);
      } else if (result.outcome === "external") {
        external.set(result.name, (external.get(result.name) ?? 0) + 1);
      } else if (result.outcome === "excluded") {
        addToGroup(excluded, result.reason, occurrence);
      } else {
        addToGroup(unresolved, result.reason, occurrence);
      }
    }
  }

  const edges: Edge[] = [...edgeKinds.values()]
    .map((e) => ({
      from: e.from,
      to: e.to,
      kinds: EDGE_KINDS.filter((k) => e.kinds.has(k)),
    }))
    .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));

  const fan = computeFan(
    parsed.map((p) => p.node.path),
    edges,
  );
  const files: FileNode[] = parsed
    .map(({ node }) => ({ ...node, ...fan.get(node.path)! }))
    .sort((a, b) => compare(a.path, b.path));

  // Each package is read with the adapter its own dependencies select, so a
  // repository holding a Next.js app and a NestJS service is read as both.
  const byPackage = new Map<string, ScopedFile[]>();
  const adapterOf = new Map<string, ReturnType<typeof adapterFor>>();
  for (const { node, facts } of parsed) {
    const scope = scopeOf(node.path, packages);
    const key = scope?.dir ?? "";
    if (!adapterOf.has(key)) {
      adapterOf.set(key, scope === undefined ? fallbackAdapter : adapterFor(scope.dependencies));
    }
    const local =
      scope === undefined || scope.dir === "." ? node.path : node.path.slice(scope.dir.length + 1);
    const list = byPackage.get(key) ?? [];
    list.push({ path: node.path, local, facts });
    byPackage.set(key, list);
  }
  const roles: FileRole[] = [];
  const routes: Route[] = [];
  const used = new Set<string>();
  const context = {
    read: (path: string): string | null => {
      try {
        return readFileSync(`${root}/${path}`, "utf8");
      } catch {
        return null;
      }
    },
  };
  for (const [key, scoped] of byPackage) {
    const adapter = adapterOf.get(key) ?? fallbackAdapter;
    if (adapter !== fallbackAdapter) used.add(adapter.id);
    for (const file of scoped) {
      const role = adapter.roleOf(file);
      if (role !== null) roles.push({ path: file.path, role });
    }
    routes.push(...adapter.routes(scoped, context));
  }
  roles.sort((a, b) => compare(a.path, b.path));
  routes.sort(
    (a, b) => compare(a.pattern, b.pattern) || compare(a.method, b.method) || compare(a.file, b.file),
  );

  const coverage: Coverage = {
    files: {
      found: walked.length,
      parsed: files.length,
      skipped: skipped.length,
    },
    skipped,
    ignoredDirectories,
    imports: total,
    byKind,
    excluded: sortedGroups(excluded),
    unresolved: sortedGroups(unresolved),
    externalPackages: [...external]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || compare(a.name, b.name)),
    tsconfig: configs.used().join(", ") || null,
    tsconfigError: configs.problems().join(" ; ") || null,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    root: basename(root),
    frameworks: ADAPTERS.map((a) => a.id).filter((id) => used.has(id)),
    files,
    edges,
    roles,
    routes,
    coverage,
  };
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

// What the repository's own package.json files say: the packages it depends on
// and the names of the packages it contains. A file that is not valid JSON
// simply declares nothing; the imports that needed it then show as unresolved.
type PackageScope = { dir: string; dependencies: ReadonlySet<string> };

function readPackages(root: string, paths: readonly string[]) {
  const packages: PackageScope[] = [];
  const declared = new Set<string>();
  const internal = new Map<string, string>();
  for (const path of paths) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
    } catch {
      continue;
    }
    if (typeof json !== "object" || json === null) continue;
    const pkg = json as Record<string, unknown>;
    if (typeof pkg.name === "string" && !internal.has(pkg.name)) {
      internal.set(pkg.name, path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");
    }
    const own = new Set<string>();
    for (const field of DEPENDENCY_FIELDS) {
      const deps = pkg[field];
      if (typeof deps === "object" && deps !== null) {
        for (const name of Object.keys(deps)) {
          declared.add(name);
          own.add(name);
        }
      }
    }
    packages.push({
      dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".",
      dependencies: own,
    });
  }
  // A package that lives here may also be declared by a sibling; it stays
  // internal, because its code is in the repository and should resolve there.
  // Deepest first, so the nearest package above a file is the first that matches.
  packages.sort((a, b) => b.dir.length - a.dir.length);
  return { declared, internal, packages };
}

// allowJs is forced on: without it TypeScript refuses to resolve .js files at
// all, which would turn every import of one into a false "not found". JSON
// resolution is on so a .json import is seen as a file, not as missing.
const OVERRIDES: tsm.CompilerOptions = { allowJs: true, resolveJsonModule: true };

// What is used when no tsconfig is found above a file, or one will not load.
const DEFAULT_OPTIONS: tsm.CompilerOptions = {
  ...OVERRIDES,
  target: tsm.ts.ScriptTarget.ESNext,
  module: tsm.ts.ModuleKind.ESNext,
  moduleResolution: tsm.ts.ModuleResolutionKind.Bundler,
  jsx: tsm.ts.JsxEmit.Preserve,
};

// Only reads source files; resolution does not use it.
function parsingProject(): tsm.Project {
  return new tsm.Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: DEFAULT_OPTIONS,
  });
}

// The compiler options for each file: those of the nearest tsconfig.json (or
// jsconfig.json) in its directory or above, with `extends` followed. Loaded
// when first needed and kept, along with a resolution cache per config.
class ConfigResolvers {
  private readonly known: ReadonlySet<string>;
  private readonly loaded = new Map<
    string,
    { options: tsm.ts.CompilerOptions; cache: tsm.ts.ModuleResolutionCache }
  >();
  private readonly errors: string[] = [];
  // Declared as a field, not as a constructor parameter property: Node runs
  // this file with types stripped, and that syntax is not erasable.
  private readonly root: string;

  constructor(root: string, configFiles: readonly string[]) {
    this.root = root;
    this.known = new Set(configFiles);
  }

  /** Configs that were actually used by at least one file. */
  used(): string[] {
    return [...this.loaded.keys()].filter((key) => key !== "").sort();
  }

  /** Configs that could not be read, or whose `extends` could not be found. */
  problems(): string[] {
    return this.errors;
  }

  for(fileRel: string) {
    const key = this.nearest(fileRel) ?? "";
    let entry = this.loaded.get(key);
    if (entry === undefined) {
      const options = key === "" ? DEFAULT_OPTIONS : this.read(key);
      entry = {
        options,
        cache: tsm.ts.createModuleResolutionCache(this.root, (name) => name, options),
      };
      this.loaded.set(key, entry);
    }
    return entry;
  }

  private nearest(fileRel: string): string | null {
    let dir = fileRel.includes("/") ? fileRel.slice(0, fileRel.lastIndexOf("/")) : ".";
    for (;;) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const candidate = dir === "." ? name : `${dir}/${name}`;
        if (this.known.has(candidate)) return candidate;
      }
      if (dir === ".") return null;
      dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : ".";
    }
  }

  // Only what stops a config from being used is reported: a file that will not
  // parse, or an `extends` that is not there (TS6053). Other diagnostics, such
  // as an option this TypeScript does not know, do not change how imports resolve.
  private read(key: string): tsm.ts.CompilerOptions {
    const abs = `${this.root}/${key}`;
    const flat = (d: tsm.ts.Diagnostic) =>
      tsm.ts.flattenDiagnosticMessageText(d.messageText, " ");
    const file = tsm.ts.readConfigFile(abs, tsm.ts.sys.readFile);
    if (file.error !== undefined) {
      this.errors.push(`${key} : ${flat(file.error)}`);
      return DEFAULT_OPTIONS;
    }
    const dir = abs.slice(0, abs.lastIndexOf("/"));
    const parsed = tsm.ts.parseJsonConfigFileContent(file.config, tsm.ts.sys, dir, OVERRIDES, abs);
    for (const d of parsed.errors) {
      if (d.code === 6053) this.errors.push(`${key} : ${flat(d)}`);
    }
    return { ...parsed.options, ...OVERRIDES };
  }
}

// The package a file belongs to: the nearest package.json above it.
function scopeOf(path: string, packages: readonly PackageScope[]): PackageScope | undefined {
  return packages.find((p) => p.dir === "." || path.startsWith(`${p.dir}/`));
}

function addToGroup<R extends string>(
  groups: Map<R, ReasonGroup<R>>,
  reason: R,
  occurrence: Occurrence,
): void {
  const group = groups.get(reason) ?? { reason, count: 0, examples: [] };
  group.count += 1;
  if (group.examples.length < MAX_EXAMPLES) group.examples.push(occurrence);
  groups.set(reason, group);
}

function sortedGroups<R extends string>(
  groups: Map<R, ReasonGroup<R>>,
): ReasonGroup<R>[] {
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || compare(a.reason, b.reason),
  );
}

function countLines(content: string): number {
  if (content === "") return 0;
  const lines = content.split("\n").length;
  return content.endsWith("\n") ? lines - 1 : lines;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
