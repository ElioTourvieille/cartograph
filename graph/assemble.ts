import { computeFan } from "../parser/metrics.ts";
import type { EdgeKind, FileRole, Route } from "../parser/types.ts";
import type { Graph } from "./types.ts";

// Stored rows to the Graph every calculation reads. The explorer in the browser
// and the agent's tool surface on the server both come through here, so the
// agent is answering from the same graph the canvas draws, not from a second
// reading of the rows.

const ORDER: EdgeKind[] = ["import", "reexport", "dynamic", "require"];

export type StoredRows = {
  repo: string | null;
  frameworks: string[];
  files: { path: string; folder: string; lines: number; hash: string }[];
  edges: { from: string; to: string; kind: EdgeKind }[];
  roles: FileRole[];
  routes: Route[];
};

export function assembleGraph(rows: StoredRows): Graph {
  // Rows hold one edge per kind; the graph wants one per pair.
  const byPair = new Map<string, { from: string; to: string; kinds: Set<EdgeKind> }>();
  for (const e of rows.edges) {
    const key = `${e.from}\0${e.to}`;
    const pair = byPair.get(key) ?? { from: e.from, to: e.to, kinds: new Set<EdgeKind>() };
    pair.kinds.add(e.kind);
    byPair.set(key, pair);
  }
  const pairs = [...byPair.values()].map((p) => ({
    from: p.from,
    to: p.to,
    kinds: ORDER.filter((k) => p.kinds.has(k)),
  }));
  const fan = computeFan(
    rows.files.map((f) => f.path),
    pairs,
  );
  return {
    root: rows.repo?.split("/").pop() ?? "dépôt",
    frameworks: rows.frameworks,
    roles: rows.roles,
    routes: rows.routes,
    files: rows.files.map((f) => ({
      path: f.path,
      folder: f.folder,
      lines: f.lines,
      hash: f.hash,
      fanIn: fan.get(f.path)?.fanIn ?? 0,
      fanOut: fan.get(f.path)?.fanOut ?? 0,
    })),
    edges: pairs,
  };
}
