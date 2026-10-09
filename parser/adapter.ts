// Anything that depends on a framework's conventions lives behind this. The
// parser core only ever asks the adapter, it never checks for a framework.
// This file imports nothing from Node, so the browser can use it too.
export interface Adapter {
  name: string;
  /** The folder a file belongs to, from its posix path relative to the root. */
  folderOf(path: string): string;
  /**
   * Whether the framework reaches this file without an import: pages, routes,
   * layouts, middleware, config. Such a file is never "unimported".
   */
  reachedByFramework(path: string): boolean;
}

// The adapter that knows nothing: a file belongs to the directory it sits in,
// and no file is known to be reached by a framework.
export const fallbackAdapter: Adapter = {
  name: "aucun",
  folderOf: (path) => {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "." : path.slice(0, slash);
  },
  reachedByFramework: () => false,
};
