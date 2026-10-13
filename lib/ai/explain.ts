import { fetchMutation, fetchQuery } from "convex/nextjs";
import { Client } from "langsmith";
import { getCurrentRunTree, traceable } from "langsmith/traceable";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AiError, ai } from "./client";
import { loadGraph, neighboursOf, roleLabel } from "./context";
import { checkPaths } from "./invented";
import { EXPLAIN_MODEL, PROMPT_VERSION } from "./models";
import {
  FILE_SYSTEM,
  FOLDER_FILES_LISTED,
  FOLDER_SYSTEM,
  fileUserPrompt,
  folderUserPrompt,
  type Neighbour,
} from "./prompts";
import { fetchSource, MAX_SOURCE_CHARS, sha256 } from "./source";

// Explaining a file, and explaining a folded folder. Two different questions,
// two prompts. What the model may do is explain; it may not decide that two
// files are connected and it may not walk the graph: every path in a prompt was
// read from the stored analysis and handed to it.
//
// The cache is OURS: Convex rows keyed on the content of what is explained, the
// model and the prompt version. It has nothing to do with the provider's prompt
// caching, which is not used here, and nothing below should be named as if it
// did. The cache read happens INSIDE the traced function, so a hit is a
// recorded run with no model call in it, and a broken cache is visible as a
// run that does call the model.
//
// Every explanation that is freshly written is also checked, in the same traced
// run, for paths the model was never shown. That is the live form of the
// invented-path evaluator: it scores real traffic as it happens, and the score
// is attached to the run as feedback.

export type Explanation = {
  text: string;
  cached: boolean;
  model: string;
  /** Paths in the text the model was not shown; null when not checked (a cache hit). */
  invented: string[] | null;
};

const keyOf = (kind: "file" | "folder", subject: string, hash: string): string =>
  `${kind}|${subject}|${hash}|${EXPLAIN_MODEL}|${PROMPT_VERSION}`;

const withRole = (graph: Parameters<typeof roleLabel>[0], paths: readonly string[]): Neighbour[] =>
  paths.map((path) => ({ path, role: roleLabel(graph, path) }));

async function generate(system: string, user: string): Promise<string> {
  const message = await ai().messages.create({
    model: EXPLAIN_MODEL,
    max_tokens: 700,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  if (text === "") throw new AiError("Le modèle n'a renvoyé aucune explication.");
  return text;
}

let feedbackClient: Client | undefined;

// The live evaluator. Deterministic: set membership against the paths shown.
// Attached to the current run when tracing is on; the score is returned either
// way so the run's output carries it too.
async function scoreLive(text: string, shown: readonly string[]): Promise<string[]> {
  const check = checkPaths(text, new Set(shown));
  const run = getCurrentRunTree(true);
  if (run !== undefined) {
    try {
      feedbackClient ??= new Client();
      await feedbackClient.createFeedback(run.id, "invented_paths", {
        score: check.score,
        comment:
          check.invented.length === 0
            ? `${check.tokens.length} chemins cités, aucun inventé.`
            : `Inventés : ${check.invented.join(", ")}`,
      });
    } catch {
      // Scoring must never break an explanation.
    }
  }
  return check.invented;
}

// --- a file -------------------------------------------------------------------

export async function explainFile(
  token: string,
  input: { analysisId: Id<"analyses">; path: string },
): Promise<Explanation> {
  // Built per call so the token stays in this closure: a traced function
  // records its arguments, and a token must never be one of them.
  const run = traceable(
    async (args: { analysisId: Id<"analyses">; path: string }): Promise<Explanation> => {
      const { analysisId, path } = args;
      const [stored] = await fetchQuery(
        api.explanations.hashes,
        { analysisId, paths: [path] },
        { token },
      );
      if (stored === undefined) throw new AiError("Ce fichier n'est pas dans l'analyse.");

      // The cache read, inside the traced call.
      const key = keyOf("file", path, stored.hash);
      const hit = await fetchQuery(api.explanations.cached, { analysisId, key }, { token });
      if (hit !== null) {
        return { text: hit.text, cached: true, model: hit.model ?? EXPLAIN_MODEL, invented: null };
      }

      const progress = await fetchQuery(api.analyses.progress, { analysisId }, { token });
      if (progress === null || progress.repo === null || progress.commitSha === null) {
        throw new AiError("L'analyse n'a pas de commit enregistré.");
      }
      const [owner, name] = progress.repo.split("/");
      const [graph, source] = await Promise.all([
        loadGraph(token, analysisId),
        fetchSource(owner, name, progress.commitSha, path),
      ]);
      if (source === null) {
        throw new AiError("Le fichier n'a pas pu être relu depuis GitHub.");
      }
      const { imports, dependents } = neighboursOf(graph, path);

      const built = fileUserPrompt({
        path,
        role: roleLabel(graph, path),
        repo: progress.repo,
        imports: withRole(graph, imports),
        dependents: withRole(graph, dependents),
        source: source.slice(0, MAX_SOURCE_CHARS),
        clipped: source.length > MAX_SOURCE_CHARS,
      });
      const text = await generate(FILE_SYSTEM, built.text);
      const invented = await scoreLive(text, built.shown);

      await fetchMutation(
        api.explanations.save,
        {
          analysisId,
          key,
          kind: "file",
          subject: path,
          contentHash: stored.hash,
          model: EXPLAIN_MODEL,
          text,
          shown: built.shown,
        },
        { token },
      );
      return { text, cached: false, model: EXPLAIN_MODEL, invented };
    },
    {
      name: "explain-file",
      run_type: "chain",
      tags: ["explain", "file"],
      metadata: { model: EXPLAIN_MODEL, promptVersion: PROMPT_VERSION },
    },
  );
  return run(input);
}

// --- a folded folder ------------------------------------------------------------

export async function explainFolder(
  token: string,
  input: { analysisId: Id<"analyses">; folderId: string; paths: string[] },
): Promise<Explanation> {
  const run = traceable(
    async (args: {
      analysisId: Id<"analyses">;
      folderId: string;
      paths: string[];
    }): Promise<Explanation> => {
      const { analysisId, folderId } = args;
      const paths = [...new Set(args.paths)].sort();
      if (paths.length === 0) throw new AiError("Ce dossier ne contient aucun fichier.");

      // Every path must be one of this analysis's files; what the folder
      // "contains" is decided by the stored rows, not by the request.
      const stored = await fetchQuery(
        api.explanations.hashes,
        { analysisId, paths },
        { token },
      );
      if (stored.length !== paths.length) {
        throw new AiError("Des fichiers de ce dossier ne sont pas dans l'analyse.");
      }
      const hash = sha256(
        stored
          .map((s) => `${s.path}:${s.hash}`)
          .sort()
          .join("\n"),
      );

      const key = keyOf("folder", folderId, hash);
      const hit = await fetchQuery(api.explanations.cached, { analysisId, key }, { token });
      if (hit !== null) {
        return { text: hit.text, cached: true, model: hit.model ?? EXPLAIN_MODEL, invented: null };
      }

      const graph = await loadGraph(token, analysisId);
      const inside = new Set(paths);
      const fromOutside = new Map<string, number>();
      const intoFile = new Map<string, number>();
      const towards = new Map<string, number>();
      let internal = 0;
      for (const e of graph.edges) {
        const fromIn = inside.has(e.from);
        const toIn = inside.has(e.to);
        if (fromIn && toIn) internal++;
        else if (!fromIn && toIn) {
          fromOutside.set(e.from, (fromOutside.get(e.from) ?? 0) + 1);
          intoFile.set(e.to, (intoFile.get(e.to) ?? 0) + 1);
        } else if (fromIn && !toIn) {
          towards.set(e.to, (towards.get(e.to) ?? 0) + 1);
        }
      }
      const top = (m: Map<string, number>, n: number): [string, number][] =>
        [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);

      const byRole = new Map<string, number>();
      let lines = 0;
      for (const f of graph.files) {
        if (!inside.has(f.path)) continue;
        lines += f.lines;
        const role = roleLabel(graph, f.path) ?? "sans rôle identifié";
        byRole.set(role, (byRole.get(role) ?? 0) + 1);
      }

      const built = folderUserPrompt({
        folderId,
        fileCount: paths.length,
        lines,
        internalImports: internal,
        byRole: [...byRole],
        files: withRole(graph, paths.slice(0, FOLDER_FILES_LISTED)),
        incomingTotal: [...fromOutside.values()].reduce((a, b) => a + b, 0),
        incomingFrom: fromOutside.size,
        topInto: top(intoFile, 10),
        topFrom: top(fromOutside, 12),
        topTowards: top(towards, 10),
      });
      const text = await generate(FOLDER_SYSTEM, built.text);
      const invented = await scoreLive(text, built.shown);

      await fetchMutation(
        api.explanations.save,
        {
          analysisId,
          key,
          kind: "folder",
          subject: folderId,
          contentHash: hash,
          model: EXPLAIN_MODEL,
          text,
          shown: built.shown,
        },
        { token },
      );
      return { text, cached: false, model: EXPLAIN_MODEL, invented };
    },
    {
      name: "explain-folder",
      run_type: "chain",
      tags: ["explain", "folder"],
      metadata: { model: EXPLAIN_MODEL, promptVersion: PROMPT_VERSION },
    },
  );
  return run(input);
}
