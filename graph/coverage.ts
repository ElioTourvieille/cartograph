import type { Infer } from "convex/values";
import type { coverageValidator } from "../convex/lib/validators.ts";

// How much of the repository the map actually covers, as one figure that
// cannot flatter. Pure, so the banner and a terminal check read it the same.

export type StoredCoverage = Infer<typeof coverageValidator>;

/** Under this share of resolved imports the banner opens and says so. */
export const PARTIAL_BELOW = 0.95;

/**
 * Of the imports that point inside the repository, the share that resolved to
 * a file: resolved ÷ (resolved + unresolved). Packages and deliberately
 * excluded folders are not in it; they are not failures. null when there was
 * nothing inside the repository to resolve.
 */
export function importFigure(c: Pick<StoredCoverage, "imports">): number | null {
  const total = c.imports.resolved + c.imports.unresolved;
  return total === 0 ? null : c.imports.resolved / total;
}

/**
 * "97,3 %". Rounded down, so 99,96 % never reads as 100 % and a graph that is
 * missing something cannot look complete.
 */
export function percent(share: number): string {
  const tenths = Math.floor(share * 1000) / 10;
  return `${tenths.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** Partial in any way: an import that failed, a file skipped, a config that did not load. */
export function isPartial(c: StoredCoverage): boolean {
  const figure = importFigure(c);
  return (
    (figure !== null && figure < 1) || c.filesSkipped > 0 || c.tsconfigError !== null
  );
}
