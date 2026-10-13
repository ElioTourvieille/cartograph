import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

// What the evaluation scripts read. They run outside the web app, so there is
// no signed-in person and no token to read an organization from: every function
// here takes the organization EXPLICITLY, and is internal, so it is reachable
// only from the Convex CLI (`convex run`) and never from a browser. A public
// function that skipped the org-scoping builders would be a bug; this is the
// other way, and it is deliberate: an explicit organization, and a function
// nobody outside can call.
//
// Every row read goes through an index that starts with that organization, and
// an analysis that belongs to another one is refused rather than read.

const READ_CAP = 500;
const PAGE_CAP = 1000;

export const analyses = internalQuery({
  args: { orgId: v.string() },
  returns: v.array(
    v.object({
      id: v.id("analyses"),
      repo: v.union(v.string(), v.null()),
      status: v.string(),
      commitSha: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query("analyses")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(50);
    return Promise.all(
      rows.map(async (a) => {
        const project = await ctx.db.get("projects", a.projectId);
        return {
          id: a._id,
          repo: project === null ? null : `${project.owner}/${project.name}`,
          status: a.status,
          commitSha: a.commitSha ?? null,
        };
      }),
    );
  },
});

// The explanations of an organization, newest first, with the set of paths the
// model was shown when it wrote each one (null on rows written before it was
// kept).
export const explanations = internalQuery({
  args: { orgId: v.string(), limit: v.number() },
  returns: v.array(
    v.object({
      analysisId: v.id("analyses"),
      kind: v.union(v.literal("file"), v.literal("folder"), v.null()),
      subject: v.string(),
      text: v.string(),
      model: v.union(v.string(), v.null()),
      shown: v.union(v.array(v.string()), v.null()),
    }),
  ),
  handler: async (ctx, { orgId, limit }) => {
    const rows = await ctx.db
      .query("explanations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(Math.min(limit, READ_CAP));
    return rows.map((r) => ({
      analysisId: r.analysisId,
      kind: r.kind ?? null,
      subject: r.filePath,
      text: r.text,
      model: r.model ?? null,
      shown: r.shown ?? null,
    }));
  },
});

// An analysis that is not this organization's is refused, not read.
async function owned(ctx: QueryCtx, orgId: string, analysisId: Id<"analyses">): Promise<void> {
  const analysis = await ctx.db.get("analyses", analysisId);
  if (analysis === null || analysis.orgId !== orgId) {
    throw new ConvexError("Cette analyse n'appartient pas à l'organisation demandée.");
  }
}

const pageArgs = {
  orgId: v.string(),
  analysisId: v.id("analyses"),
  cursor: v.union(v.string(), v.null()),
  numItems: v.number(),
};

export const files = internalQuery({
  args: pageArgs,
  returns: v.object({
    page: v.array(
      v.object({ path: v.string(), lines: v.number(), hash: v.string() }),
    ),
    isDone: v.boolean(),
    cursor: v.string(),
  }),
  handler: async (ctx, { orgId, analysisId, cursor, numItems }) => {
    await owned(ctx, orgId, analysisId);
    const result = await ctx.db
      .query("files")
      .withIndex("by_org_analysis", (q) => q.eq("orgId", orgId).eq("analysisId", analysisId))
      .paginate({ cursor, numItems: Math.min(numItems, PAGE_CAP) });
    return {
      page: result.page.map((f) => ({ path: f.path, lines: f.lines, hash: f.contentHash })),
      isDone: result.isDone,
      cursor: result.continueCursor,
    };
  },
});

export const edges = internalQuery({
  args: pageArgs,
  returns: v.object({
    page: v.array(v.object({ from: v.string(), to: v.string() })),
    isDone: v.boolean(),
    cursor: v.string(),
  }),
  handler: async (ctx, { orgId, analysisId, cursor, numItems }) => {
    await owned(ctx, orgId, analysisId);
    const result = await ctx.db
      .query("edges")
      .withIndex("by_org_analysis", (q) => q.eq("orgId", orgId).eq("analysisId", analysisId))
      .paginate({ cursor, numItems: Math.min(numItems, PAGE_CAP) });
    return {
      page: result.page.flatMap((e) =>
        e.toPath === undefined ? [] : [{ from: e.fromPath, to: e.toPath }],
      ),
      isDone: result.isDone,
      cursor: result.continueCursor,
    };
  },
});

// Roles with the side that decided each one: an adapter (convention, certain)
// or a model. The held-out role dataset is made of the first kind.
export const roles = internalQuery({
  args: pageArgs,
  returns: v.object({
    page: v.array(
      v.object({
        path: v.string(),
        role: v.string(),
        source: v.union(v.literal("adapter"), v.literal("model")),
      }),
    ),
    isDone: v.boolean(),
    cursor: v.string(),
  }),
  handler: async (ctx, { orgId, analysisId, cursor, numItems }) => {
    await owned(ctx, orgId, analysisId);
    const result = await ctx.db
      .query("fileRoles")
      .withIndex("by_org_analysis", (q) => q.eq("orgId", orgId).eq("analysisId", analysisId))
      .paginate({ cursor, numItems: Math.min(numItems, PAGE_CAP) });
    return {
      page: result.page.map((r) => ({ path: r.filePath, role: r.role, source: r.source })),
      isDone: result.isDone,
      cursor: result.continueCursor,
    };
  },
});
