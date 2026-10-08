import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Every table carries the owning organization's id and an index that starts
// with it. `pnpm check:isolation` fails if one doesn't. Nothing here stores a file's contents: that is fetched from the
// repository when needed, so documents stay small.
//
// Shapes are the minimum later phases can grow from. A phase that needs a new
// field adds it here, in version control, never in a dashboard.
//
// Reading a whole analysis (4 000 files, 10 000 edges) stays one row per
// document: 14 000 documents is under the 32 000-document and 16 MiB read
// limits of a single call, so rows are not packed. Phase 7 reads it in slices
// by the (orgId, analysisId) indexes.
export default defineSchema({
  projects: defineTable({
    orgId: v.string(),
    repoUrl: v.string(),
    owner: v.string(),
    name: v.string(),
  }).index("by_org", ["orgId"]),

  analyses: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    status: v.union(
      v.literal("queued"),
      v.literal("parsing"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    // Set only when status is "failed": what went wrong, in words.
    error: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_project", ["orgId", "projectId"]),

  files: defineTable({
    orgId: v.string(),
    analysisId: v.id("analyses"),
    path: v.string(),
    // Lets an explanation say whether the file changed since it was written.
    contentHash: v.string(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_analysis", ["orgId", "analysisId"]),

  edges: defineTable({
    orgId: v.string(),
    analysisId: v.id("analyses"),
    fromPath: v.string(),
    // Absent when the import could not be resolved to a file in the repo.
    toPath: v.optional(v.string()),
    kind: v.union(
      v.literal("import"),
      v.literal("reexport"),
      v.literal("dynamic"),
      v.literal("require"),
    ),
    // Set exactly when toPath is absent: why it could not be resolved.
    unresolvedReason: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_analysis", ["orgId", "analysisId"]),

  routes: defineTable({
    orgId: v.string(),
    analysisId: v.id("analyses"),
    method: v.string(),
    pattern: v.string(),
    filePath: v.string(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_analysis", ["orgId", "analysisId"]),

  explanations: defineTable({
    orgId: v.string(),
    analysisId: v.id("analyses"),
    filePath: v.string(),
    // Hash of the file when the explanation was written, to detect staleness.
    contentHash: v.string(),
    text: v.string(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_analysis", ["orgId", "analysisId"]),

  fileRoles: defineTable({
    orgId: v.string(),
    analysisId: v.id("analyses"),
    filePath: v.string(),
    role: v.string(),
    // Which side decided: a framework adapter, or the model for the files no
    // adapter could identify.
    source: v.union(v.literal("adapter"), v.literal("model")),
  })
    .index("by_org", ["orgId"])
    .index("by_org_analysis", ["orgId", "analysisId"]),

  insights: defineTable({
    orgId: v.string(),
    analysisId: v.id("analyses"),
    kind: v.string(),
    filePaths: v.array(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_analysis", ["orgId", "analysisId"]),
});
