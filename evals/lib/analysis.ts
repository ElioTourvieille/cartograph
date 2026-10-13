import { convexAll, convexRun } from "./convex.ts";

// A stored analysis, as the evaluations see it. Read only through the internal
// functions that take an explicit organization, so an analysis that is not that
// organization's is refused by Convex and never reaches a dataset.

export type StoredAnalysis = {
  id: string;
  repo: string;
  commitSha: string;
  files: { path: string; lines: number; hash: string }[];
  edges: { from: string; to: string }[];
  roles: { path: string; role: string; source: "adapter" | "model" }[];
};

export type AnalysisSummary = {
  id: string;
  repo: string | null;
  status: string;
  commitSha: string | null;
};

const isSummaries = (v: unknown): v is AnalysisSummary[] => Array.isArray(v);

export function listAnalyses(orgId: string): AnalysisSummary[] {
  const result = convexRun("evalData:analyses", { orgId });
  return isSummaries(result) ? result : [];
}

export function loadAnalysis(orgId: string, summary: AnalysisSummary): StoredAnalysis {
  if (summary.repo === null || summary.commitSha === null) {
    throw new Error(`L'analyse ${summary.id} n'a pas de dépôt ou de commit enregistré.`);
  }
  const args = { orgId, analysisId: summary.id };
  return {
    id: summary.id,
    repo: summary.repo,
    commitSha: summary.commitSha,
    files: convexAll("evalData:files", args),
    edges: convexAll("evalData:edges", args),
    roles: convexAll("evalData:roles", args),
  };
}

/** Files a file imports and files that import it, each listed once, sorted. */
export function neighbours(analysis: StoredAnalysis, path: string) {
  const imports = new Set<string>();
  const dependents = new Set<string>();
  for (const e of analysis.edges) {
    if (e.from === path && e.to !== path) imports.add(e.to);
    if (e.to === path && e.from !== path) dependents.add(e.from);
  }
  return { imports: [...imports].sort(), dependents: [...dependents].sort() };
}
