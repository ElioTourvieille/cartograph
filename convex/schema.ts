import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { coverageValidator, stageValidator } from "./lib/validators";

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
    // "owner/name", lowercased: GitHub treats case as one repository. The key
    // that "one analysis per repository" is checked against, in one mutation.
    repoKey: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_repo_key", ["orgId", "repoKey"]),

  // One row per GitHub App installation an organization has connected. It holds
  // the installation's id and the account it is on, and nothing that could
  // read a repository: no token, no key. The App's private key lives in the
  // server environment only, and a token is minted per run and thrown away.
  installations: defineTable({
    orgId: v.string(),
    // GitHub's own id for the installation.
    githubId: v.number(),
    // The account it is installed on.
    account: v.string(),
    connectedAt: v.number(),
    // Set when it is disconnected here, or when GitHub reports it gone. The
    // row stays, so analyses made through it can still say where they came from.
    removedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_github", ["orgId", "githubId"])
    // Not org-scoped on purpose: "is this installation already someone's" has
    // to look across organizations. Only claimInstallation in lib/org.ts reads
    // it, and it answers free / mine / other, never whose.
    .index("by_github", ["githubId"]),

  analyses: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    // The installation a private repository is read through. Set when the
    // analysis is created, under the person's verified token and an
    // installation of their own organization; the pipeline reads it from here
    // and never from its caller. Absent for a public repository.
    installationId: v.optional(v.id("installations")),
    status: v.union(
      v.literal("queued"),
      v.literal("parsing"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    // Set only when status is "failed": what went wrong, in words.
    error: v.optional(v.string()),
    // The stage a run is in, or the one it failed in. Progress reads these and
    // nothing else, so a run writing files does not re-run the progress query.
    stage: v.optional(stageValidator),
    message: v.optional(v.string()),
    failedStage: v.optional(stageValidator),
    startedAt: v.optional(v.number()),
    // Bumped by every write of a run. A run whose updatedAt is old is dead.
    updatedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    // The commit the archive came from, to tell later whether the repository
    // has moved on.
    commitSha: v.optional(v.string()),
    coverage: v.optional(coverageValidator),
    // The frameworks the adapters found, in detection order. Absent until the
    // run completes; empty when none matched.
    frameworks: v.optional(v.array(v.string())),
  })
    .index("by_org", ["orgId"])
    .index("by_org_project", ["orgId", "projectId"])
    // Not org-scoped on purpose: the scheduled stale check works across the
    // deployment. Never reachable from a public function.
    .index("by_status_updated", ["status", "updatedAt"]),

  files: defineTable({
    orgId: v.string(),
    analysisId: v.id("analyses"),
    path: v.string(),
    // The folder the adapter put the file in, and its length in lines: what the
    // explorer needs and cannot recompute without the contents.
    folder: v.string(),
    lines: v.number(),
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
    // For a folded folder, a hash over its files' hashes.
    contentHash: v.string(),
    text: v.string(),
    // What it was cached under: the subject, its content, the model that wrote
    // it and the prompt's version. Re-pinning a model changes the key and so
    // invalidates only that model's explanations.
    key: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("file"), v.literal("folder"))),
    model: v.optional(v.string()),
    // Every path the model was handed to write this. The invented-path check
    // tests the text against exactly this set; absent on older rows.
    shown: v.optional(v.array(v.string())),
  })
    .index("by_org", ["orgId"])
    .index("by_org_analysis", ["orgId", "analysisId"])
    .index("by_org_analysis_key", ["orgId", "analysisId", "key"]),

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
