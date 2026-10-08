import { v } from "convex/values";
import { orgQuery } from "./lib/org";

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
        status: v.union(
          v.literal("queued"),
          v.literal("parsing"),
          v.literal("complete"),
          v.literal("failed"),
        ),
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
          status: a.status,
          error: a.error ?? null,
          repo: project === null ? null : `${project.owner}/${project.name}`,
        };
      }),
    );
    return { rows, truncated: found.length > PAGE };
  },
});
