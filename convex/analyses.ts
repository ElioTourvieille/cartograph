import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { orgMutation, orgQuery } from "./lib/org";
import { parseRepoUrl } from "./lib/repoUrl";
import { coverageValidator, stageValidator } from "./lib/validators";

const status = v.union(
  v.literal("queued"),
  v.literal("parsing"),
  v.literal("complete"),
  v.literal("failed"),
);

/** A run with no write for this long is dead, not slow. */
export const STALE_MS = 5 * 60 * 1000;

// Bounded read: the most recent analyses of the current organization. One more
// than the page is read so the screen can say the list was cut, instead of
// presenting a partial list as the whole.
const PAGE = 100;

export const list = orgQuery({
  args: {},
  returns: v.object({
    rows: v.array(
      v.object({
        id: v.id("analyses"),
        createdAt: v.number(),
        updatedAt: v.number(),
        status,
        stage: v.union(stageValidator, v.null()),
        message: v.union(v.string(), v.null()),
        error: v.union(v.string(), v.null()),
        // null if the project row is missing, rather than an invented name.
        repo: v.union(v.string(), v.null()),
      }),
    ),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const found = await ctx.db.analyses().order("desc").take(PAGE + 1);
    const rows = await Promise.all(
      found.slice(0, PAGE).map(async (a) => {
        const project = await ctx.db.get("projects", a.projectId);
        return {
          id: a._id,
          createdAt: a._creationTime,
          updatedAt: a.updatedAt ?? a._creationTime,
          status: a.status,
          stage: a.stage ?? null,
          message: a.message ?? null,
          error: a.error ?? null,
          repo: project === null ? null : `${project.owner}/${project.name}`,
        };
      }),
    );
    return { rows, truncated: found.length > PAGE };
  },
});

// Starting a run. The check for an existing analysis and the creation of a new
// one are in this one mutation: Convex has no unique constraint, so the
// transaction is the whole guarantee. Two people pasting the same address at
// once both read "nothing there" and both try to insert; the second to commit
// conflicts, runs again, and finds the first one's row.
export const start = orgMutation({
  args: { repoUrl: v.string() },
  returns: v.object({ analysisId: v.id("analyses"), created: v.boolean() }),
  handler: async (ctx, { repoUrl }) => {
    const repo = parseRepoUrl(repoUrl);

    const project = await ctx.db.projectByRepoKey(repo.key);
    if (project !== null) {
      const existing = await ctx.db.analysisOfProject(project._id);
      if (existing !== null) return { analysisId: existing._id, created: false };
    }

    const projectId =
      project?._id ??
      (await ctx.db.insertProject({
        repoUrl: repo.url,
        owner: repo.owner,
        name: repo.name,
        repoKey: repo.key,
      }));
    const now = Date.now();
    const analysisId = await ctx.db.insertAnalysis({
      projectId,
      status: "queued",
      stage: "fetch",
      message: "En attente de démarrage.",
      startedAt: now,
      updatedAt: now,
    });
    return { analysisId, created: true };
  },
});

// Re-running is a deliberate act on an existing analysis. This only puts it
// back in the queue; the previous rows are cleared by the run itself, in
// batches, before it writes new ones.
export const requestRerun = orgMutation({
  args: { analysisId: v.id("analyses") },
  returns: v.null(),
  handler: async (ctx, { analysisId }) => {
    const analysis = await ctx.db.get("analyses", analysisId);
    if (analysis === null) throw new ConvexError("Analyse introuvable.");
    if (analysis.status === "queued" || analysis.status === "parsing") {
      throw new ConvexError("Une analyse est déjà en cours pour ce dépôt.");
    }
    const now = Date.now();
    await ctx.db.patchAnalysis(analysisId, {
      status: "queued",
      stage: "fetch",
      message: "En attente de démarrage.",
      error: undefined,
      failedStage: undefined,
      commitSha: undefined,
      coverage: undefined,
      frameworks: undefined,
      startedAt: now,
      updatedAt: now,
      finishedAt: undefined,
    });
    return null;
  },
});

// What the progress page and the dashboard subscribe to. It reads the analysis
// and its project, and nothing else: never a table the run is writing into, so
// a batch of files does not wake it. The id comes from a URL, so it is a string
// until it is checked to be one of this organization's.
export const progress = orgQuery({
  args: { analysisId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("analyses"),
      status,
      stage: v.union(stageValidator, v.null()),
      message: v.union(v.string(), v.null()),
      error: v.union(v.string(), v.null()),
      failedStage: v.union(stageValidator, v.null()),
      startedAt: v.number(),
      updatedAt: v.number(),
      finishedAt: v.union(v.number(), v.null()),
      repo: v.union(v.string(), v.null()),
      repoUrl: v.union(v.string(), v.null()),
      commitSha: v.union(v.string(), v.null()),
      coverage: v.union(coverageValidator, v.null()),
      frameworks: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { analysisId }) => {
    const id = ctx.db.normalizeId("analyses", analysisId);
    if (id === null) return null;
    const a = await ctx.db.get("analyses", id);
    if (a === null) return null;
    const project = await ctx.db.get("projects", a.projectId);
    return {
      id,
      status: a.status,
      stage: a.stage ?? null,
      message: a.message ?? null,
      error: a.error ?? null,
      failedStage: a.failedStage ?? null,
      startedAt: a.startedAt ?? a._creationTime,
      updatedAt: a.updatedAt ?? a._creationTime,
      finishedAt: a.finishedAt ?? null,
      repo: project === null ? null : `${project.owner}/${project.name}`,
      repoUrl: project?.repoUrl ?? null,
      commitSha: a.commitSha ?? null,
      coverage: a.coverage ?? null,
      frameworks: a.frameworks ?? [],
    };
  },
});

// A run that dies without failing — the process stopped, the machine slept —
// leaves a row that says "parsing" forever. Nothing here has a queue to notice,
// so this is the check: every few minutes, anything unfinished and silent for
// STALE_MS is marked failed, with the stage it stopped in. Internal, across all
// organizations on purpose, and bounded per pass.
export const failStale = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;
    let marked = 0;
    for (const unfinished of ["queued", "parsing"] as const) {
      const stale = await ctx.db
        .query("analyses")
        .withIndex("by_status_updated", (q) =>
          q.eq("status", unfinished).lt("updatedAt", cutoff),
        )
        .take(100);
      for (const a of stale) {
        await ctx.db.patch("analyses", a._id, {
          status: "failed",
          failedStage: a.stage ?? "fetch",
          error: `Analyse abandonnée : aucune activité depuis plus de ${STALE_MS / 60000} minutes.`,
          finishedAt: Date.now(),
        });
        marked++;
      }
    }
    return marked;
  },
});
