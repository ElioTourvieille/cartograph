import { fetchMutation, fetchQuery } from "convex/nextjs";
import { traceable } from "langsmith/traceable";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { accessOf, tokenFor } from "@/lib/github/access";
import { AiError, privateTracing } from "./client";
import { classifyBatch } from "./classify-core";
import { loadGraph, neighboursOf } from "./context";
import { CLASSIFY_MODEL, PROMPT_VERSION } from "./models";
import { fetchSource } from "./source";

// Giving a role to the files no adapter could identify. The request itself, and
// the rule that only non-structural roles may come back, are in
// classify-core.ts: it is shared with the role evaluation so that the accuracy
// number is measured on exactly this request. This file is the application
// side: which files, read under whose token, and where the answers are stored.

const BATCH = 25; // files per request
const PER_CALL = 100; // files looked at per click

export type Classification = {
  /** Roles stored. */
  saved: number;
  /** Files looked at in this call. */
  scanned: number;
  /** Files the model gave no role to, or whose role was refused. */
  skipped: number;
  /** Where the next call should resume from. */
  next: number;
  /** Files with no role that have not been looked at yet. */
  remaining: number;
};

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function classifyUnidentified(
  token: string,
  input: { analysisId: Id<"analyses">; skip: number },
): Promise<Classification> {
  // Private or public, read off the analysis row under the person's token.
  const access = await accessOf(token, input.analysisId);
  // The token stays in this closure: a traced function records its arguments.
  const run = traceable(
    async (args: { analysisId: Id<"analyses">; skip: number }): Promise<Classification> => {
      const { analysisId, skip } = args;
      const progress = await fetchQuery(api.analyses.progress, { analysisId }, { token });
      if (progress === null || progress.repo === null || progress.commitSha === null) {
        throw new AiError("L'analyse n'a pas de commit enregistré.");
      }
      const [owner, name] = progress.repo.split("/");
      const commit = progress.commitSha;

      const graph = await loadGraph(token, analysisId);
      const unidentified = graph.files
        .filter((f) => !graph.roles.has(f.path))
        .map((f) => f.path)
        .sort();
      const todo = unidentified.slice(skip, skip + PER_CALL);

      // One token for this call's reads of a private repository, minted now and
      // dropped with the call. Public repositories use none.
      const ghToken = todo.length === 0 ? undefined : await tokenFor(access);

      let saved = 0;
      let skipped = 0;
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        const heads = await mapLimit(batch, 8, (path) =>
          fetchSource(owner, name, commit, path, ghToken),
        );
        const readable = batch.filter((_, k) => heads[k] !== null);
        skipped += batch.length - readable.length;
        if (readable.length === 0) continue;

        const valid = await classifyBatch(
          readable.map((path) => ({
            path,
            imports: neighboursOf(graph, path).imports,
            head: heads[batch.indexOf(path)] ?? "",
          })),
          { private: access.private },
        );
        skipped += readable.length - valid.length;
        if (valid.length === 0) continue;

        // The store function checks the allowed set once more, and refuses a
        // file that already has a role.
        const result = await fetchMutation(
          api.explanations.saveInferredRoles,
          { analysisId, roles: valid },
          { token },
        );
        saved += result.saved;
        skipped += result.rejected;
      }

      const next = skip + todo.length;
      return {
        saved,
        scanned: todo.length,
        skipped,
        next,
        remaining: Math.max(0, unidentified.length - next),
      };
    },
    {
      name: "classify-files",
      run_type: "chain",
      ...(access.private ? { client: privateTracing() } : {}),
      tags: ["classify", ...(access.private ? ["private"] : [])],
      metadata: { model: CLASSIFY_MODEL, promptVersion: PROMPT_VERSION },
    },
  );
  return run(input);
}
