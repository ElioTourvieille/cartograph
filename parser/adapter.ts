import type { FileFacts } from "./facts.ts";
import type { Route } from "./types.ts";

// Anything that depends on a framework's conventions lives behind this. The
// parser core only ever asks an adapter, it never checks for a framework.
// This file imports nothing from Node.

/** A file as an adapter sees it: its path in the repository, its path inside
 *  the package it belongs to (where conventions such as app/ or src/ apply),
 *  and what the parser read from its syntax. */
export type ScopedFile = { path: string; local: string; facts: FileFacts };

export type AdapterContext = {
  /** The text of a file of the repository, or null if it cannot be read. */
  read(path: string): string | null;
};

export interface Adapter {
  /** Stable id, also the key of the rail's categories for this framework. */
  id: string;
  /** Whether a package whose package.json declares these dependencies is one. */
  detect(dependencies: ReadonlySet<string>): boolean;
  /** Names of calls whose literal arguments the parser should record. */
  watch: readonly string[];
  /** The folder a file belongs to, from its posix path relative to the root. */
  folderOf(path: string): string;
  /** The role id of a file, or null when no convention names one. */
  roleOf(file: ScopedFile): string | null;
  /**
   * Routes of the files of one package. A route is emitted only when its
   * method and its full pattern are both written in the code; otherwise it is
   * left out, because a wrong route is the same failure as an invented edge.
   */
  routes(files: readonly ScopedFile[], context: AdapterContext): Route[];
}

export const folderOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
};

// The adapter that knows nothing: a file belongs to the directory it sits in,
// has no role and yields no route.
export const fallbackAdapter: Adapter = {
  id: "aucun",
  detect: () => true,
  watch: [],
  folderOf,
  roleOf: () => null,
  routes: () => [],
};
