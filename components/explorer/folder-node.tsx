"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { SceneNode } from "@/graph/scene";
import { HEADER, MORE_HANDLE, NODE_HANDLE, ROW, rowHandle } from "@/graph/scene";

// One folder on the canvas, in one of two shapes. Closed it is a single box;
// open it is a panel: a header carrying the folder's name and counts, and the
// files as rows inside. It is always one object on the canvas, never loose
// nodes. Colour appears only where it means something: green and amber for
// direction, a swatch for the kind of file.

export type FolderData = {
  node: SceneNode;
  /** Whole node dimmed because something else is selected. */
  dim: boolean;
  /** Files at full strength while something is selected; null = no selection. */
  litFiles: ReadonlySet<string> | null;
  selected: boolean;
  selectedPath: string | null;
  /** A path the pointer is over, here or in the detail pane. */
  hoverPath: string | null;
  /** The node that path (or the hovered node) belongs to. */
  hoverNode: string | null;
  onHoverPath: (path: string | null) => void;
  onHoverNode: (id: string | null) => void;
  onToggle: (id: string) => void;
  onSelectFile: (path: string) => void;
};

export type FolderFlowNode = Node<FolderData, "folder">;

const handleStyle = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0 };

export function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  const { node } = data;
  // The node is outlined for a hover only when no row on screen can show it:
  // a closed folder, or a file that sits under "et N de plus".
  const hovered =
    data.hoverNode === node.id &&
    (!node.open || !node.rows.some((r) => r.path === data.hoverPath));
  const ring = data.selected
    ? "border-accent"
    : hovered
      ? "border-foreground"
      : "border-border";
  const opacity = data.dim ? 0.2 : 1;

  if (!node.open) {
    return (
      <button
        type="button"
        onClick={() => data.onToggle(node.id)}
        onMouseEnter={() => data.onHoverNode(node.id)}
        onMouseLeave={() => data.onHoverNode(null)}
        title={`Ouvrir ${node.id === "." ? node.label : node.id}`}
        className={`flex h-full w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded border bg-surface px-2 text-center ${ring}`}
        style={{ opacity }}
      >
        <span className="max-w-full truncate font-mono text-[11px] font-semibold">
          {node.label}
        </span>
        <span className="text-[10px] text-muted">{node.caption}</span>
        <Handle id={`${NODE_HANDLE}-in`} type="target" position={Position.Left} style={handleStyle} />
        <Handle id={`${NODE_HANDLE}-out`} type="source" position={Position.Right} style={handleStyle} />
      </button>
    );
  }

  return (
    <div
      className={`h-full w-full overflow-hidden rounded border bg-background ${ring}`}
      style={{ opacity }}
    >
      <button
        type="button"
        onClick={() => data.onToggle(node.id)}
        onMouseEnter={() => data.onHoverNode(node.id)}
        onMouseLeave={() => data.onHoverNode(null)}
        title="Refermer"
        className="flex w-full cursor-pointer flex-col items-start justify-center gap-0.5 border-b border-border bg-surface px-2 text-left"
        style={{ height: HEADER }}
      >
        <span className="max-w-full truncate font-mono text-[11px] font-semibold">
          {node.label}
        </span>
        <span className="text-[10px] text-muted">
          {node.files} fichiers ·{" "}
          <span className="text-incoming">{node.fanIn} entrants</span> ·{" "}
          <span className="text-outgoing">{node.fanOut} sortants</span>
        </span>
      </button>

      {node.rows.map((row) => {
        const lit = data.litFiles === null || data.litFiles.has(row.path);
        const picked = data.selectedPath === row.path;
        const hot = data.hoverPath === row.path;
        return (
          <button
            key={row.path}
            type="button"
            onClick={() => data.onSelectFile(row.path)}
            onMouseEnter={() => data.onHoverPath(row.path)}
            onMouseLeave={() => data.onHoverPath(null)}
            title={row.path}
            className={`flex w-full cursor-pointer items-center gap-1.5 px-2 text-left ${picked ? "bg-accent/15" : hot ? "bg-foreground/10" : ""}`}
            style={{ height: ROW, opacity: lit ? 1 : 0.25 }}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: `var(--kind-${row.kind})` }}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{row.label}</span>
            <span className="shrink-0 text-[10px] text-muted">{row.fanIn}</span>
          </button>
        );
      })}

      {node.hidden > 0 && (
        <div
          className="flex items-center px-2 text-[10px] text-muted"
          style={{ height: ROW }}
        >
          et {node.hidden} de plus
        </div>
      )}

      {/* One pair of handles per row so an edge lands on the file it is about,
          and one for the "+N" line that stands for the files not shown. */}
      {node.rows.map((row, i) => (
        <RowHandles key={row.path} handle={rowHandle(i)} top={HEADER + i * ROW + ROW / 2} />
      ))}
      {node.hidden > 0 && (
        <RowHandles handle={MORE_HANDLE} top={HEADER + node.rows.length * ROW + ROW / 2} />
      )}
    </div>
  );
}

function RowHandles({ handle, top }: { handle: string; top: number }) {
  return (
    <>
      <Handle id={`${handle}-in`} type="target" position={Position.Left} style={{ ...handleStyle, top }} />
      <Handle id={`${handle}-out`} type="source" position={Position.Right} style={{ ...handleStyle, top }} />
    </>
  );
}
