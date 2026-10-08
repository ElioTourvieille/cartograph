import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { IgnoredDirectory } from "./types.ts";

export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

// Directories that hold dependencies or build output, not the repository's own
// code. Whole directories are dropped by name — never single files by size or
// rank, which would leave edges pointing at files that were never kept.
export const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
]);

export function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export type WalkedFile = {
  /** Posix path relative to the root. */
  path: string;
  isSymlink: boolean;
};

export type Walk = {
  files: WalkedFile[];
  ignoredDirectories: IgnoredDirectory[];
};

// Every source file under `root`, in a stable order. Symlinked directories are
// not followed (loops, and files outside the repository) and are reported.
export function walk(root: string): Walk {
  const files: WalkedFile[] = [];
  const ignoredDirectories: IgnoredDirectory[] = [];

  const visit = (dir: string, rel: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (isSourceFile(entry.name)) {
          files.push({ path: entryRel, isSymlink: true });
        } else if (pointsToDirectory(abs)) {
          ignoredDirectories.push({ path: entryRel, reason: "lien-symbolique" });
        }
      } else if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          ignoredDirectories.push({ path: entryRel, reason: "dossier-exclu" });
        } else {
          visit(abs, entryRel);
        }
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        files.push({ path: entryRel, isSymlink: false });
      }
    }
  };

  visit(root, "");
  return { files, ignoredDirectories };
}

function pointsToDirectory(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}
