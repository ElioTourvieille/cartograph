// What sort of file something is, from its name alone. This is the rail's only
// source until framework adapters bring real roles (phase 8): a fact about the
// file name, never a guess about what the code does.

export type KindId = "ts" | "tsx" | "js" | "dts" | "test";

/** Reading order of the rail. A file belongs to the first kind that matches. */
export const KINDS: readonly { id: KindId; label: string }[] = [
  { id: "test", label: "Tests" },
  { id: "dts", label: "Déclarations de types" },
  { id: "ts", label: "TypeScript" },
  { id: "tsx", label: "TSX et JSX" },
  { id: "js", label: "JavaScript" },
];

const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

export function kindOf(path: string): KindId {
  if (TEST.test(path)) return "test";
  if (/\.d\.[cm]?ts$/.test(path)) return "dts";
  if (/\.[jt]sx$/.test(path)) return "tsx";
  if (/\.[cm]?ts$/.test(path)) return "ts";
  return "js";
}
