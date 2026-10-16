import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

// Convex has no cascade, so everything an organization owns is deleted by
// hand, in batches. Internal on purpose: it names an organization, which a
// public function must never do. Run it from a terminal:
//   npx convex run orgData:deleteOrgData '{"orgId":"org_..."}'
// Hooking it to the identity provider's organization-deleted event comes later.
const BATCH = 500;

const ORG_TABLES = [
  "edges",
  "files",
  "routes",
  "explanations",
  "fileRoles",
  "insights",
  "analyses",
  "projects",
  "installations",
] as const satisfies readonly TableNames[];

// A table added to the schema and not listed above makes this a type error,
// so a new table can't silently escape deletion.
type Unlisted = Exclude<TableNames, (typeof ORG_TABLES)[number]>;
export type AllTablesAreDeleted = Unlisted extends never ? true : never;

export const deleteOrgData = internalMutation({
  args: { orgId: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId }): Promise<null> => {
    let remaining = BATCH;
    for (const table of ORG_TABLES) {
      if (remaining === 0) break;
      const rows = await ctx.db
        .query(table)
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .take(remaining);
      for (const row of rows) await ctx.db.delete(row._id);
      remaining -= rows.length;
    }
    // Budget spent: there may be more. Run again until a call finds nothing.
    if (remaining === 0) {
      await ctx.scheduler.runAfter(0, internal.orgData.deleteOrgData, { orgId });
    }
    return null;
  },
});
