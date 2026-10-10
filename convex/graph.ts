import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { READ_PAGE } from "./lib/limits";
import { orgQuery } from "./lib/org";

// How the explorer loads an analysis: once, in pages, after which everything is
// computed in the browser with no further function calls.
//
// Both queries answer only for a COMPLETE analysis and otherwise return an
// empty finished page without touching the files or edges tables. That is what
// keeps partial rows from ever being shown, and it is also what keeps a re-run
// from waking these subscriptions: the moment a re-run starts, the analysis is
// no longer complete, the query re-runs once, and from then on it reads only
// the analysis row, not the rows being deleted and rewritten.

const empty = { page: [], isDone: true, continueCursor: "" };

export const files = orgQuery({
  args: { analysisId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      path: v.string(),
      folder: v.string(),
      lines: v.number(),
      hash: v.string(),
    }),
  ),
  handler: async (ctx, { analysisId, paginationOpts }) => {
    const id = ctx.db.normalizeId("analyses", analysisId);
    if (id === null) return empty;
    const analysis = await ctx.db.get("analyses", id);
    if (analysis === null || analysis.status !== "complete") return empty;

    const result = await ctx.db
      .inAnalysis(id)
      .files()
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, READ_PAGE) });
    return {
      ...result,
      page: result.page.map((f) => ({
        path: f.path,
        folder: f.folder,
        lines: f.lines,
        hash: f.contentHash,
      })),
    };
  },
});

export const edges = orgQuery({
  args: { analysisId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      from: v.string(),
      to: v.string(),
      kind: v.union(v.literal("import"), v.literal("reexport"), v.literal("dynamic")),
    }),
  ),
  handler: async (ctx, { analysisId, paginationOpts }) => {
    const id = ctx.db.normalizeId("analyses", analysisId);
    if (id === null) return empty;
    const analysis = await ctx.db.get("analyses", id);
    if (analysis === null || analysis.status !== "complete") return empty;

    const result = await ctx.db
      .inAnalysis(id)
      .edges()
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, READ_PAGE) });
    return {
      ...result,
      page: result.page.flatMap((e) =>
        // Every stored edge resolved to a file. The kind "require" exists in
        // the schema for a later phase and is not written yet.
        e.toPath === undefined || e.kind === "require"
          ? []
          : [{ from: e.fromPath, to: e.toPath, kind: e.kind }],
      ),
    };
  },
});
