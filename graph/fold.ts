import type { FileNode } from "../parser/types.ts";

// Folding: how a repository's directories become the nodes of the map.
//
// Every directory starts as its own node. Working from the deepest directory
// upward, any directory holding fewer than `threshold` files merges into its
// parent. If more nodes than anyone can read are left, the threshold goes up
// and the whole thing is computed again from scratch. The repository's own
// shape decides the depth; nothing is picked in advance.

/** "Roughly two dozen": the most nodes a map can have and still be readable. */
export const MAX_NODES = 24;

/** Below this many files a directory is not worth a node of its own. */
export const MIN_THRESHOLD = 2;

export type FoldedNode = {
  /** The directory this node stands for, posix, "." for the root. */
  id: string;
  /** Every file the node holds, sorted. */
  files: string[];
};

export type Fold = {
  threshold: number;
  nodes: FoldedNode[];
  /** file path -> id of the node holding it. */
  nodeOf: ReadonlyMap<string, string>;
};

const ROOT = ".";

const depthOf = (dir: string): number =>
  dir === ROOT ? 0 : dir.split("/").length;

const parentOf = (dir: string): string => {
  const slash = dir.lastIndexOf("/");
  return slash === -1 ? ROOT : dir.slice(0, slash);
};

export function fold(files: readonly Pick<FileNode, "path" | "folder">[]): Fold {
  const deepest = Math.max(0, ...files.map((f) => depthOf(f.folder)));

  let result = foldAt(files, deepest, MIN_THRESHOLD);
  // Past `files.length` everything has merged into the root, so the loop ends.
  for (
    let threshold = MIN_THRESHOLD + 1;
    result.nodes.length > MAX_NODES && threshold <= files.length + 1;
    threshold++
  ) {
    result = foldAt(files, deepest, threshold);
  }
  return result;
}

function foldAt(
  files: readonly Pick<FileNode, "path" | "folder">[],
  deepest: number,
  threshold: number,
): Fold {
  // Where each file currently sits. Starts at its own directory.
  const holder = new Map<string, string>(files.map((f) => [f.path, f.folder]));

  for (let depth = deepest; depth >= 1; depth--) {
    // Counted before this depth merges anything, so a merge at one directory
    // never changes what another directory at the same depth sees.
    const count = new Map<string, number>();
    for (const dir of holder.values()) count.set(dir, (count.get(dir) ?? 0) + 1);

    const merging = new Set<string>();
    for (const [dir, n] of count) {
      if (depthOf(dir) === depth && n < threshold) merging.add(dir);
    }
    if (merging.size === 0) continue;
    for (const [path, dir] of holder) {
      if (merging.has(dir)) holder.set(path, parentOf(dir));
    }
  }

  const byNode = new Map<string, string[]>();
  for (const [path, dir] of holder) {
    const list = byNode.get(dir);
    if (list === undefined) byNode.set(dir, [path]);
    else list.push(path);
  }
  const nodes = [...byNode.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, paths]) => ({ id, files: paths.sort() }));

  return { threshold, nodes, nodeOf: holder };
}
