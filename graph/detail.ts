import type { ParseResult } from "../parser/types.ts";
import type { Graph } from "./types.ts";
import type { Fold } from "./fold.ts";
import type { Categories } from "./categories.ts";
import { FRAMEWORKS } from "./taxonomy.ts";

// What the detail pane shows, derived from the parser's output and the fold.
// Pure functions over the file list and the edge list: nothing here reads a
// network or a store, which is why selecting costs no request.

/** Each ranked list in the summary is cut here; the rest is counted. */
export const LIST_LIMIT = 10;

export type Ranked = { path: string; count: number };

export type Summary = {
  name: string;
  /** Names of the frameworks found, in detection order; empty when none. */
  frameworks: string[];
  files: number;
  imports: number;
  /** null when no framework was found: absent, not zero. */
  routes: number | null;
  /** Most depended-on first, shown up to LIST_LIMIT. */
  leaned: Ranked[];
  /** Files nothing imports, most-importing first, shown up to LIST_LIMIT. */
  unimported: Ranked[];
  unimportedTotal: number;
  /** Files no framework convention gave a role to. */
  unidentified: number;
  /** The routes whose method and full pattern are written in the code. */
  routeList: Graph["routes"];
};

export type FileDetail = {
  path: string;
  lines: number;
  imports: string[];
  dependents: string[];
};

export type NodeDetail = {
  id: string;
  files: number;
  /** What kind of file is inside, in rail order, with how many of each. */
  categories: { id: string; label: string; swatch: string; count: number }[];
};

export type Index = {
  imports: ReadonlyMap<string, string[]>;
  dependents: ReadonlyMap<string, string[]>;
};

/** Neighbour lists per file, built once from the edge list. */
export function indexEdges(edges: ParseResult["edges"]): Index {
  const imports = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
  };
  for (const e of edges) {
    push(imports, e.from, e.to);
    push(dependents, e.to, e.from);
  }
  for (const list of [...imports.values(), ...dependents.values()]) list.sort();
  return { imports, dependents };
}

const byCountThenPath = (a: Ranked, b: Ranked): number =>
  b.count - a.count || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function summarize(data: Graph): Summary {
  const leaned = data.files
    .filter((f) => f.fanIn > 0)
    .map((f) => ({ path: f.path, count: f.fanIn }))
    .sort(byCountThenPath);
  const unimported = data.files
    .filter((f) => f.fanIn === 0)
    .map((f) => ({ path: f.path, count: f.fanOut }))
    .sort(byCountThenPath);

  return {
    name: data.root,
    frameworks: data.frameworks.map((id) => FRAMEWORKS[id]?.label ?? id),
    files: data.files.length,
    imports: data.edges.length,
    routes: data.frameworks.length === 0 ? null : data.routes.length,
    leaned: leaned.slice(0, LIST_LIMIT),
    unimported: unimported.slice(0, LIST_LIMIT),
    unimportedTotal: unimported.length,
    // With no framework found nothing could be identified; with one, what is
    // left is every file that has no role.
    unidentified:
      data.frameworks.length === 0 ? data.files.length : data.files.length - data.roles.length,
    routeList: data.routes,
  };
}

export function fileDetail(
  data: Graph,
  index: Index,
  path: string,
): FileDetail | null {
  const file = data.files.find((f) => f.path === path);
  if (file === undefined) return null;
  return {
    path,
    lines: file.lines,
    imports: index.imports.get(path) ?? [],
    dependents: index.dependents.get(path) ?? [],
  };
}

export function nodeDetail(
  fold: Fold,
  id: string,
  categories: Categories,
): NodeDetail | null {
  const node = fold.nodes.find((n) => n.id === id);
  if (node === undefined) return null;
  const counts = new Map<string, number>();
  for (const path of node.files) {
    const category = categories.of(path);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return {
    id,
    files: node.files.length,
    categories: categories.list
      .filter((c) => counts.has(c.id))
      .map((c) => ({ id: c.id, label: c.label, swatch: c.swatch, count: counts.get(c.id) ?? 0 })),
  };
}
