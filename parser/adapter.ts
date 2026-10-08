import { posix } from "node:path";

// Anything that depends on a framework's conventions lives behind this. The
// parser core only ever asks the adapter, it never checks for a framework.
export interface Adapter {
  name: string;
  /** The folder a file belongs to, from its posix path relative to the root. */
  folderOf(path: string): string;
}

// The adapter that knows nothing: a file belongs to the directory it sits in.
export const fallbackAdapter: Adapter = {
  name: "aucun",
  folderOf: (path) => posix.dirname(path),
};
