import type { ParseResult } from "../parser/types.ts";
import type { Graph } from "./types.ts";
import type { Fold } from "./fold.ts";
import { KINDS, kindOf, type KindId } from "./kinds.ts";

// What the detail pane shows, derived from the parser's output and the fold.
// Pure functions over the file list and the edge list: nothing here reads a
// network or a store, which is why selecting costs no request.

/** Each ranked list in the summary is cut here; the rest is counted. */
export const LIST_LIMIT = 10;

export type Ranked = { path: string; count: number };

export type Summary = {
  name: string;
  /** The adapter that handled the repository; "aucun" is the fallback. */
  framework: string;
  files: number;
  imports: number;
  /** null until an adapter can recover routes exactly: absent, not zero. */
  routes: number | null;
  /** Most depended-on first, shown up to LIST_LIMIT. */
  leaned: Ranked[];
  /** Files nothing imports, most-importing first, shown up to LIST_LIMIT. */
  unimported: Ranked[];
  unimportedTotal: number;
  /** Files no framework convention gave a role to. */
  unidentified: number;
};

export type FileDetail = {
  path: string;
  kind: KindId;
  lines: number;
  imports: string[];
  dependents: string[];
};

export type NodeDetail = {
  id: string;
  files: number;
  kinds: { id: KindId; label: string; count: number }[];
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
    framework: data.adapter,
    files: data.files.length,
    imports: data.edges.length,
    routes: null,
    leaned: leaned.slice(0, LIST_LIMIT),
    unimported: unimported.slice(0, LIST_LIMIT),
    unimportedTotal: unimported.length,
    // Only the fallback adapter exists, and it gives no file a role.
    unidentified: data.files.length,
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
    kind: kindOf(path),
    lines: file.lines,
    imports: index.imports.get(path) ?? [],
    dependents: index.dependents.get(path) ?? [],
  };
}

export function nodeDetail(fold: Fold, id: string): NodeDetail | null {
  const node = fold.nodes.find((n) => n.id === id);
  if (node === undefined) return null;
  const counts = new Map<KindId, number>();
  for (const path of node.files) {
    const kind = kindOf(path);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return {
    id,
    files: node.files.length,
    kinds: KINDS.filter((k) => counts.has(k.id)).map((k) => ({
      id: k.id,
      label: k.label,
      count: counts.get(k.id) ?? 0,
    })),
  };
}
