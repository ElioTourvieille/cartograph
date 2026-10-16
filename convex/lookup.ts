import { v } from "convex/values";
import { orgQuery } from "./lib/org";

// The isolation probe behind acceptance check 3: ask for a row by its id and
// learn only whether the current organization can see it. Another
// organization's id answers `false`, the same as an id that never existed.
export const exists = orgQuery({
  args: {
    table: v.union(
      v.literal("projects"),
      v.literal("analyses"),
      v.literal("files"),
      v.literal("edges"),
      v.literal("routes"),
      v.literal("explanations"),
      v.literal("fileRoles"),
      v.literal("insights"),
      v.literal("installations"),
    ),
    id: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { table, id }) => {
    switch (table) {
      case "projects":
        return visible(ctx.db.normalizeId("projects", id), (i) =>
          ctx.db.get("projects", i),
        );
      case "analyses":
        return visible(ctx.db.normalizeId("analyses", id), (i) =>
          ctx.db.get("analyses", i),
        );
      case "files":
        return visible(ctx.db.normalizeId("files", id), (i) =>
          ctx.db.get("files", i),
        );
      case "edges":
        return visible(ctx.db.normalizeId("edges", id), (i) =>
          ctx.db.get("edges", i),
        );
      case "routes":
        return visible(ctx.db.normalizeId("routes", id), (i) =>
          ctx.db.get("routes", i),
        );
      case "explanations":
        return visible(ctx.db.normalizeId("explanations", id), (i) =>
          ctx.db.get("explanations", i),
        );
      case "fileRoles":
        return visible(ctx.db.normalizeId("fileRoles", id), (i) =>
          ctx.db.get("fileRoles", i),
        );
      case "insights":
        return visible(ctx.db.normalizeId("insights", id), (i) =>
          ctx.db.get("insights", i),
        );
      case "installations":
        return visible(ctx.db.normalizeId("installations", id), (i) =>
          ctx.db.get("installations", i),
        );
    }
  },
});

async function visible<I>(
  id: I | null,
  get: (id: I) => Promise<unknown>,
): Promise<boolean> {
  return id !== null && (await get(id)) !== null;
}
