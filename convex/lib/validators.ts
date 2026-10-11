import { v } from "convex/values";

// Shapes shared by the schema and the functions that read and write them.

/** The named stages of a run, in order. */
export const STAGES = ["fetch", "select", "parse", "store"] as const;
export type Stage = (typeof STAGES)[number];

export const stageValidator = v.union(
  v.literal("fetch"),
  v.literal("select"),
  v.literal("parse"),
  v.literal("store"),
);

const tally = v.object({
  seen: v.number(),
  resolved: v.number(),
  external: v.number(),
  excluded: v.number(),
  unresolved: v.number(),
});

const occurrence = v.object({
  from: v.string(),
  line: v.number(),
  specifier: v.union(v.string(), v.null()),
  kind: v.union(
    v.literal("import"),
    v.literal("reexport"),
    v.literal("dynamic"),
    v.literal("require"),
  ),
});

const group = v.object({
  reason: v.string(),
  count: v.number(),
  examples: v.array(occurrence),
});

// What the parser's coverage report keeps once stored: every count, and the
// examples the parser already bounded. The list of skipped files is cut at
// SKIPPED_SHOWN; the count beside it is always the true one.
export const coverageValidator = v.object({
  filesFound: v.number(),
  filesParsed: v.number(),
  filesSkipped: v.number(),
  skipped: v.array(
    v.object({
      path: v.string(),
      reason: v.string(),
      detail: v.union(v.string(), v.null()),
    }),
  ),
  ignoredDirectories: v.number(),
  imports: tally,
  unresolved: v.array(group),
  excluded: v.array(group),
  tsconfig: v.union(v.string(), v.null()),
  tsconfigError: v.union(v.string(), v.null()),
});

export const SKIPPED_SHOWN = 50;
