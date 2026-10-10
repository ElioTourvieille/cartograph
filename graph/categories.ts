import { KINDS, kindOf } from "./kinds.ts";
import { railOrder, ROLES, UNIDENTIFIED } from "./taxonomy.ts";
import type { Graph } from "./types.ts";

// The categories the rail lists and the map dims by. With a framework found,
// they are the roles its adapter gave, in the taxonomy's fixed order, closed
// by what no convention named. With none, they are the plain kinds of file
// (TypeScript, Tests…), as before. Pure, and free of any parser or file-system
// library: it only reads the names in the taxonomy.

export type Category = {
  id: string;
  label: string;
  /** A CSS colour. It identifies the category and means nothing else. */
  swatch: string;
  /** The framework reaches its files without an import. */
  reached: boolean;
};

export type Categories = {
  /** Every category the repository could have, in rail order. */
  list: readonly Category[];
  /** The id of the category a file is in. */
  of(path: string): string;
  /** How many files each category holds; absent when it holds none. */
  counts: ReadonlyMap<string, number>;
  get(id: string): Category | undefined;
  /** A file the framework reaches by itself, so nothing needs to import it. */
  reached(path: string): boolean;
};

const PALETTE_SIZE = 12;

export function categorize(
  graph: Pick<Graph, "frameworks" | "files" | "roles">,
): Categories {
  const framework = graph.frameworks.length > 0;

  const list: Category[] = framework
    ? railOrder(graph.frameworks).map((role, i) => ({
        id: role.id,
        label: role.label,
        swatch: `var(--cat-${(i % PALETTE_SIZE) + 1})`,
        reached: role.reached,
      }))
    : KINDS.map((k) => ({
        id: k.id,
        label: k.label,
        swatch: `var(--kind-${k.id})`,
        reached: false,
      }));
  const byId = new Map(list.map((c) => [c.id, c]));

  const roleOf = new Map(graph.roles.map((r) => [r.path, r.role]));
  const of = (path: string): string => {
    if (!framework) return kindOf(path);
    const role = roleOf.get(path);
    return role !== undefined && byId.has(role) ? role : UNIDENTIFIED.id;
  };

  const counts = new Map<string, number>();
  for (const f of graph.files) counts.set(of(f.path), (counts.get(of(f.path)) ?? 0) + 1);

  return {
    list,
    of,
    counts,
    get: (id) => byId.get(id),
    reached: (path) => (framework ? (ROLES.get(of(path))?.reached ?? false) : false),
  };
}
