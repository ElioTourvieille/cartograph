import dagre from "@dagrejs/dagre";
import type { Scene } from "./scene.ts";

// Where each node goes. Deterministic: nodes and edges are fed to dagre in a
// fixed order, so the same data gives the same picture every time.

export type Placed = { x: number; y: number };

export function layout(scene: Scene): Map<string, Placed> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 90, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodes = [...scene.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });

  // One layout edge per pair of nodes, however many lines connect them.
  const pairs = new Set<string>();
  for (const e of scene.edges) {
    if (e.source.node !== e.target.node) {
      pairs.add(`${e.source.node}\u0000${e.target.node}`);
    }
  }
  for (const pair of [...pairs].sort()) {
    const [a, b] = pair.split("\u0000");
    g.setEdge(a, b);
  }

  dagre.layout(g);

  // dagre reports centres; React Flow wants the top-left corner.
  const placed = new Map<string, Placed>();
  for (const n of nodes) {
    const p = g.node(n.id);
    placed.set(n.id, { x: p.x - n.width / 2, y: p.y - n.height / 2 });
  }
  return placed;
}
