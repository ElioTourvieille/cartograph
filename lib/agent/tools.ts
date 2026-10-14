import { importFigure, percent, type StoredCoverage } from "../../graph/coverage.ts";
import { fileDetail, indexEdges, summarize, type Index } from "../../graph/detail.ts";
import { DEFAULT_DEPTH, reach, type Way } from "../../graph/reach.ts";
import { ROLES } from "../../graph/taxonomy.ts";
import type { Graph } from "../../graph/types.ts";

// The agent's six tools, as plain functions over the same Graph the canvas is
// drawn from. They call summarize(), fileDetail() and reach(): nothing in the
// graph is recomputed here, and nothing here can relate two files that the edge
// list does not. The agent picks a file and a direction; the existing walk
// does the walking.
//
// Every list is bounded. A result that was cut says how many were left, so
// "25 shown of 312" is the answer, never the whole repository and never a
// silent truncation.

export const LIST_CAP = 25;
export const WALK_CAP = 40;
export const MAX_DEPTH = 4;

export type Bounded<T> = { total: number; shown: T[]; more: number };

function bounded<T>(items: readonly T[], cap: number): Bounded<T> {
  return {
    total: items.length,
    shown: items.slice(0, cap),
    more: Math.max(0, items.length - cap),
  };
}

const roleLabelOf = (graph: Graph) => {
  const byPath = new Map(graph.roles.map((r) => [r.path, r.role]));
  return (path: string): string | null => {
    const id = byPath.get(path);
    return id === undefined ? null : (ROLES.get(id)?.label ?? null);
  };
};

/** What a tool can say about a path the analysis does not contain. */
export type NotFound = { found: false; reason: string };

const missing = (path: string): NotFound => ({
  found: false,
  reason: `Le chemin « ${path} » ne figure pas dans l'analyse.`,
});

// --- the six tools ---------------------------------------------------------------

export function summary(graph: Graph, coverage: StoredCoverage | null) {
  const s = summarize(graph);
  const figure = coverage === null ? null : importFigure(coverage);
  const label = roleLabelOf(graph);
  const perRole = new Map<string, number>();
  for (const f of graph.files) {
    const l = label(f.path);
    if (l !== null) perRole.set(l, (perRole.get(l) ?? 0) + 1);
  }
  return {
    repository: s.name,
    frameworks: s.frameworks,
    files: s.files,
    imports: s.imports,
    // null, not zero, when no framework was recognised.
    routes: s.routes,
    filesWithoutRole: s.unidentified,
    filesPerRole: [...perRole]
      .map(([role, files]) => ({ role, files }))
      .sort((a, b) => b.files - a.files),
    mostImported: s.leaned,
    importedByNothing: { total: s.unimportedTotal, shown: s.unimported },
    coverage:
      coverage === null
        ? null
        : {
            importsResolved: figure === null ? null : percent(figure),
            filesSkipped: coverage.filesSkipped,
          },
  };
}

export function searchFiles(graph: Graph, query: string) {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { found: false as const, reason: "La recherche est vide." };
  const label = roleLabelOf(graph);
  const hits = graph.files
    .filter((f) => f.path.toLowerCase().includes(needle))
    .map((f) => f.path)
    .sort();
  const result = bounded(hits, LIST_CAP);
  return {
    found: true as const,
    query,
    total: result.total,
    more: result.more,
    files: result.shown.map((path) => ({ path, role: label(path) })),
  };
}

/** A role by its id ("nextjs:page") or its label ("Controllers"), any case. */
function matchRole(text: string): string[] {
  const wanted = text.trim().toLowerCase();
  return [...ROLES.values()]
    .filter((r) => r.id.toLowerCase() === wanted || r.label.toLowerCase() === wanted)
    .map((r) => r.id);
}

export function filesByRole(graph: Graph, role: string) {
  const ids = new Set(matchRole(role));
  const label = roleLabelOf(graph);
  const present = new Map<string, number>();
  const hits: string[] = [];
  for (const r of graph.roles) {
    const l = ROLES.get(r.role)?.label ?? r.role;
    present.set(l, (present.get(l) ?? 0) + 1);
    if (ids.has(r.role)) hits.push(r.path);
  }
  if (hits.length === 0) {
    // Say which roles this analysis does have, so the next question is a real one.
    return {
      found: false as const,
      reason: `Aucun fichier n'a le rôle « ${role} » dans cette analyse.`,
      rolesPresent: [...present].map(([name, files]) => ({ role: name, files })),
    };
  }
  hits.sort();
  const result = bounded(hits, LIST_CAP);
  return {
    found: true as const,
    role,
    total: result.total,
    more: result.more,
    files: result.shown.map((path) => ({ path, role: label(path) })),
  };
}

export function neighbours(graph: Graph, index: Index, path: string) {
  const detail = fileDetail(graph, index, path);
  if (detail === null) return missing(path);
  const label = roleLabelOf(graph);
  const list = (paths: string[]) => {
    const b = bounded(paths, LIST_CAP);
    return {
      total: b.total,
      more: b.more,
      files: b.shown.map((p) => ({ path: p, role: label(p) })),
    };
  };
  return {
    found: true as const,
    path,
    role: label(path),
    lines: detail.lines,
    imports: list(detail.imports),
    importedBy: list(detail.dependents),
  };
}

export function walk(graph: Graph, index: Index, path: string, way: Way, depth?: number) {
  if (fileDetail(graph, index, path) === null) return missing(path);
  const d = Math.min(MAX_DEPTH, Math.max(1, Math.floor(depth ?? DEFAULT_DEPTH)));
  const label = roleLabelOf(graph);
  const reached = reach(index, path, way, d);
  const b = bounded(reached, WALK_CAP);
  return {
    found: true as const,
    start: path,
    direction: way,
    depth: d,
    total: b.total,
    more: b.more,
    files: b.shown.map((r) => ({ path: r.path, distance: r.distance, role: label(r.path) })),
  };
}

export function routes(graph: Graph) {
  // No framework recognised means no route table: absent, not an empty list.
  if (graph.frameworks.length === 0) {
    return { found: false as const, reason: "Aucun framework reconnu : pas de table de routes." };
  }
  const sorted = [...graph.routes].sort((a, b) =>
    a.pattern !== b.pattern
      ? a.pattern < b.pattern
        ? -1
        : 1
      : a.method < b.method
        ? -1
        : a.method > b.method
          ? 1
          : 0,
  );
  const b = bounded(sorted, WALK_CAP);
  return { found: true as const, total: b.total, more: b.more, routes: b.shown };
}

// --- dispatch --------------------------------------------------------------------

export const TOOL_NAMES = [
  "summary",
  "search_files",
  "files_by_role",
  "neighbours",
  "walk",
  "routes",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const isToolName = (name: string): name is ToolName =>
  (TOOL_NAMES as readonly string[]).includes(name);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Runs one tool. The arguments come from a model: anything that is not the
 * expected shape is an answer ("argument manquant"), never an exception, and no
 * argument names an analysis or an organization.
 */
export function runTool(
  name: ToolName,
  rawInput: unknown,
  graph: Graph,
  coverage: StoredCoverage | null,
): unknown {
  const input = isRecord(rawInput) ? rawInput : {};
  const need = (key: string): string | null => {
    const value = input[key];
    return typeof value === "string" ? value : null;
  };
  const lacking = (key: string) => ({
    found: false as const,
    reason: `Argument manquant : ${key}.`,
  });

  switch (name) {
    case "summary":
      return summary(graph, coverage);
    case "search_files": {
      const query = need("query");
      return query === null ? lacking("query") : searchFiles(graph, query);
    }
    case "files_by_role": {
      const role = need("role");
      return role === null ? lacking("role") : filesByRole(graph, role);
    }
    case "neighbours": {
      const path = need("path");
      return path === null ? lacking("path") : neighbours(graph, indexEdges(graph.edges), path);
    }
    case "walk": {
      const path = need("path");
      const direction = need("direction");
      if (path === null) return lacking("path");
      if (direction !== "dependents" && direction !== "dependencies") {
        return {
          found: false as const,
          reason: 'direction doit valoir "dependents" ou "dependencies".',
        };
      }
      const depth = input.depth;
      return walk(
        graph,
        indexEdges(graph.edges),
        path,
        direction,
        typeof depth === "number" ? depth : undefined,
      );
    }
    case "routes":
      return routes(graph);
  }
}
