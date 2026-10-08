import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import * as tsm from "ts-morph";
import { fallbackAdapter, type Adapter } from "./adapter.ts";
import { extractImports, type RawImport } from "./extract.ts";
import { computeFan } from "./metrics.ts";
import { resolveImport } from "./resolve.ts";
import {
  SCHEMA_VERSION,
  type Coverage,
  type Edge,
  type EdgeKind,
  type ExcludedReason,
  type FileNode,
  type Occurrence,
  type ParseResult,
  type ReasonGroup,
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

type Parsed = { node: Omit<FileNode, "fanIn" | "fanOut">; imports: RawImport[] };

// Path in, data out. No network, no framework, nothing started.
export function parseRepository(
  dir: string,
  adapter: Adapter = fallbackAdapter,
): ParseResult {
  const root = posix(realpathSync(dir));
  const { project, tsconfig, tsconfigError } = createProject(root);

  const { files: walked, ignoredDirectories } = walk(root);
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
      project.removeSourceFile(source);
      parsed.push({
        node: {
          path,
          folder: adapter.folderOf(path),
          lines: countLines(content),
          hash: createHash("sha256").update(content).digest("hex"),
        },
        imports,
      });
    } catch (error) {
      skipped.push({ path, reason: "analyse-impossible", detail: message(error) });
    }
  }

  // Resolution needs the full set of nodes, so it runs after every file is read.
  const options = project.getCompilerOptions();
  const ctx = {
    root,
    nodes: new Set(parsed.map((p) => p.node.path)),
    skipped: new Map(skipped.map((s) => [s.path, s])),
    options,
    host: project.getModuleResolutionHost(),
    cache: tsm.ts.createModuleResolutionCache(root, (name) => name, options),
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
    tsconfig,
    tsconfigError,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    root: basename(root),
    adapter: adapter.name,
    files,
    edges,
    coverage,
  };
}

// Aliases (`paths`) and `extends` live in the repository's own tsconfig, so
// resolution uses it when it loads. allowJs is forced on: without it
// TypeScript refuses to resolve .js files at all, which would turn every
// import of one into a false "not found".
function createProject(root: string) {
  const overrides: tsm.CompilerOptions = {
    allowJs: true,
    resolveJsonModule: true,
  };
  const configPath = join(root, "tsconfig.json");
  const base = {
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  };

  if (existsSync(configPath)) {
    try {
      return {
        project: new tsm.Project({
          ...base,
          tsConfigFilePath: configPath,
          compilerOptions: overrides,
        }),
        tsconfig: "tsconfig.json",
        tsconfigError: null,
      };
    } catch (error) {
      return {
        project: defaultProject(base, overrides),
        tsconfig: null,
        tsconfigError: message(error),
      };
    }
  }
  return {
    project: defaultProject(base, overrides),
    tsconfig: null,
    tsconfigError: null,
  };
}

function defaultProject(
  base: { skipAddingFilesFromTsConfig: boolean; skipFileDependencyResolution: boolean },
  overrides: tsm.CompilerOptions,
): tsm.Project {
  return new tsm.Project({
    ...base,
    compilerOptions: {
      ...overrides,
      target: tsm.ts.ScriptTarget.ESNext,
      module: tsm.ts.ModuleKind.ESNext,
      moduleResolution: tsm.ts.ModuleResolutionKind.Bundler,
      jsx: tsm.ts.JsxEmit.Preserve,
    },
  });
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
