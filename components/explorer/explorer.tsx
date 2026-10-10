"use client";

import "@xyflow/react/dist/style.css";
import {
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge as FlowEdge,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fold as foldFiles, type Fold } from "@/graph/fold";
import { kindOf, type KindId } from "@/graph/kinds";
import { layout } from "@/graph/layout";
import { buildScene, type Source } from "@/graph/scene";
import { highlight, type Direction, type Selection } from "@/graph/select";
import type { StoredCoverage } from "@/graph/coverage";
import type { Graph } from "@/graph/types";
import { DetailPane, type Hover } from "./detail-pane";
import { FolderNode, type FolderFlowNode } from "./folder-node";
import { CoverageBanner } from "./coverage-banner";
import { Rail } from "./rail";

// The shell the explorer lives in, settled here: a narrow rail on the left, the
// map filling the middle, a detail pane on the right. Later phases fill these;
// they do not move them. The pane is a plain column, not a drawer or a modal.

const nodeTypes = { folder: FolderNode };

const MIN_ZOOM = 0.1;
const FIT_PADDING = 0.12;

// Greyscale until something is selected; then direction is the only colour.
const STROKE: Record<Direction | "idle", { stroke: string; arrow: string; width: number }> = {
  idle: { stroke: "var(--muted)", arrow: "#8a8a93", width: 1 },
  in: { stroke: "var(--incoming)", arrow: "#16a34a", width: 1.6 },
  out: { stroke: "var(--outgoing)", arrow: "#d97706", width: 1.6 },
  inside: { stroke: "var(--accent)", arrow: "#2563eb", width: 1.6 },
};

export function Explorer({
  data,
  coverage,
  commit,
  action,
}: {
  data: Graph;
  coverage?: StoredCoverage;
  commit?: string;
  /** Rendered in the coverage banner, beside its own controls. */
  action?: ReactNode;
}) {
  const fold = useMemo(() => foldFiles(data.files), [data.files]);
  // Held here, above the map and the pane, so both read and write the same
  // selection, the same open folders and the same hover.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [category, setCategory] = useState<KindId | null>(null);
  const [hover, setHover] = useState<Hover>({ path: null, node: null });

  const onToggle = useCallback(
    (id: string) => {
      // Opening also selects the node, so every node can be selected by the
      // one click that opens it.
      if (!expanded.has(id)) setSelection({ kind: "node", id });
      setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    [expanded],
  );
  const onSelectFile = useCallback(
    (path: string) => setSelection({ kind: "file", path }),
    [],
  );
  // A path clicked in the pane: select it, and open the folder holding it so
  // its row is there on the map to be seen.
  const onSelectFromPane = useCallback(
    (path: string) => {
      setSelection({ kind: "file", path });
      const node = fold.nodeOf.get(path);
      if (node === undefined) return;
      setExpanded((prev) => (prev.has(node) ? prev : new Set(prev).add(node)));
    },
    [fold],
  );
  const onHoverPath = useCallback(
    (path: string | null) => setHover({ path, node: null }),
    [],
  );
  const onHoverNode = useCallback(
    (node: string | null) => setHover({ path: null, node }),
    [],
  );

  return (
    // The app bar above is h-9 and <main> pads by 3 (0.75rem): cancel the
    // padding and fill what is left of the viewport.
    <div className="-m-3 flex" style={{ height: "calc(100vh - 2.25rem)" }}>
      <Rail paths={data.files.map((f) => f.path)} active={category} onPick={setCategory} />
      <div className="flex min-w-0 flex-1 flex-col">
        {coverage !== undefined && <CoverageBanner coverage={coverage} commit={commit} action={action} />}
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <ReactFlowProvider>
              <Canvas
                data={data}
                fold={fold}
                expanded={expanded}
                selection={selection}
                hover={hover}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
                onClear={() => setSelection(null)}
                onHoverPath={onHoverPath}
                onHoverNode={onHoverNode}
                category={category}
              />
            </ReactFlowProvider>
          </div>
        </div>
      </div>
      <DetailPane
        data={data}
        fold={fold}
        selection={selection}
        hover={hover}
        onSelectFile={onSelectFromPane}
        onHover={onHoverPath}
      />
    </div>
  );
}

type CanvasProps = {
  data: Graph;
  fold: Fold;
  expanded: ReadonlySet<string>;
  selection: Selection | null;
  hover: Hover;
  category: KindId | null;
  onToggle: (id: string) => void;
  onSelectFile: (path: string) => void;
  onClear: () => void;
  onHoverPath: (path: string | null) => void;
  onHoverNode: (id: string | null) => void;
};

function Canvas({
  data,
  fold,
  expanded,
  selection,
  hover,
  category,
  onToggle,
  onSelectFile,
  onClear,
  onHoverPath,
  onHoverNode,
}: CanvasProps) {
  const flow = useReactFlow();
  // The node holding a hovered path, so a neighbour that has no row on screen
  // (its folder is closed, or it is under "+N") still lights up as its node.
  const hoverNode = hover.node ?? (hover.path === null ? null : (fold.nodeOf.get(hover.path) ?? null));
  // How many files of each node are in the picked category. Counted over every
  // file of the node, so the numbers on the map add up to the rail's count.
  const matches = useMemo(() => {
    const counts = new Map<string, number>();
    if (category === null) return counts;
    for (const n of fold.nodes) {
      counts.set(n.id, n.files.filter((p) => kindOf(p) === category).length);
    }
    return counts;
  }, [fold, category]);

  const source = useMemo<Source>(
    () => ({ root: data.root, files: data.files, edges: data.edges }),
    [data],
  );
  const scene = useMemo(() => buildScene(source, fold, expanded), [source, fold, expanded]);
  // Positions depend on the structure only, so selecting never moves anything.
  const placed = useMemo(() => layout(scene), [scene]);
  const lit = useMemo(
    () => (selection === null ? null : highlight(selection, data.edges, fold, scene)),
    [selection, data.edges, fold, scene],
  );

  const nodes = useMemo<FolderFlowNode[]>(
    () =>
      scene.nodes.map((node) => {
        const at = placed.get(node.id) ?? { x: 0, y: 0 };
        return {
          id: node.id,
          type: "folder",
          position: at,
          width: node.width,
          height: node.height,
          draggable: false,
          selectable: false,
          // React Flow turns pointer events off on a node that is neither
          // draggable nor selectable, which would leave the buttons inside it
          // dead. Selection is ours, so switch them back on explicitly.
          style: { pointerEvents: "all" },
          data: {
            node,
            dim: lit !== null && !lit.nodes.has(node.id),
            litFiles: lit === null ? null : lit.files,
            selected: selection?.kind === "node" && selection.id === node.id,
            selectedPath: selection?.kind === "file" ? selection.path : null,
            hoverPath: hover.path,
            hoverNode,
            category,
            matches: matches.get(node.id) ?? 0,
            onHoverPath,
            onHoverNode,
            onToggle,
            onSelectFile,
          },
        };
      }),
    [scene.nodes, placed, lit, selection, hover.path, hoverNode, category, matches, onHoverPath, onHoverNode, onToggle, onSelectFile],
  );

  const edges = useMemo<FlowEdge[]>(
    () =>
      scene.edges.map((e) => {
        const direction = lit === null ? "idle" : (lit.edges.get(e.id) ?? null);
        // With a category picked and nothing selected, a line fades unless one
        // of the imports it stands for touches a file of that category.
        const faded =
          category !== null &&
          lit === null &&
          !e.members.some((i) => kindOf(data.edges[i].from) === category || kindOf(data.edges[i].to) === category);
        const look = STROKE[direction ?? "idle"];
        return {
          id: e.id,
          source: e.source.node,
          sourceHandle: `${e.source.handle}-out`,
          target: e.target.node,
          targetHandle: `${e.target.handle}-in`,
          selectable: false,
          zIndex: direction !== null && direction !== "idle" ? 1 : 0,
          style: {
            stroke: look.stroke,
            strokeWidth: look.width,
            opacity: faded || direction === null ? 0.1 : direction === "idle" ? 0.55 : 1,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: look.arrow, width: 14, height: 14 },
        };
      }),
    [scene.edges, lit, category, data.edges],
  );

  // Opening or closing a folder refits the view, and only ever zooms out: the
  // limit is the zoom the person already has. This runs after the new nodes
  // are in the store (it is a child effect's parent), so it fits the state
  // after the change, not the one before.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return; // the first fit is the fitView prop's job
    }
    const frame = requestAnimationFrame(() => {
      void flow.fitView({
        maxZoom: flow.getZoom(),
        minZoom: MIN_ZOOM,
        padding: FIT_PADDING,
        duration: 0,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1, minZoom: MIN_ZOOM }}
      minZoom={MIN_ZOOM}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnDoubleClick={false}
      onPaneClick={onClear}
    />
  );
}
