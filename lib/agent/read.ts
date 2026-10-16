import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { StoredCoverage } from "@/graph/coverage";
import { assembleGraph } from "@/graph/assemble";
import type { Graph } from "@/graph/types";
import { READ_PAGE } from "@/convex/lib/limits";
import { collect } from "@/lib/ai/context";
import { claimedAnalysis } from "./credential";

// How the tools read an analysis. The credential is handed to Convex as the
// token, so the read goes through the same organization-scoping builders as
// every other read, narrowed to the one analysis the credential names. There is
// no second path to the data here and no key that reads more.

/** The credential did not get us the analysis. Says nothing about why. */
export class Refused extends Error {}
export class NotReady extends Error {}

export type Loaded = { graph: Graph; coverage: StoredCoverage | null };

// Assembling an analysis is several paged reads, and one question makes three
// or four tool calls. The result is kept briefly, but never ahead of the check:
// every call asks Convex for the analysis row under the credential FIRST, and
// only then may the kept copy be used. The key includes when the analysis last
// changed, so a re-run is never answered from the old rows.
const KEEP = 4;
const kept = new Map<string, Loaded>();

export async function loadForCredential(token: string): Promise<Loaded> {
  const analysisId = claimedAnalysis(token);
  if (analysisId === null) throw new Refused();

  // Convex verifies the signature, the issuer and the expiry here. A forged,
  // expired or foreign credential throws; a credential for another
  // organization's analysis reads null.
  const progress = await fetchQuery(api.analyses.progress, { analysisId }, { token });
  if (progress === null) throw new Refused();
  // A private analysis is never read for the agent (see app/api/agent/ask).
  if (progress.access !== null) throw new Refused();
  if (progress.status !== "complete") throw new NotReady();

  const key = `${progress.id}:${progress.updatedAt}`;
  const hit = kept.get(key);
  if (hit !== undefined) return hit;

  const args = (cursor: string | null) => ({
    analysisId,
    paginationOpts: { numItems: READ_PAGE, cursor },
  });
  const [files, edges, roles, routes] = await Promise.all([
    collect((c) => fetchQuery(api.graph.files, args(c), { token })),
    collect((c) => fetchQuery(api.graph.edges, args(c), { token })),
    collect((c) => fetchQuery(api.graph.roles, args(c), { token })),
    collect((c) => fetchQuery(api.graph.routes, args(c), { token })),
  ]);
  const loaded: Loaded = {
    graph: assembleGraph({
      repo: progress.repo,
      frameworks: progress.frameworks,
      files,
      edges,
      roles,
      routes,
    }),
    coverage: progress.coverage,
  };

  kept.set(key, loaded);
  while (kept.size > KEEP) {
    const oldest = kept.keys().next().value;
    if (oldest === undefined) break;
    kept.delete(oldest);
  }
  return loaded;
}
