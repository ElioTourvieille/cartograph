import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Reads stored analyses the only way the evaluations are allowed to: through
// the internal functions in convex/evalData.ts, run with the Convex CLI, each
// taking an explicit organization. There is no public function involved and no
// way around the org-scoping builders: nothing here can read what the CLI call
// did not ask for.

const CLI = join(process.cwd(), "node_modules", "convex", "bin", "main.js");

function parse(output: string): unknown {
  const trimmed = output.trim();
  // A function that returns null prints nothing at all.
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // The CLI may print a line or two before the value.
    const start = trimmed.search(/^[[{]/m);
    if (start === -1) throw new Error(`Réponse inattendue de Convex : ${trimmed.slice(0, 200)}`);
    return JSON.parse(trimmed.slice(start));
  }
}

export function convexRun(fn: string, args: Record<string, unknown>): unknown {
  if (!existsSync(CLI)) throw new Error("Convex n'est pas installé : lancez pnpm install.");
  try {
    const output = execFileSync(process.execPath, [CLI, "run", fn, JSON.stringify(args)], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parse(output);
  } catch (error) {
    const detail =
      error instanceof Error && "stderr" in error ? String(error.stderr).slice(0, 400) : String(error);
    throw new Error(`convex run ${fn} a échoué : ${detail}`);
  }
}

type Paged<T> = { page: T[]; isDone: boolean; cursor: string };

// Every row of a paginated internal function, page after page.
export function convexAll<T>(fn: string, args: Record<string, unknown>): T[] {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result = convexRun(fn, { ...args, cursor, numItems: 1000 }) as Paged<T>;
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.cursor;
  }
}
