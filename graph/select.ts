import type { Edge } from "../parser/types.ts";
import type { Fold } from "./fold.ts";
import type { Scene } from "./scene.ts";

// Selecting a node or a file keeps it, its edges and whatever those edges
// connect to at full strength; everything else is dimmed. Pure: it only reads
// the edge list, so it is instant and needs no request.

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "file"; path: string };

/** Relative to what is selected: arriving, leaving, or inside it. */
export type Direction = "in" | "out" | "inside";

export type Lit = {
  files: ReadonlySet<string>;
  nodes: ReadonlySet<string>;
  /** Scene edge id -> direction. An edge absent from here is dimmed. */
  edges: ReadonlyMap<string, Direction>;
};

export function highlight(
  selection: Selection,
  edges: readonly Edge[],
  fold: Fold,
  scene: Scene,
): Lit {
  const selected = new Set<string>(
    selection.kind === "file"
      ? [selection.path]
      : (fold.nodes.find((n) => n.id === selection.id)?.files ?? []),
  );

  const files = new Set<string>(selected);
  const direction = edges.map((e): Direction | null => {
    const from = selected.has(e.from);
    const to = selected.has(e.to);
    if (!from && !to) return null;
    files.add(e.from);
    files.add(e.to);
    return from && to ? "inside" : from ? "out" : "in";
  });

  const nodes = new Set<string>();
  for (const path of files) {
    const node = fold.nodeOf.get(path);
    if (node !== undefined) nodes.add(node);
  }

  // A drawn line can stand for several edges; it is lit if any of them is,
  // and takes the direction of the first one that is.
  const litEdges = new Map<string, Direction>();
  for (const edge of scene.edges) {
    for (const index of edge.members) {
      const d = direction[index];
      if (d !== null) {
        litEdges.set(edge.id, d);
        break;
      }
    }
  }

  return { files, nodes, edges: litEdges };
}
