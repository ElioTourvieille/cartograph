import { ConvexError, v } from "convex/values";
import { claimMutation, orgMutation, orgQuery } from "./lib/org";

// The GitHub App installations an organization has connected. A row holds an
// installation's id and its account, never a token or a key: reading a private
// repository takes a token that is minted for one run and thrown away.
//
// Every function here is built from the org-scoping builders, so a request
// from another organization that names one of these ids finds nothing, exactly
// as if the id did not exist.

const CAP = 50;

const installationShape = v.object({
  id: v.id("installations"),
  account: v.string(),
  connectedAt: v.number(),
  /** Disconnected here, or reported gone by GitHub. */
  removed: v.boolean(),
});

export const list = orgQuery({
  args: {},
  returns: v.array(installationShape),
  handler: async (ctx) => {
    const rows = await ctx.db.installations().order("desc").take(CAP);
    return rows.map((r) => ({
      id: r._id,
      account: r.account,
      connectedAt: r.connectedAt,
      removed: r.removedAt !== undefined,
    }));
  },
});

// What a server function needs to act for an analysis's repository: GitHub's id
// for the installation it was made through, read off the analysis row. Null for
// an analysis of a public repository. The id is read here, under the person's
// verified token; it is never supplied by the caller.
export const forAnalysis = orgQuery({
  args: { analysisId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ githubId: v.number(), account: v.string(), removed: v.boolean() }),
  ),
  handler: async (ctx, { analysisId }) => {
    const id = ctx.db.normalizeId("analyses", analysisId);
    if (id === null) return null;
    const analysis = await ctx.db.get("analyses", id);
    if (analysis === null || analysis.installationId === undefined) return null;
    const installation = await ctx.db.get("installations", analysis.installationId);
    if (installation === null) return null;
    return {
      githubId: installation.githubId,
      account: installation.account,
      removed: installation.removedAt !== undefined,
    };
  },
});

// For the server's own use when it needs to mint a token for a repository the
// person picked: only this organization's installations, only the connected
// ones.
export const active = orgQuery({
  args: {},
  returns: v.array(
    v.object({ id: v.id("installations"), githubId: v.number(), account: v.string() }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.installations().order("desc").take(CAP);
    return rows
      .filter((r) => r.removedAt === undefined)
      .map((r) => ({ id: r._id, githubId: r.githubId, account: r.account }));
  },
});

// Stops new runs through this installation. Analyses made through it stay: they
// hold paths and edges only.
export const disconnect = orgMutation({
  args: { id: v.id("installations") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const installation = await ctx.db.get("installations", id);
    if (installation === null) throw new ConvexError("Installation introuvable.");
    if (installation.removedAt === undefined) {
      await ctx.db.patchInstallation(id, { removedAt: Date.now() });
    }
    return null;
  },
});

// Records the installation GitHub just sent the person back from, against the
// organization of their verified token. It needs the server's secret as well,
// so only our server can call it, after it has checked the signed state, the
// cookie and GitHub itself. An installation already connected by another
// organization is refused, and the answer does not say whose it is.
//
// GitHub sends the person back with an installation id that anyone could write
// by hand, and proving it is theirs would take a GitHub user token, which this
// app never asks for. So an installation can only be claimed while it is free
// AND was created in the last few minutes: the real return comes seconds after
// the installation, and an old one nobody here has claimed cannot be taken by
// guessing its id. Connecting again an installation that is already this
// organization's is always allowed.
const FRESH_MS = 10 * 60_000;

export const claim = claimMutation({
  args: { githubId: v.number(), account: v.string(), githubCreatedAt: v.number() },
  returns: v.object({ id: v.id("installations") }),
  handler: async (ctx, { githubId, account, githubCreatedAt }) => {
    const state = await ctx.claimState(githubId);
    if (state === "other") {
      throw new ConvexError(
        "Cette installation GitHub est déjà connectée à une autre organisation.",
      );
    }
    if (state === "free" && Date.now() - githubCreatedAt > FRESH_MS) {
      throw new ConvexError(
        "Cette installation date de plus de dix minutes : désinstallez l'App sur GitHub, puis recommencez depuis ici.",
      );
    }
    const existing = await ctx.db.installationByGithubId(githubId);
    if (existing !== null) {
      // Connecting again after a disconnect, or after adding repositories.
      await ctx.db.patchInstallation(existing._id, { account, removedAt: undefined });
      return { id: existing._id };
    }
    const id = await ctx.db.insertInstallation({
      githubId,
      account,
      connectedAt: Date.now(),
    });
    return { id };
  },
});
