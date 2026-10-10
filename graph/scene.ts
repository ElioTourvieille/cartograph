import type { Edge, FileNode } from "../parser/types.ts";
import type { Fold } from "./fold.ts";

// Everything the canvas draws, derived from the parser's output and the fold.
// The parser's shape is left alone: nothing here reshapes it, it is read.
//
// Pure functions over a file list and an edge list. No React, no layout
// library, nothing to mock.

/** Panels list at most this many files; the rest are counted, not drawn. */
export const MAX_ROWS = 12;

/** Where an edge lands on a node: the node itself, a file row, or "+N". */
export type Endpoint = { node: string; handle: string };

export const NODE_HANDLE = "node";
export const MORE_HANDLE = "more";
export const rowHandle = (index: number): string => `row-${index}`;

export type SceneRow = {
  path: string;
  /** Shortest tail of the path that is unique among the rows shown. */
  label: string;
  /** The id of the category the file is in (its role, or its kind). */
  category: string;
  fanIn: number;
  fanOut: number;
};

export type SceneNode = {
  id: string;
  label: string;
  files: number;
  /** The small line under the name, sized for here so the box always fits it. */
  caption: string;
  /** Edges arriving from files outside this node. */
  fanIn: number;
  /** Edges leaving to files outside this node. */
  fanOut: number;
  open: boolean;
  /** Only when open: the files shown, most depended-on first. */
  rows: SceneRow[];
  /** Only when open: files that did not fit in the panel. */
  hidden: number;
  width: number;
  height: number;
};

export type SceneEdge = {
  id: string;
  source: Endpoint;
  target: Endpoint;
  /** Indexes into the parser's edge list: the edges this one line stands for. */
  members: number[];
};

export type Scene = { nodes: SceneNode[]; edges: SceneEdge[] };

// --- sizes ------------------------------------------------------------------

const CHAR = 6.6; // monospace, 11px
const PAD = 24;
const MIN_WIDTH = 72;
const NODE_BASE_HEIGHT = 30;
const NODE_MAX_EXTRA = 70;
/** Panel geometry, shared with the component so edge handles line up with rows. */
export const HEADER = 40;
export const ROW = 20;

const SMALL_CHAR = 5.8; // proportional, 10px
const textWidth = (text: string): number => Math.ceil(text.length * CHAR) + PAD;
const captionWidth = (text: string): number =>
  Math.ceil(text.length * SMALL_CHAR) + PAD;

// Height carries how many things depend on the node, so the busiest folder is
// the tallest. A square root keeps one hub from flattening everything else.
const heightFor = (fanIn: number): number =>
  Math.round(NODE_BASE_HEIGHT + Math.min(NODE_MAX_EXTRA, 7 * Math.sqrt(fanIn)));

// --- labels -----------------------------------------------------------------

/**
 * The shortest tail of each path that is still unique among the whole list:
 * "tests", "v4/tests" and so on, never a name that two things share.
 */
export function shortestUnique(paths: readonly string[]): string[] {
  const parts = paths.map((p) => p.split("/"));
  const depth = parts.map(() => 1);
  const tail = (i: number): string => parts[i].slice(-depth[i]).join("/");

  for (;;) {
    const seen = new Map<string, number[]>();
    parts.forEach((_, i) => {
      const key = tail(i);
      const group = seen.get(key);
      if (group === undefined) seen.set(key, [i]);
      else group.push(i);
    });
    let grew = false;
    for (const group of seen.values()) {
      if (group.length < 2) continue;
      for (const i of group) {
        if (depth[i] < parts[i].length) {
          depth[i]++;
          grew = true;
        }
      }
    }
    if (!grew) return parts.map((_, i) => tail(i));
  }
}

// --- scene ------------------------------------------------------------------

export type Source = {
  root: string;
  files: readonly FileNode[];
  edges: readonly Edge[];
};

export function buildScene(
  source: Source,
  fold: Fold,
  expanded: ReadonlySet<string>,
  categoryOf: (path: string) => string,
): Scene {
  const file = new Map(source.files.map((f) => [f.path, f]));

  // Node-level fan-in and fan-out: edges that cross the node's boundary.
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const e of source.edges) {
    const from = fold.nodeOf.get(e.from);
    const to = fold.nodeOf.get(e.to);
    if (from === undefined || to === undefined || from === to) continue;
    fanOut.set(from, (fanOut.get(from) ?? 0) + 1);
    fanIn.set(to, (fanIn.get(to) ?? 0) + 1);
  }

  const labels = shortestUnique(
    fold.nodes.map((n) => (n.id === "." ? source.root : n.id)),
  );

  // Which row, if any, each file of an open node is drawn as.
  const rowOf = new Map<string, Endpoint>();

  const nodes: SceneNode[] = fold.nodes.map((n, i) => {
    const open = expanded.has(n.id);
    const nodeIn = fanIn.get(n.id) ?? 0;
    const nodeOut = fanOut.get(n.id) ?? 0;
    const base = {
      id: n.id,
      label: labels[i],
      files: n.files.length,
      caption: open
        ? `${n.files.length} fichiers · ${nodeIn} entrants · ${nodeOut} sortants`
        : `${n.files.length} fichiers · ${nodeIn} entrants`,
      fanIn: nodeIn,
      fanOut: nodeOut,
      open,
    };
    if (!open) {
      return {
        ...base,
        rows: [],
        hidden: 0,
        width: Math.max(MIN_WIDTH, textWidth(labels[i]), captionWidth(base.caption)),
        height: heightFor(base.fanIn),
      };
    }

    const ranked = n.files
      .map((p) => file.get(p))
      .filter((f): f is FileNode => f !== undefined)
      .sort((a, b) => b.fanIn - a.fanIn || (a.path < b.path ? -1 : 1));
    const shown = ranked.slice(0, MAX_ROWS);
    const rowLabels = shortestUnique(shown.map((f) => f.path));
    const rows = shown.map((f, r) => {
      rowOf.set(f.path, { node: n.id, handle: rowHandle(r) });
      return {
        path: f.path,
        label: rowLabels[r],
        category: categoryOf(f.path),
        fanIn: f.fanIn,
        fanOut: f.fanOut,
      };
    });
    const hidden = ranked.length - shown.length;
    const widest = Math.max(
      MIN_WIDTH,
      textWidth(labels[i]),
      captionWidth(base.caption),
      ...rows.map((r) => textWidth(r.label) + 40),
    );
    return {
      ...base,
      rows,
      hidden,
      width: widest,
      height: HEADER + rows.length * ROW + (hidden > 0 ? ROW : 0),
    };
  });

  // Where a file's edges end: its own row if it has one, otherwise the panel's
  // "+N" row when the node is open, otherwise the node itself.
  const endpointOf = (path: string): Endpoint | undefined => {
    const row = rowOf.get(path);
    if (row !== undefined) return row;
    const node = fold.nodeOf.get(path);
    if (node === undefined) return undefined;
    return {
      node,
      handle: expanded.has(node) ? MORE_HANDLE : NODE_HANDLE,
    };
  };

  const merged = new Map<string, SceneEdge>();
  source.edges.forEach((e, index) => {
    const a = endpointOf(e.from);
    const b = endpointOf(e.to);
    if (a === undefined || b === undefined) return;
    // Two files folded into the same closed node: nothing to draw.
    if (a.node === b.node && a.handle === b.handle) return;
    const id = `${a.node}#${a.handle}>${b.node}#${b.handle}`;
    const existing = merged.get(id);
    if (existing === undefined) {
      merged.set(id, { id, source: a, target: b, members: [index] });
    } else {
      existing.members.push(index);
    }
  });
  const edges = [...merged.values()].sort((x, y) => (x.id < y.id ? -1 : 1));

  return { nodes, edges };
}
