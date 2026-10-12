import type Anthropic from "@anthropic-ai/sdk";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { traceable } from "langsmith/traceable";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { INFERABLE_ROLES } from "@/graph/taxonomy";
import { AiError, ai } from "./client";
import { loadGraph, neighboursOf } from "./context";
import { CLASSIFY_MODEL, PROMPT_VERSION } from "./models";
import { fetchSource } from "./source";

// Giving a role to the files no adapter could identify. The model may only
// answer with a role that is NOT structural: service, repository, model, util,
// config, component or hook. Never page, route or controller, because those
// decide the route table and which files the framework reaches by itself, and
// convention owns them. That is enforced twice: the request is shaped so the
// answer can only be one of the allowed roles, and the answer is checked
// against the same list in code (and again by the function that stores it).

const BATCH = 25; // files per request
const PER_CALL = 100; // files looked at per click
const HEAD_CHARS = 1_500; // how much of each file the model sees

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

const SYSTEM = `Tu classes des fichiers de code d'un dépôt selon leur rôle. Pour chaque fichier fourni, appelle l'outil assign_roles avec le rôle qui convient.
Rôles possibles : service (logique métier), repository (accès aux données), model (structure de données, entité, schéma, type), util (fonctions utilitaires), config (configuration), component (composant d'interface), hook (hook React).
Si aucun rôle ne convient clairement, n'assigne rien à ce fichier : ne devine pas. Tu n'as pas le droit d'inventer un autre rôle.`;

const TOOL: Anthropic.Tool = {
  name: "assign_roles",
  description: "Assigne un rôle à chacun des fichiers pour lesquels un rôle convient clairement.",
  input_schema: {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            // The allowed set is the shape of the answer, not a polite request.
            role: { type: "string", enum: [...INFERABLE_ROLES] },
          },
          required: ["path", "role"],
        },
      },
    },
    required: ["assignments"],
  },
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// What came back, as {path, role} pairs, or nothing if it is not that shape.
function readAssignments(input: unknown): { path: string; role: string }[] {
  if (!isRecord(input) || !Array.isArray(input.assignments)) return [];
  const out: { path: string; role: string }[] = [];
  for (const item of input.assignments) {
    if (isRecord(item) && typeof item.path === "string" && typeof item.role === "string") {
      out.push({ path: item.path, role: item.role });
    }
  }
  return out;
}

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

      let saved = 0;
      let skipped = 0;
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        const heads = await mapLimit(batch, 8, (path) => fetchSource(owner, name, commit, path));
        const readable = batch.filter((_, k) => heads[k] !== null);
        skipped += batch.length - readable.length;
        if (readable.length === 0) continue;

        const described = readable
          .map((path) => {
            const { imports } = neighboursOf(graph, path);
            const head = (heads[batch.indexOf(path)] ?? "").slice(0, HEAD_CHARS);
            return [
              `### ${path}`,
              `Importe : ${imports.length === 0 ? "(rien)" : imports.slice(0, 12).join(", ")}`,
              head,
            ].join("\n");
          })
          .join("\n\n");

        const message = await ai().messages.create({
          model: CLASSIFY_MODEL,
          max_tokens: 1500,
          system: SYSTEM,
          tools: [TOOL],
          tool_choice: { type: "tool", name: TOOL.name },
          messages: [{ role: "user", content: described }],
        });
        const use = message.content.find((block) => block.type === "tool_use");
        const answered = use === undefined ? [] : readAssignments(use.input);

        // Checked again in code, whatever the schema promised: only paths of
        // this batch, only allowed roles. The store function checks once more.
        const asked = new Set(readable);
        const allowed = new Set<string>(INFERABLE_ROLES);
        const valid = answered.filter((a) => asked.has(a.path) && allowed.has(a.role));
        skipped += readable.length - valid.length;
        if (valid.length === 0) continue;

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
      tags: ["classify"],
      metadata: { model: CLASSIFY_MODEL, promptVersion: PROMPT_VERSION },
    },
  );
  return run(input);
}
