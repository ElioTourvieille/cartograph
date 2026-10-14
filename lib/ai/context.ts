import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { READ_PAGE } from "@/convex/lib/limits";
import { ROLES } from "@/graph/taxonomy";

// What the model is allowed to know about the repository: the analysis as it is
// stored, read under the person's own token, in pages. The model is handed
// paths from here and nowhere else, so every path it can name is one that is
// really in the analysis.

export type Loaded = {
  files: { path: string; folder: string; lines: number; hash: string }[];
  edges: { from: string; to: string }[];
  /** path -> role id, for the files that have one. */
  roles: Map<string, string>;
};

export type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

export async function collect<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: Page<T> = await fetchPage(cursor);
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }
}

export async function loadGraph(token: string, analysisId: Id<"analyses">): Promise<Loaded> {
  const args = (cursor: string | null) => ({
    analysisId,
    paginationOpts: { numItems: READ_PAGE, cursor },
  });
  const [files, edges, roles] = await Promise.all([
    collect((c) => fetchQuery(api.graph.files, args(c), { token })),
    collect((c) => fetchQuery(api.graph.edges, args(c), { token })),
    collect((c) => fetchQuery(api.graph.roles, args(c), { token })),
  ]);
  return {
    files,
    edges: edges.map((e) => ({ from: e.from, to: e.to })),
    roles: new Map(roles.map((r) => [r.path, r.role])),
  };
}

/** The readable name of a role id, or null for a file with none. */
export function roleLabel(graph: Loaded, path: string): string | null {
  const id = graph.roles.get(path);
  return id === undefined ? null : (ROLES.get(id)?.label ?? null);
}

/** Files a file imports and files that import it, each listed once. */
export function neighboursOf(graph: Loaded, path: string) {
  const imports = new Set<string>();
  const dependents = new Set<string>();
  for (const e of graph.edges) {
    if (e.from === path && e.to !== path) imports.add(e.to);
    if (e.to === path && e.from !== path) dependents.add(e.from);
  }
  return { imports: [...imports].sort(), dependents: [...dependents].sort() };
}
