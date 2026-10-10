import type { Graph } from "./types.ts";

// Insights: four kinds of fact about the edge list and the file list. No model
// is involved, not to find one and not to word one: each kind has one fixed
// sentence. They state what is there; they never rate it.

/** A file is "imported by an unusual number" from this many importers up... */
export const HUB_MIN_FAN_IN = 10;
/** ...and only if it is also in this top share of the repository. */
export const HUB_TOP_SHARE = 0.02;
/** From this many lines a file is "simply too long". */
export const LONG_LINES = 500;

export const SENTENCE = {
  unimported: "Aucun fichier du dépôt n'importe celui-ci.",
  hub: "Un nombre inhabituel de fichiers importent celui-ci.",
  cycle: "Ces fichiers s'importent les uns les autres en boucle.",
  long: "Ce fichier est très long.",
} as const;

export type Item = { path: string; value: number };

export type Cycle = {
  /** One real cycle, in import order; the last file imports the first. */
  files: string[];
  /** How many files are tied together by cycles in this group. */
  size: number;
};

export type Insights = {
  unimported: Item[];
  hubs: Item[];
  cycles: Cycle[];
  long: Item[];
};

const byValueThenPath = (a: Item, b: Item): number =>
  b.value - a.value || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * `isReachedByFramework` comes from the adapter. Pages, routes, layouts,
 * middleware and config are reached by the framework, not by an import, so a
 * file the adapter says is one is never reported as unimported: the import
 * graph's blind spot is not a finding about the code.
 */
export function insights(
  data: Graph,
  isReachedByFramework: (path: string) => boolean,
): Insights {
  const unimported = data.files
    .filter((f) => f.fanIn === 0 && !isReachedByFramework(f.path))
    .map((f) => ({ path: f.path, value: f.fanOut }))
    .sort(byValueThenPath);

  const fanIns = data.files.map((f) => f.fanIn).sort((a, b) => b - a);
  const top = Math.max(1, Math.ceil(fanIns.length * HUB_TOP_SHARE));
  const hubFloor = Math.max(HUB_MIN_FAN_IN, fanIns[top - 1] ?? 0);
  const hubs = data.files
    .filter((f) => f.fanIn >= hubFloor)
    .map((f) => ({ path: f.path, value: f.fanIn }))
    .sort(byValueThenPath);

  const long = data.files
    .filter((f) => f.lines >= LONG_LINES)
    .map((f) => ({ path: f.path, value: f.lines }))
    .sort(byValueThenPath);

  return { unimported, hubs, cycles: findCycles(data), long };
}

// --- cycles -----------------------------------------------------------------

function findCycles(data: Graph): Cycle[] {
  const next = new Map<string, string[]>();
  for (const e of data.edges) {
    const list = next.get(e.from);
    if (list === undefined) next.set(e.from, [e.to]);
    else list.push(e.to);
  }

  const cycles: Cycle[] = [];
  for (const group of stronglyConnected(data.files.map((f) => f.path), next)) {
    const start = group.reduce((a, b) => (b < a ? b : a));
    const files = shortestCycleThrough(start, new Set(group), next);
    if (files !== null) cycles.push({ files, size: group.length });
  }
  return cycles.sort(
    (a, b) => b.size - a.size || (a.files[0] < b.files[0] ? -1 : 1),
  );
}

// Tarjan's algorithm with an explicit stack: recursion would overflow on a
// long import chain in a real repository.
function stronglyConnected(
  nodes: readonly string[],
  next: ReadonlyMap<string, string[]>,
): string[][] {
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  let counter = 0;

  const enter = (node: string): void => {
    order.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
  };

  for (const root of nodes) {
    if (order.has(root)) continue;
    enter(root);
    const work = [{ node: root, at: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const successors = next.get(frame.node) ?? [];

      if (frame.at < successors.length) {
        const to = successors[frame.at++];
        if (!order.has(to)) {
          enter(to);
          work.push({ node: to, at: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, order.get(to)!));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent !== undefined) {
        low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === order.get(frame.node)) {
        const group: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          group.push(member);
        } while (member !== frame.node);
        // A lone file is only a cycle if it imports itself.
        if (group.length > 1 || (next.get(group[0]) ?? []).includes(group[0])) {
          groups.push(group);
        }
      }
    }
  }
  return groups;
}

// The shortest way from `start` back to itself inside its group, so there is a
// concrete cycle to walk by hand rather than only a set of files.
function shortestCycleThrough(
  start: string,
  group: ReadonlySet<string>,
  next: ReadonlyMap<string, string[]>,
): string[] | null {
  const parent = new Map<string, string>();
  let frontier = [start];
  while (frontier.length > 0) {
    const following: string[] = [];
    for (const node of frontier) {
      for (const to of next.get(node) ?? []) {
        if (!group.has(to)) continue;
        if (to === start) {
          const path = [node];
          while (path[0] !== start) path.unshift(parent.get(path[0])!);
          return path;
        }
        if (parent.has(to)) continue;
        parent.set(to, node);
        following.push(to);
      }
    }
    frontier = following;
  }
  return null;
}
