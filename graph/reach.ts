import type { Index } from "./detail.ts";

// Blast radius and dependency chain are the same walk over the edge list with
// a direction: written once. Iterative breadth-first, so a deep repository
// cannot blow a call stack, and nearest files come first.

/** Deeper than this returns most of a repository and stops being an answer. */
export const DEFAULT_DEPTH = 2;

/**
 * "dependents": everything that breaks if the file changes (who imports it,
 * and who imports those). "dependencies": everything the file needs.
 */
export type Way = "dependents" | "dependencies";

export type Reached = { path: string; distance: number };

export function reach(
  index: Index,
  start: string,
  way: Way,
  depth: number = DEFAULT_DEPTH,
): Reached[] {
  const next = way === "dependents" ? index.dependents : index.imports;
  const seen = new Set<string>([start]);
  const out: Reached[] = [];
  let frontier = [start];

  for (let distance = 1; distance <= depth && frontier.length > 0; distance++) {
    const following: string[] = [];
    for (const path of frontier) {
      for (const neighbour of next.get(path) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        following.push(neighbour);
        out.push({ path: neighbour, distance });
      }
    }
    frontier = following;
  }

  return out.sort(
    (a, b) => a.distance - b.distance || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}
