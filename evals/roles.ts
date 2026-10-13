// Role accuracy. Convention already gives roles it can be certain of, and those
// files never reach the model in normal operation, which makes them a held-out
// set with real ground truth: hide the role, ask the model, compare.
//
//   pnpm eval:roles --org org_…              [--analyses 5]
//
// Two numbers come out, and the first is the one to read. The files were
// chosen because a convention named them, so their paths often give the answer
// away (users.service.ts). The classifier is run once on the real paths and once
// with the convention-bearing parts of every path masked; the gap is the leak.
//
// The dataset holds only files whose conventional role maps onto a role the
// classifier is actually allowed to return. Scoring it on questions it is
// forbidden to answer would measure nothing.

import { mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INFERABLE_ROLES, type InferableRole } from "../graph/taxonomy.ts";
import { classifyBatch, type ClassifyItem } from "../lib/ai/classify-core.ts";
import { CLASSIFY_MODEL } from "../lib/ai/models.ts";
import { fetchSource } from "../lib/ai/source.ts";
import { listAnalyses, loadAnalysis, neighbours } from "./lib/analysis.ts";
import { loadEnv, option, requiredOption } from "./lib/env.ts";
import { maskPath } from "./lib/mask.ts";

// Conventional role -> the classifier's role. Only mappings that are exact:
// a "Libs" folder is not a role, so it is not here.
const EXPECTED: Readonly<Record<string, InferableRole>> = {
  "nestjs:service": "service",
  "express:service": "service",
  "nestjs:repository": "repository",
  "nestjs:entity": "model",
  "nestjs:schema": "model",
  "express:model": "model",
  "express:util": "util",
  "express:config": "config",
  "nextjs:config": "config",
  "nextjs:component": "component",
  "react:component": "component",
  "nextjs:hook": "hook",
  "react:hook": "hook",
};

const MINIMUM = 30;
const BATCH = 25;
const DATA_DIR = join(process.cwd(), "evals", "data");

type Item = {
  analysisId: string;
  repo: string;
  path: string;
  conventional: string;
  expected: InferableRole;
  head: string;
  imports: string[];
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

// A dataset is written under a provisional name and renamed only when it is
// whole. A run that dies halfway leaves a .partial file, which nothing reads and
// the next run deletes: it is never mistaken for a complete dataset.
function writeDataset(name: string, items: readonly Item[]): string {
  mkdirSync(DATA_DIR, { recursive: true });
  for (const file of readdirSync(DATA_DIR)) {
    if (file.endsWith(".partial")) unlinkSync(join(DATA_DIR, file));
  }
  const final = join(DATA_DIR, `${name}.json`);
  const partial = `${final}.partial`;
  writeFileSync(partial, JSON.stringify({ model: CLASSIFY_MODEL, items }, null, 1));
  renameSync(partial, final);
  return final;
}

type Variant = "reel" | "masque";

async function score(items: readonly Item[], variant: Variant) {
  const pathOf = (item: Item): string => (variant === "masque" ? maskPath(item.path) : item.path);

  const answers = new Map<string, string>(); // analysis|path -> role
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);

    // The same masked name must not stand for two files of a batch.
    const seen = new Map<string, number>();
    const named = batch.map((item) => {
      const base = pathOf(item);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { item, shown: n === 0 ? base : `${base}~${n}` };
    });
    const toItem = new Map(named.map((n) => [n.shown, n.item]));

    const request: ClassifyItem[] = named.map(({ item, shown }) => ({
      path: shown,
      // Paths only, never roles; the file itself is left out of its own list, so
      // a file that imports itself cannot show its own name through it.
      imports: item.imports
        .filter((p) => p !== item.path)
        .map((p) => (variant === "masque" ? maskPath(p) : p)),
      head: item.head,
    }));
    for (const answer of await classifyBatch(request)) {
      const item = toItem.get(answer.path);
      if (item !== undefined) answers.set(`${item.analysisId}|${item.path}`, answer.role);
    }
  }

  let correct = 0;
  let answered = 0;
  const perRole = new Map<InferableRole, { n: number; ok: number }>();
  const confusions = new Map<string, number>();
  for (const item of items) {
    const got = answers.get(`${item.analysisId}|${item.path}`);
    const bucket = perRole.get(item.expected) ?? { n: 0, ok: 0 };
    bucket.n++;
    if (got !== undefined) {
      answered++;
      if (got === item.expected) {
        correct++;
        bucket.ok++;
      } else {
        const k = `${item.expected} → ${got}`;
        confusions.set(k, (confusions.get(k) ?? 0) + 1);
      }
    }
    perRole.set(item.expected, bucket);
  }
  return { correct, answered, total: items.length, perRole, confusions };
}

async function main(): Promise<void> {
  loadEnv(["ANTHROPIC_API_KEY"]);
  const orgId = requiredOption("org");
  const maxAnalyses = Number(option("analyses") ?? "5");

  const summaries = listAnalyses(orgId)
    .filter((a) => a.status === "complete" && a.repo !== null && a.commitSha !== null)
    .slice(0, maxAnalyses);
  if (summaries.length === 0) {
    console.log("Aucune analyse terminée pour cette organisation.");
    return;
  }

  // --- build the held-out dataset -------------------------------------------------
  const candidates: Omit<Item, "head">[] = [];
  const commits = new Map<string, string>();
  const repos: string[] = [];
  for (const summary of summaries) {
    const analysis = loadAnalysis(orgId, summary);
    repos.push(analysis.repo);
    commits.set(analysis.id, analysis.commitSha);
    for (const role of analysis.roles) {
      // Only roles an adapter decided, by convention: those are the ground truth.
      if (role.source !== "adapter") continue;
      const expected = EXPECTED[role.role];
      if (expected === undefined) continue;
      candidates.push({
        analysisId: analysis.id,
        repo: analysis.repo,
        path: role.path,
        conventional: role.role,
        expected,
        imports: neighbours(analysis, role.path).imports,
      });
    }
  }

  const heads = await mapLimit(candidates, 8, (c) => {
    const [owner, name] = c.repo.split("/");
    const commit = commits.get(c.analysisId);
    return commit === undefined ? Promise.resolve(null) : fetchSource(owner, name, commit, c.path);
  });
  const items: Item[] = [];
  let unreadable = 0;
  candidates.forEach((c, i) => {
    const head = heads[i];
    if (head === null) unreadable++;
    else items.push({ ...c, head });
  });

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = writeDataset(`roles-${orgId.slice(-8)}-${stamp}`, items);

  console.log(`Organisation ${orgId} · dépôts : ${[...new Set(repos)].join(", ")}`);
  console.log(
    `Jeu de référence : ${items.length} fichiers dont le rôle vient d'une convention (${unreadable} illisibles, écartés)`,
  );
  console.log(`  écrit dans ${file}`);
  if (items.length < MINIMUM) {
    console.log(`  ATTENTION : moins de ${MINIMUM} fichiers, le pourcentage ci-dessous n'est pas fiable.`);
  }
  if (items.length === 0) return;

  const counts = new Map<InferableRole, number>();
  for (const item of items) counts.set(item.expected, (counts.get(item.expected) ?? 0) + 1);
  console.log(
    `  répartition : ${INFERABLE_ROLES.filter((r) => counts.has(r))
      .map((r) => `${r} ${counts.get(r)}`)
      .join(", ")}`,
  );
  console.log(`  modèle : ${CLASSIFY_MODEL}\n`);

  // --- score, twice -----------------------------------------------------------------
  const results = {
    reel: await score(items, "reel"),
    masque: await score(items, "masque"),
  };
  const pct = (a: number, b: number): string => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)} %`);

  for (const [variant, label] of [
    ["masque", "CHEMIN MASQUÉ (le chiffre à retenir)"],
    ["reel", "chemin réel (avantage du nom du fichier)"],
  ] as const) {
    const r = results[variant];
    console.log(label);
    console.log(`  précision : ${pct(r.correct, r.total)}  (${r.correct} bons sur ${r.total})`);
    console.log(
      `  le modèle a répondu pour ${pct(r.answered, r.total)} des fichiers ; parmi ses réponses, ${pct(r.correct, r.answered)} sont bonnes`,
    );
    for (const role of INFERABLE_ROLES) {
      const b = r.perRole.get(role);
      if (b !== undefined) {
        console.log(
          `    ${role.padEnd(11)} ${String(b.ok).padStart(3)} / ${String(b.n).padEnd(3)} ${pct(b.ok, b.n)}`,
        );
      }
    }
    const top = [...r.confusions].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length > 0) console.log(`  confusions : ${top.map(([k, n]) => `${k} (${n})`).join(", ")}`);
    console.log("");
  }
  const leak =
    results.reel.correct / results.reel.total - results.masque.correct / results.masque.total;
  console.log(
    `Fuite par le nom : ${(leak * 100).toFixed(1)} points entre le chemin réel et le chemin masqué.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
