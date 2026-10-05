import { v } from "convex/values";
import { query } from "./_generated/server";

// Phase-01 diagnostic: the organization claim exactly as Convex sees it.
// No table is read, so this is the one function allowed on the raw builder;
// anything that touches rows must go through the org-scoping builders.
export const orgClaim = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ orgId: v.union(v.string(), v.null()) }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;
    // Clerk's v2 session token carries the active organization as `o.id`;
    // older templates use a flat `org_id`. Report whichever is present, and
    // null when the session has no active organization.
    const o = identity.o;
    if (typeof o === "object" && o !== null && "id" in o) {
      return { orgId: String(o.id) };
    }
    const flat = identity.org_id;
    return { orgId: typeof flat === "string" ? flat : null };
  },
});
