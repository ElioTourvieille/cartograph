import type { ParseResult } from "../parser/types.ts";

// What the explorer and every graph calculation read: the files and the edges,
// the repository's name, the frameworks found, and the roles and routes the
// adapters produced. The parser's own output satisfies it, and so does an
// analysis rebuilt from stored rows, which is how the map no longer depends on
// where the data came from.
export type Graph = Pick<
  ParseResult,
  "root" | "frameworks" | "files" | "edges" | "roles" | "routes"
>;
