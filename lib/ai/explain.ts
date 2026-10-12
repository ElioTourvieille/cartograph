import { fetchMutation, fetchQuery } from "convex/nextjs";
import { traceable } from "langsmith/traceable";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AiError, ai } from "./client";
import { loadGraph, neighboursOf, roleLabel, type Loaded } from "./context";
import { EXPLAIN_MODEL, PROMPT_VERSION } from "./models";
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

export type Explanation = { text: string; cached: boolean; model: string };

// The prompt permits exactly three pieces of formatting, because the pane is
// narrow and the renderer draws exactly these: inline code, bold, bullets.
const FORMAT_RULES = `Mise en forme : uniquement du \`code en ligne\`, du **gras** et des puces qui commencent par "- ". Jamais de titre, de tableau, de bloc de code ni de lien. Cite chaque fichier par son chemin exact, en code en ligne. N'écris jamais un chemin qui ne figure pas dans les listes fournies.`;

const FILE_SYSTEM = `Tu aides un développeur à comprendre un dépôt qu'il ne connaît pas. Réponds en français, en un ou deux courts paragraphes (120 mots au plus).
Explique ce que fait le fichier donné, dans le contexte de ses voisins réels : les fichiers qu'il importe et ceux qui l'importent, dont la liste complète t'est fournie. Dis à quoi il sert pour eux et ce qu'ils attendent de lui.
Ne prétends jamais que deux fichiers sont liés si les listes ne le montrent pas. Ne juge pas la qualité du code, ne note rien, ne propose pas de correction.
${FORMAT_RULES}`;

const FOLDER_SYSTEM = `Tu aides un développeur à comprendre un dépôt qu'il ne connaît pas. Réponds en français, en un ou deux courts paragraphes (140 mots au plus).
On te décrit un dossier : ce qu'il contient, ce qui l'importe de l'extérieur et ce qu'il importe. Réponds à deux questions : qu'y a-t-il là-dedans, et pourquoi tant de fichiers pointent-ils vers lui. Appuie-toi sur les nombres fournis, sans en inventer.
Parle du dossier, pas d'un seul fichier qu'il contient. Ne juge pas la qualité du code, ne note rien.
${FORMAT_RULES}`;

const keyOf = (kind: "file" | "folder", subject: string, hash: string): string =>
  `${kind}|${subject}|${hash}|${EXPLAIN_MODEL}|${PROMPT_VERSION}`;

const list = (paths: readonly string[], graph: Loaded): string =>
  paths.length === 0
    ? "(aucun)"
    : paths
        .map((p) => {
          const role = roleLabel(graph, p);
          return role === null ? `- ${p}` : `- ${p} (${role})`;
        })
        .join("\n");

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
        return { text: hit.text, cached: true, model: hit.model ?? EXPLAIN_MODEL };
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
      const clipped = source.length > MAX_SOURCE_CHARS;
      const role = roleLabel(graph, path);

      const text = await generate(
        FILE_SYSTEM,
        [
          `Fichier : ${path}${role === null ? "" : ` (${role})`}`,
          `Dépôt : ${progress.repo}`,
          ``,
          `Fichiers qu'il importe (${imports.length}) :`,
          list(imports, graph),
          ``,
          `Fichiers qui l'importent (${dependents.length}) :`,
          list(dependents, graph),
          ``,
          `Contenu${clipped ? " (tronqué)" : ""} :`,
          source.slice(0, MAX_SOURCE_CHARS),
        ].join("\n"),
      );

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
        },
        { token },
      );
      return { text, cached: false, model: EXPLAIN_MODEL };
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
        return { text: hit.text, cached: true, model: hit.model ?? EXPLAIN_MODEL };
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
      const withCount = (rows: [string, number][]): string =>
        rows.length === 0 ? "(aucun)" : rows.map(([p, c]) => `- ${p} (${c})`).join("\n");

      const byRole = new Map<string, number>();
      let lines = 0;
      for (const f of graph.files) {
        if (!inside.has(f.path)) continue;
        lines += f.lines;
        const role = roleLabel(graph, f.path) ?? "sans rôle identifié";
        byRole.set(role, (byRole.get(role) ?? 0) + 1);
      }
      const totalIncoming = [...fromOutside.values()].reduce((a, b) => a + b, 0);

      const text = await generate(
        FOLDER_SYSTEM,
        [
          `Dossier : ${folderId === "." ? "(racine du dépôt)" : folderId}`,
          `Contenu : ${paths.length} fichiers, ${lines} lignes au total, ${internal} imports entre ses propres fichiers.`,
          `Répartition : ${[...byRole].map(([r, c]) => `${r} ${c}`).join(", ")}.`,
          ``,
          `Fichiers du dossier :`,
          list(paths.slice(0, 60), graph),
          paths.length > 60 ? `(et ${paths.length - 60} autres)` : ``,
          ``,
          `Imports qui arrivent de l'extérieur : ${totalIncoming}, venant de ${fromOutside.size} fichiers.`,
          `Fichiers du dossier les plus importés de l'extérieur :`,
          withCount(top(intoFile, 10)),
          `Fichiers extérieurs qui importent le plus ce dossier :`,
          withCount(top(fromOutside, 12)),
          ``,
          `Fichiers extérieurs que ce dossier importe le plus :`,
          withCount(top(towards, 10)),
        ].join("\n"),
      );

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
        },
        { token },
      );
      return { text, cached: false, model: EXPLAIN_MODEL };
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
