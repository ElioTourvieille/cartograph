// Prompt versions, side by side. The current explanation prompt (v1) and the
// retired baseline (v0, in evals/retired/) are run over the SAME files as two
// separate experiments in LangSmith, so they appear side by side in its
// dashboard with their scores, and this script prints the comparison with
// how much better one is and how sure that number is.
//
//   pnpm eval:prompts --org org_… [--analysis <id>] [--n 20]
//
// Two scores per explanation:
//   invented_paths  deterministic, set membership (exact).
//   specificity     a MODEL's 1-5 opinion of whether the explanation is
//                   specific enough to be useful. It cannot be exact, so it is
//                   harder than the first number and is reported as what it is.
//                   Judge pinned by exact id and different from the model
//                   judged; see evals/lib/judge.ts.
//
// The dataset holds file contents and so is the same privacy decision as the
// traces: it is LangSmith's, in the same region.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { ROLES } from "../graph/taxonomy.ts";
import { ai } from "../lib/ai/client.ts";
import { checkPaths } from "../lib/ai/invented.ts";
import { EXPLAIN_MODEL } from "../lib/ai/models.ts";
import { FILE_SYSTEM, fileUserPrompt, type FileInput, type Neighbour } from "../lib/ai/prompts.ts";
import { fetchSource, MAX_SOURCE_CHARS } from "../lib/ai/source.ts";
import { listAnalyses, loadAnalysis, neighbours } from "./lib/analysis.ts";
import { loadEnv, option, requiredOption } from "./lib/env.ts";
import { JUDGE_IS_DIFFERENT_FROM_JUDGED, JUDGE_MODEL, judge } from "./lib/judge.ts";
import { mean, pair } from "./lib/stats.ts";
import { V0_SYSTEM } from "./retired/explain-v0.ts";

const BUILDING = "EN CONSTRUCTION : ne pas utiliser";
const COMPLETE = "COMPLET";

type Version = "v1" | "v0";

// --- guards: what comes back from the dataset is not trusted by its type ------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isNeighbours(v: unknown): v is Neighbour[] {
  return (
    Array.isArray(v) &&
    v.every(
      (n) => isRecord(n) && typeof n.path === "string" && (n.role === null || typeof n.role === "string"),
    )
  );
}

function isFileInput(v: unknown): v is FileInput {
  return (
    isRecord(v) &&
    typeof v.path === "string" &&
    (v.role === null || typeof v.role === "string") &&
    typeof v.repo === "string" &&
    isNeighbours(v.imports) &&
    isNeighbours(v.dependents) &&
    typeof v.source === "string" &&
    typeof v.clipped === "boolean"
  );
}

// --- the dataset, built so a half-built one is never taken for a whole one --------

async function ensureDataset(
  client: Client,
  name: string,
  build: () => Promise<FileInput[]>,
  metadata: Record<string, unknown>,
): Promise<number> {
  if (await client.hasDataset({ datasetName: name })) {
    const existing = await client.readDataset({ datasetName: name });
    if ((existing.description ?? "").startsWith(COMPLETE)) {
      return existing.example_count ?? 0;
    }
    // A leftover from a run that died: removed, never reused.
    await client.deleteDataset({ datasetId: existing.id });
  }

  const items = await build();
  const dataset = await client.createDataset(name, { description: BUILDING, metadata });
  try {
    for (let i = 0; i < items.length; i += 10) {
      await client.createExamples(
        items.slice(i, i + 10).map((inputs) => ({ dataset_id: dataset.id, inputs })),
      );
    }
    // Marked complete only now, after every example is in.
    await client.updateDataset({
      datasetId: dataset.id,
      description: `${COMPLETE} : ${items.length} exemples`,
    });
  } catch (error) {
    await client.deleteDataset({ datasetId: dataset.id }).catch(() => {});
    throw error;
  }
  return items.length;
}

// A stable pick: the same analysis always yields the same files.
function stableOrder(path: string): number {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619) >>> 0;
  return h;
}

// --- the two experiments ------------------------------------------------------------

function target(version: Version) {
  return async (inputs: Record<string, unknown>): Promise<{ text: string; shown: string[] }> => {
    if (!isFileInput(inputs)) throw new Error("Exemple de jeu de données invalide.");
    const built = fileUserPrompt(inputs);
    const message = await ai().messages.create({
      model: EXPLAIN_MODEL,
      max_tokens: 700,
      system: version === "v1" ? FILE_SYSTEM : V0_SYSTEM,
      messages: [{ role: "user", content: built.text }],
    });
    const text = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    return { text, shown: built.shown };
  };
}

const inventedPaths = ({ outputs }: { outputs: Record<string, unknown> }) => {
  const text = typeof outputs.text === "string" ? outputs.text : "";
  const shown = Array.isArray(outputs.shown)
    ? outputs.shown.filter((s): s is string => typeof s === "string")
    : [];
  const check = checkPaths(text, new Set(shown));
  return {
    key: "invented_paths",
    score: check.score,
    comment:
      check.invented.length === 0
        ? `${check.tokens.length} chemins cités, aucun inventé`
        : `Inventés : ${check.invented.join(", ")}`,
  };
};

const specificity = async ({
  inputs,
  outputs,
}: {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}) => {
  if (!isFileInput(inputs) || typeof outputs.text !== "string") {
    return { key: "specificity", score: 0, comment: "entrée illisible" };
  }
  const verdict = await judge({
    path: inputs.path,
    imports: inputs.imports.map((n) => n.path),
    dependents: inputs.dependents.map((n) => n.path),
    explanation: outputs.text,
  });
  return { key: "specificity", score: verdict.score, comment: verdict.reason };
};

type PerFile = { specificity: number | null; invented: number | null };

async function runExperiment(client: Client, dataset: string, version: Version) {
  const experiment = await evaluate(target(version), {
    data: dataset,
    evaluators: [inventedPaths, specificity],
    experimentPrefix: `explain-${version}`,
    description:
      version === "v1"
        ? "Prompt d'explication actuel (application)."
        : "Prompt de référence simplifié, sans consigne de voisinage ni règle des chemins (evals/retired).",
    metadata: {
      promptVersion: version,
      explainModel: EXPLAIN_MODEL,
      judgeModel: JUDGE_MODEL,
      judgeDifferentFromJudged: JUDGE_IS_DIFFERENT_FROM_JUDGED,
    },
    maxConcurrency: 3,
    client,
  });

  const perFile = new Map<string, PerFile>();
  for (const row of experiment.results) {
    // null until a score really came back: an evaluator that failed must never
    // be read as a score of zero.
    const entry: PerFile = { specificity: null, invented: null };
    for (const r of row.evaluationResults.results) {
      if (r.key === "specificity" && typeof r.score === "number") entry.specificity = r.score;
      if (r.key === "invented_paths" && typeof r.score === "number") entry.invented = r.score;
    }
    perFile.set(row.example.id, entry);
  }
  return { perFile, name: experiment.experimentName };
}

async function main(): Promise<void> {
  loadEnv(["ANTHROPIC_API_KEY", "LANGSMITH_API_KEY"]);
  const orgId = requiredOption("org");
  const wanted = Number(option("n") ?? "20");
  const client = new Client();

  const summaries = listAnalyses(orgId).filter(
    (a) => a.status === "complete" && a.repo !== null && a.commitSha !== null,
  );
  const chosen = option("analysis");
  const summary = chosen === undefined ? summaries[0] : summaries.find((a) => a.id === chosen);
  if (summary === undefined) {
    console.log("Aucune analyse terminée correspondante pour cette organisation.");
    return;
  }

  const datasetName = `cartograph-explain-${summary.id.slice(0, 8)}-n${wanted}`;
  const count = await ensureDataset(
    client,
    datasetName,
    async () => {
      const analysis = loadAnalysis(orgId, summary);
      const roleOf = new Map(analysis.roles.map((r) => [r.path, r.role]));
      const label = (path: string): string | null => {
        const id = roleOf.get(path);
        return id === undefined ? null : (ROLES.get(id)?.label ?? null);
      };
      const withRole = (paths: readonly string[]): Neighbour[] =>
        paths.map((path) => ({ path, role: label(path) }));

      const picked = analysis.files
        .filter((f) => f.lines >= 15 && f.lines <= 400 && roleOf.get(f.path) !== "tests")
        .filter((f) => {
          const n = neighbours(analysis, f.path);
          return n.imports.length + n.dependents.length >= 2;
        })
        .sort((a, b) => stableOrder(a.path) - stableOrder(b.path))
        .slice(0, wanted * 2); // a margin for files that cannot be read

      const [owner, name] = analysis.repo.split("/");
      const items: FileInput[] = [];
      for (const f of picked) {
        if (items.length >= wanted) break;
        const source = await fetchSource(owner, name, analysis.commitSha, f.path);
        if (source === null) continue;
        const n = neighbours(analysis, f.path);
        items.push({
          path: f.path,
          role: label(f.path),
          repo: analysis.repo,
          imports: withRole(n.imports),
          dependents: withRole(n.dependents),
          source: source.slice(0, MAX_SOURCE_CHARS),
          clipped: source.length > MAX_SOURCE_CHARS,
        });
      }
      return items;
    },
    { organization: orgId, analysisId: summary.id, repo: summary.repo },
  );

  console.log(`Jeu de données LangSmith : ${datasetName} (${count} fichiers de ${summary.repo})`);
  console.log(`Modèle des explications : ${EXPLAIN_MODEL}`);
  console.log(
    `Juge : ${JUDGE_MODEL} (${JUDGE_IS_DIFFERENT_FROM_JUDGED ? "différent du modèle jugé" : "LE MÊME modèle que celui jugé"})\n`,
  );
  if (count === 0) return;

  const a = await runExperiment(client, datasetName, "v1");
  const b = await runExperiment(client, datasetName, "v0");

  // A comparison with scores missing is not a comparison. Fail loudly.
  const missing = [...a.perFile.values(), ...b.perFile.values()].filter(
    (r) => r.specificity === null || r.invented === null,
  ).length;
  if (missing > 0) {
    throw new Error(
      `${missing} score(s) manquant(s) : un évaluateur a échoué (voir les erreurs ci-dessus). Aucune comparaison n'est affichée plutôt qu'un chiffre faux.`,
    );
  }

  // Paired: only files both versions were scored on.
  const ids = [...a.perFile.keys()].filter((id) => b.perFile.has(id));
  const get = (m: Map<string, PerFile>, key: keyof PerFile): number[] =>
    ids.map((id) => m.get(id)?.[key] ?? Number.NaN);
  const spec = pair(get(a.perFile, "specificity"), get(b.perFile, "specificity"));
  const cleanA = get(a.perFile, "invented").filter((s) => s === 1).length;
  const cleanB = get(b.perFile, "invented").filter((s) => s === 1).length;

  const f = (x: number): string => x.toFixed(2);
  console.log(`\nExpériences : ${a.name} (v1, actuel)  contre  ${b.name} (v0, référence)`);
  console.log(`Sur ${spec.n} fichiers, les mêmes pour les deux.\n`);
  console.log(`Précision utile (note de 1 à 5, par le juge ${JUDGE_MODEL}) :`);
  console.log(`  v1 ${f(spec.meanA)}   v0 ${f(spec.meanB)}`);
  console.log(
    `  écart v1 − v0 : ${spec.difference >= 0 ? "+" : ""}${f(spec.difference)} point(s), intervalle à 95 % [${f(spec.low)} ; ${f(spec.high)}]`,
  );
  console.log(
    `  fichier par fichier : v1 meilleur ${spec.wins}, v0 meilleur ${spec.losses}, égalité ${spec.ties}`,
  );
  console.log(
    spec.low > 0
      ? "  → v1 est meilleur, et l'intervalle ne contient pas zéro."
      : spec.high < 0
        ? "  → v0 est meilleur, et l'intervalle ne contient pas zéro."
        : "  → pas de différence établie : l'intervalle contient zéro.",
  );
  console.log("  Réserve : c'est l'avis d'un modèle, pas une mesure exacte.\n");
  console.log("Chemins inventés (exact, par appartenance à l'ensemble montré) :");
  console.log(
    `  explications sans aucun chemin inventé : v1 ${cleanA} / ${spec.n}   v0 ${cleanB} / ${spec.n}`,
  );

  const outDir = join(process.cwd(), "evals", "results");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `prompts-${Date.now()}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        dataset: datasetName,
        explainModel: EXPLAIN_MODEL,
        judgeModel: JUDGE_MODEL,
        judgeDifferent: JUDGE_IS_DIFFERENT_FROM_JUDGED,
        experiments: { v1: a.name, v0: b.name },
        specificity: spec,
        cleanExplanations: { v1: cleanA, v0: cleanB, of: spec.n },
        meanV1: mean(get(a.perFile, "specificity")),
      },
      null,
      1,
    ),
  );
  console.log(`\nRésultat écrit dans ${file}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
