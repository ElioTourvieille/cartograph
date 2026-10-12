import { ConvexError, v } from "convex/values";
import { INFERABLE_ROLES, inferredRoleId } from "../graph/taxonomy";
import { orgMutation, orgQuery } from "./lib/org";

// The cache of the model's work, and where its answers are written back. All of
// it is org-scoped like every other public function: the organization is read
// off the verified token, so one organization never reads another's
// explanations, and the pipeline's secret is nowhere near this file.

const MAX_TEXT = 12_000;

// Read inside the traced call, so a hit shows up as a recorded run with no
// model call in it. Keyed on content, model and prompt version, by the caller.
export const cached = orgQuery({
  args: { analysisId: v.id("analyses"), key: v.string() },
  returns: v.union(
    v.null(),
    v.object({ text: v.string(), model: v.union(v.string(), v.null()) }),
  ),
  handler: async (ctx, { analysisId, key }) => {
    const analysis = await ctx.db.get("analyses", analysisId);
    if (analysis === null) return null;
    const found = await ctx.db.explanationByKey(analysisId, key);
    return found === null ? null : { text: found.text, model: found.model ?? null };
  },
});

export const save = orgMutation({
  args: {
    analysisId: v.id("analyses"),
    key: v.string(),
    kind: v.union(v.literal("file"), v.literal("folder")),
    // The file's path, or the folder's id.
    subject: v.string(),
    contentHash: v.string(),
    model: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { analysisId, key, kind, subject, contentHash, model, text }) => {
    const analysis = await ctx.db.get("analyses", analysisId);
    if (analysis === null) throw new ConvexError("Analyse introuvable.");
    if (text.length === 0 || text.length > MAX_TEXT) {
      throw new ConvexError("Explication vide ou trop longue.");
    }
    // One row per key: a second write for the same content replaces the first.
    const previous = await ctx.db.explanationByKey(analysisId, key);
    if (previous !== null) await ctx.db.delete("explanations", previous._id);
    await ctx.db.insertExplanation({
      analysisId,
      filePath: subject,
      contentHash,
      text,
      key,
      kind,
      model,
    });
    return null;
  },
});

// Roles a model deduced for files no adapter named. The allowed set is checked
// here as well as in the shape of the request, and a file that already has a
// role is left alone: convention owns the structural ones, and a deduced role
// never overrides it.
export const saveInferredRoles = orgMutation({
  args: {
    analysisId: v.id("analyses"),
    roles: v.array(v.object({ path: v.string(), role: v.string() })),
  },
  returns: v.object({ saved: v.number(), rejected: v.number() }),
  handler: async (ctx, { analysisId, roles }) => {
    const analysis = await ctx.db.get("analyses", analysisId);
    if (analysis === null) throw new ConvexError("Analyse introuvable.");
    if (analysis.status !== "complete") {
      throw new ConvexError("L'analyse n'est pas terminée.");
    }
    if (roles.length > 100) throw new ConvexError("Trop de rôles en un appel.");

    const rows = ctx.db.inAnalysis(analysisId);
    const files = new Set((await rows.files().take(8_000)).map((f) => f.path));
    const named = new Set((await rows.fileRoles().take(8_000)).map((r) => r.filePath));

    let saved = 0;
    let rejected = 0;
    for (const { path, role } of roles) {
      // find() narrows the string to one of the allowed literals, no cast.
      const inferable = INFERABLE_ROLES.find((r) => r === role);
      if (inferable === undefined || !files.has(path) || named.has(path)) {
        rejected++;
        continue;
      }
      await ctx.db.insertFileRole({
        analysisId,
        filePath: path,
        role: inferredRoleId(inferable),
        source: "model",
      });
      named.add(path);
      saved++;
    }
    return { saved, rejected };
  },
});

// The stored content hashes of some files of an analysis. What an explanation
// is keyed on comes from here, from the server's own rows, never from the
// browser: the browser says which files, the stored analysis says what they
// contain.
export const hashes = orgQuery({
  args: { analysisId: v.id("analyses"), paths: v.array(v.string()) },
  returns: v.array(v.object({ path: v.string(), hash: v.string() })),
  handler: async (ctx, { analysisId, paths }) => {
    if (paths.length > 600) throw new ConvexError("Trop de fichiers demandés.");
    const analysis = await ctx.db.get("analyses", analysisId);
    if (analysis === null || analysis.status !== "complete") return [];
    const wanted = new Set(paths);
    const rows = await ctx.db.inAnalysis(analysisId).files().take(8_000);
    return rows
      .filter((r) => wanted.has(r.path))
      .map((r) => ({ path: r.path, hash: r.contentHash }));
  },
});
