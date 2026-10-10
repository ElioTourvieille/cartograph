import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

// Rows for two organizations, because nothing creates a real one yet. Internal,
// so it is never reachable from the browser. Pass the two Clerk organization
// ids (org_...) you sign in with:
//   npx convex run seed:seedTwoOrgs '{"orgA":"org_...","orgB":"org_..."}'
// An organization that already has a project is skipped; delete it first with
// orgData:deleteOrgData to seed it again. Every table gets at least one row per
// organization so the by-id check has something to ask for in each.
export const seedTwoOrgs = internalMutation({
  args: { orgA: v.string(), orgB: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { orgA, orgB }) => {
    if (orgA === orgB) throw new Error("Les deux organisations doivent différer.");
    return [
      await seedOrg(ctx, orgA, "seed-a", [
        { name: "storefront", status: "complete" },
        { name: "api", status: "parsing" },
        { name: "legacy", status: "failed", error: "Dépôt introuvable ou privé." },
      ]),
      await seedOrg(ctx, orgB, "seed-b", [
        { name: "dashboard", status: "complete" },
        { name: "worker", status: "queued" },
      ]),
    ];
  },
});

type SeedAnalysis = {
  name: string;
  status: "queued" | "parsing" | "complete" | "failed";
  error?: string;
};

async function seedOrg(
  ctx: MutationCtx,
  orgId: string,
  owner: string,
  analyses: SeedAnalysis[],
): Promise<string> {
  const existing = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  if (existing !== null) return `${orgId} : déjà semée, ignorée`;

  let firstComplete: Awaited<ReturnType<typeof insertAnalysis>> | null = null;
  for (const a of analyses) {
    const analysisId = await insertAnalysis(ctx, orgId, owner, a);
    if (a.status === "complete" && firstComplete === null) firstComplete = analysisId;
  }
  if (firstComplete === null) throw new Error("Il faut une analyse terminée.");

  const analysisId = firstComplete;
  await ctx.db.insert("files", {
    orgId,
    analysisId,
    path: "src/index.ts",
    folder: "src",
    lines: 1,
    contentHash: "seed",
  });
  await ctx.db.insert("edges", {
    orgId,
    analysisId,
    fromPath: "src/index.ts",
    toPath: "src/app.ts",
    kind: "import",
  });
  await ctx.db.insert("routes", {
    orgId,
    analysisId,
    method: "GET",
    pattern: "/",
    filePath: "src/index.ts",
  });
  await ctx.db.insert("explanations", {
    orgId,
    analysisId,
    filePath: "src/index.ts",
    contentHash: "seed",
    text: "Ligne de test semée.",
  });
  await ctx.db.insert("fileRoles", {
    orgId,
    analysisId,
    filePath: "src/index.ts",
    role: "Page",
    source: "adapter",
  });
  await ctx.db.insert("insights", {
    orgId,
    analysisId,
    kind: "seed",
    filePaths: ["src/index.ts"],
  });
  return `${orgId} : ${analyses.length} analyses semées`;
}

async function insertAnalysis(
  ctx: MutationCtx,
  orgId: string,
  owner: string,
  a: SeedAnalysis,
) {
  const projectId = await ctx.db.insert("projects", {
    orgId,
    repoUrl: `https://github.com/${owner}/${a.name}`,
    owner,
    name: a.name,
  });
  return ctx.db.insert("analyses", {
    orgId,
    projectId,
    status: a.status,
    ...(a.error === undefined ? {} : { error: a.error }),
  });
}
