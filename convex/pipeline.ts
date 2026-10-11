import { ConvexError, v } from "convex/values";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { BATCH } from "./lib/limits";
import { pipelineMutation } from "./lib/org";
import { coverageValidator, stageValidator } from "./lib/validators";

// The pipeline's write path. Every function here is built with
// pipelineMutation: the caller supplies an analysis id and the server-only
// secret, nothing else. The organization is read off the analysis row, so none
// of these can be pointed at another organization's data, and none takes an
// organization as an input.

function requireRunning(analysis: Doc<"analyses">): void {
  if (analysis.status !== "parsing") {
    // Covers a run the scheduled check already marked failed: a late write
    // from a process that was only slow must not resurrect or pollute it.
    throw new ConvexError("Cette analyse n'est pas en cours d'exécution.");
  }
}

// Claims the analysis for this run. Only a queued analysis can be claimed, so
// two processes cannot both run one analysis.
export const begin = pipelineMutation({
  args: {},
  returns: v.object({ owner: v.string(), name: v.string() }),
  handler: async (ctx) => {
    const { analysis } = ctx;
    if (analysis.status !== "queued") {
      throw new ConvexError("Cette analyse n'est pas en attente.");
    }
    const project = await ctx.db.get("projects", analysis.projectId);
    if (project === null) throw new ConvexError("Dépôt introuvable.");
    await ctx.db.patchAnalysis(analysis._id, {
      status: "parsing",
      stage: "fetch",
      message: "Récupération de l'archive du dépôt.",
      updatedAt: Date.now(),
    });
    return { owner: project.owner, name: project.name };
  },
});

export const setStage = pipelineMutation({
  args: {
    stage: stageValidator,
    message: v.string(),
    commitSha: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { stage, message, commitSha }) => {
    requireRunning(ctx.analysis);
    await ctx.db.patchAnalysis(ctx.analysis._id, {
      stage,
      message,
      updatedAt: Date.now(),
      ...(commitSha === undefined ? {} : { commitSha }),
    });
    return null;
  },
});

// A sign of life during a stage that writes nothing, so a long parse is not
// mistaken for a dead run.
export const touch = pipelineMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    requireRunning(ctx.analysis);
    await ctx.db.patchAnalysis(ctx.analysis._id, { updatedAt: Date.now() });
    return null;
  },
});

// Deletes up to BATCH of the analysis's earlier rows, across every table that
// can hold some. Called until it says it is done: a re-run clears before it
// writes, and a single mutation could not delete 14 000 documents.
export const clear = pipelineMutation({
  args: {},
  returns: v.object({ done: v.boolean() }),
  handler: async (ctx) => {
    requireRunning(ctx.analysis);
    const rows = ctx.db.inAnalysis(ctx.analysis._id);
    let deleted = 0;

    const remove = async <T extends TableNames>(
      table: T,
      found: { _id: Id<T> }[],
    ) => {
      for (const row of found) await ctx.db.delete(table, row._id);
      deleted += found.length;
    };

    await remove("edges", await rows.edges().take(BATCH - deleted));
    await remove("files", await rows.files().take(BATCH - deleted));
    await remove("routes", await rows.routes().take(BATCH - deleted));
    await remove("explanations", await rows.explanations().take(BATCH - deleted));
    await remove("fileRoles", await rows.fileRoles().take(BATCH - deleted));
    await remove("insights", await rows.insights().take(BATCH - deleted));

    await ctx.db.patchAnalysis(ctx.analysis._id, {
      message: "Nettoyage de l'analyse précédente.",
      updatedAt: Date.now(),
    });
    return { done: deleted < BATCH };
  },
});

export const writeFiles = pipelineMutation({
  args: {
    message: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        folder: v.string(),
        lines: v.number(),
        hash: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { message, files }) => {
    requireRunning(ctx.analysis);
    if (files.length > BATCH) throw new ConvexError("Lot de fichiers trop grand.");
    for (const f of files) {
      await ctx.db.insertFile({
        analysisId: ctx.analysis._id,
        path: f.path,
        folder: f.folder,
        lines: f.lines,
        contentHash: f.hash,
      });
    }
    await ctx.db.patchAnalysis(ctx.analysis._id, { message, updatedAt: Date.now() });
    return null;
  },
});

export const writeEdges = pipelineMutation({
  args: {
    message: v.string(),
    edges: v.array(
      v.object({
        from: v.string(),
        to: v.string(),
        kind: v.union(
          v.literal("import"),
          v.literal("reexport"),
          v.literal("dynamic"),
          v.literal("require"),
        ),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { message, edges }) => {
    requireRunning(ctx.analysis);
    if (edges.length > BATCH) throw new ConvexError("Lot de liens trop grand.");
    for (const e of edges) {
      await ctx.db.insertEdge({
        analysisId: ctx.analysis._id,
        fromPath: e.from,
        toPath: e.to,
        kind: e.kind,
      });
    }
    await ctx.db.patchAnalysis(ctx.analysis._id, { message, updatedAt: Date.now() });
    return null;
  },
});

export const writeRoles = pipelineMutation({
  args: {
    message: v.string(),
    roles: v.array(v.object({ path: v.string(), role: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { message, roles }) => {
    requireRunning(ctx.analysis);
    if (roles.length > BATCH) throw new ConvexError("Lot de rôles trop grand.");
    for (const r of roles) {
      await ctx.db.insertFileRole({
        analysisId: ctx.analysis._id,
        filePath: r.path,
        role: r.role,
        source: "adapter",
      });
    }
    await ctx.db.patchAnalysis(ctx.analysis._id, { message, updatedAt: Date.now() });
    return null;
  },
});

export const writeRoutes = pipelineMutation({
  args: {
    message: v.string(),
    routes: v.array(
      v.object({ method: v.string(), pattern: v.string(), file: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { message, routes }) => {
    requireRunning(ctx.analysis);
    if (routes.length > BATCH) throw new ConvexError("Lot de routes trop grand.");
    for (const r of routes) {
      await ctx.db.insertRoute({
        analysisId: ctx.analysis._id,
        method: r.method,
        pattern: r.pattern,
        filePath: r.file,
      });
    }
    await ctx.db.patchAnalysis(ctx.analysis._id, { message, updatedAt: Date.now() });
    return null;
  },
});

// Only this makes an analysis readable: the explorer shows rows of a complete
// analysis and no other, so a run that stops before here leaves nothing shown.
export const complete = pipelineMutation({
  args: {
    commitSha: v.string(),
    coverage: coverageValidator,
    frameworks: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { commitSha, coverage, frameworks }) => {
    requireRunning(ctx.analysis);
    const now = Date.now();
    await ctx.db.patchAnalysis(ctx.analysis._id, {
      status: "complete",
      stage: "store",
      message: "Terminée.",
      commitSha,
      coverage,
      frameworks,
      updatedAt: now,
      finishedAt: now,
    });
    return null;
  },
});

// Says why and where. Not gated on "parsing": a run can fail before it claims
// the analysis, and the reason should be written either way.
export const fail = pipelineMutation({
  args: { stage: stageValidator, error: v.string() },
  returns: v.null(),
  handler: async (ctx, { stage, error }) => {
    if (ctx.analysis.status === "complete") return null;
    const now = Date.now();
    await ctx.db.patchAnalysis(ctx.analysis._id, {
      status: "failed",
      failedStage: stage,
      error,
      updatedAt: now,
      finishedAt: now,
    });
    return null;
  },
});
