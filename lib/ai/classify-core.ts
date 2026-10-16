import type Anthropic from "@anthropic-ai/sdk";
import { INFERABLE_ROLES } from "../../graph/taxonomy.ts";
import { ai } from "./client.ts";
import { CLASSIFY_MODEL } from "./models.ts";

// The one call that gives roles to files, and nothing else: the application
// uses it for the files no adapter could identify, and the role evaluation uses
// it on files whose role is known, so the number it produces is measured on the
// exact request that runs in production. Relative imports only, so a script
// outside the web app can run it.
//
// The model may only answer with a role that is NOT structural: service,
// repository, model, util, config, component or hook. Never page, route or
// controller, which decide the route table and which files the framework
// reaches by itself. That is enforced twice: the request is shaped so the
// answer can only be one of the allowed roles, and the answer is checked
// against the same list in code.

/** What the model is told about one file. Nothing here says what the file's role is. */
export type ClassifyItem = {
  path: string;
  /** Paths this file imports. Paths only: never a role. */
  imports: readonly string[];
  /** The start of the file. */
  head: string;
};

export type Assigned = { path: string; role: string };

const HEAD_CHARS = 1_500;

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
function readAssignments(input: unknown): Assigned[] {
  if (!isRecord(input) || !Array.isArray(input.assignments)) return [];
  const out: Assigned[] = [];
  for (const item of input.assignments) {
    if (isRecord(item) && typeof item.path === "string" && typeof item.role === "string") {
      out.push({ path: item.path, role: item.role });
    }
  }
  return out;
}

/**
 * One request for up to a few dozen files. Returns only answers that name a
 * file of the batch with an allowed role; anything else is dropped here, after
 * the answer, whatever the schema promised.
 */
export async function classifyBatch(
  items: readonly ClassifyItem[],
  options: { private?: boolean } = {},
): Promise<Assigned[]> {
  if (items.length === 0) return [];
  const described = items
    .map((item) =>
      [
        `### ${item.path}`,
        `Importe : ${item.imports.length === 0 ? "(rien)" : item.imports.slice(0, 12).join(", ")}`,
        item.head.slice(0, HEAD_CHARS),
      ].join("\n"),
    )
    .join("\n\n");

  // A private repository's file heads go to the model like any other, but the
  // call is traced through the masked client: no prompt, no answer in the store.
  const message = await ai({ private: options.private === true }).messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 1500,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: described }],
  });
  const use = message.content.find((block) => block.type === "tool_use");
  const answered = use === undefined ? [] : readAssignments(use.input);

  const asked = new Set(items.map((item) => item.path));
  const allowed = new Set<string>(INFERABLE_ROLES);
  return answered.filter((a) => asked.has(a.path) && allowed.has(a.role));
}
