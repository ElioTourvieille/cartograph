// The invented-path check, run over the explanations an organization really
// has. Deterministic: every path-shaped token in an explanation is tested
// against the exact set of paths the model was shown, and anything else was
// invented. No model is involved anywhere here.
//
//   pnpm eval:paths --org org_…            score the stored explanations
//   pnpm eval:paths --org org_… --limit 100
//   pnpm eval:paths --self-test            prove it catches a spliced-in name
//
// The same function scores new explanations live, as they are written (see
// lib/ai/explain.ts); this script is the same check over what is already there.

import { checkPaths } from "../lib/ai/invented.ts";
import { flag, loadEnv, option, requiredOption } from "./lib/env.ts";
import { convexRun } from "./lib/convex.ts";
import {
  listAnalyses,
  loadAnalysis,
  neighbours,
  type StoredAnalysis,
} from "./lib/analysis.ts";

type Row = {
  analysisId: string;
  kind: "file" | "folder" | null;
  subject: string;
  text: string;
  model: string | null;
  shown: string[] | null;
};

const isRows = (v: unknown): v is Row[] => Array.isArray(v);

// --- self test: the check must catch a made-up filename --------------------------

function selfTest(): boolean {
  const shown = new Set(["src/auth/auth.service.ts", "src/users/users.service.ts", "app/(app)/page.tsx"]);
  const cases: { name: string; text: string; expect: string[] }[] = [
    {
      name: "explication propre",
      text: "Il s'appuie sur `src/users/users.service.ts` et sur `src/auth/auth.service.ts`.",
      expect: [],
    },
    {
      name: "nom de fichier inventé greffé",
      text: "Il s'appuie sur `src/users/users.service.ts` et sur `src/billing/invoice.ghost.ts`.",
      expect: ["src/billing/invoice.ghost.ts"],
    },
    {
      name: "chemin inventé dans la prose, sans code en ligne",
      text: "Il appelle src/payments/stripe.client.ts pour encaisser.",
      expect: ["src/payments/stripe.client.ts"],
    },
    {
      name: "nom nu inventé dans un code en ligne",
      text: "Il charge `phantom.config.json` au démarrage.",
      expect: ["phantom.config.json"],
    },
    {
      name: "groupe de routes avec parenthèses, fourni",
      text: "La page `app/(app)/page.tsx` l'affiche.",
      expect: [],
    },
    {
      name: "faux positifs à éviter (Next.js, et/ou, URL, dossier montré)",
      text: "Avec Next.js et/ou Node.js, voir https://example.com/docs/a.html ; le dossier `src/auth/` est cité.",
      expect: [],
    },
  ];
  let ok = true;
  for (const c of cases) {
    const got = checkPaths(c.text, shown).invented;
    const pass = JSON.stringify(got) === JSON.stringify(c.expect);
    ok &&= pass;
    console.log(
      `${pass ? "OK   " : "ÉCHEC"}  ${c.name}${pass ? "" : `  → attendu ${JSON.stringify(c.expect)}, obtenu ${JSON.stringify(got)}`}`,
    );
  }
  return ok;
}

// --- over stored explanations -------------------------------------------------------

function shownFor(row: Row, analysis: StoredAnalysis | undefined): Set<string> | null {
  if (row.shown !== null) return new Set(row.shown);
  // Written before the shown set was kept: for a file it is exactly the file
  // and its neighbours, which the stored analysis still says. A folder's
  // listed set was cut by the prompt, so it cannot be rebuilt exactly.
  if (row.kind === "file" && analysis !== undefined) {
    const n = neighbours(analysis, row.subject);
    return new Set([row.subject, ...n.imports, ...n.dependents]);
  }
  return null;
}

function main(): void {
  if (flag("self-test")) {
    console.log("Auto-test du contrôle des chemins inventés :");
    if (!selfTest()) process.exit(1);
    console.log("Tous les cas passent.");
    return;
  }

  loadEnv();
  const orgId = requiredOption("org");
  const limit = Number(option("limit") ?? "100");

  const result = convexRun("evalData:explanations", { orgId, limit });
  const rows = isRows(result) ? result : [];
  if (rows.length === 0) {
    console.log("Aucune explication pour cette organisation : cliquez « Expliquer » dans l'application, puis relancez.");
    return;
  }

  // Analyses are loaded once each, and only if some row needs them.
  const summaries = new Map(listAnalyses(orgId).map((a) => [a.id, a]));
  const loaded = new Map<string, StoredAnalysis>();
  const analysisFor = (id: string): StoredAnalysis | undefined => {
    const cached = loaded.get(id);
    if (cached !== undefined) return cached;
    const summary = summaries.get(id);
    if (summary === undefined) return undefined;
    const analysis = loadAnalysis(orgId, summary);
    loaded.set(id, analysis);
    return analysis;
  };

  let scored = 0;
  let clean = 0;
  let tokens = 0;
  let invented = 0;
  let unscorable = 0;
  const failures: { subject: string; invented: string[] }[] = [];

  for (const row of rows) {
    const shown = shownFor(row, row.shown === null ? analysisFor(row.analysisId) : undefined);
    if (shown === null) {
      unscorable++;
      continue;
    }
    const check = checkPaths(row.text, shown);
    scored++;
    tokens += check.tokens.length;
    invented += check.invented.length;
    if (check.invented.length === 0) clean++;
    else failures.push({ subject: row.subject, invented: check.invented });
  }

  console.log(`Explications lues : ${rows.length} (organisation ${orgId})`);
  console.log(
    `  évaluées : ${scored}   non évaluables : ${unscorable} (dossier écrit avant que l'ensemble montré soit conservé)`,
  );
  if (scored === 0) return;
  console.log(
    `  explications sans aucun chemin inventé : ${clean} sur ${scored} (${((clean / scored) * 100).toFixed(1)} %)`,
  );
  console.log(
    `  chemins cités : ${tokens}, inventés : ${invented}${tokens > 0 ? ` (${((invented / tokens) * 100).toFixed(1)} %)` : ""}`,
  );
  for (const f of failures) {
    console.log(`\n  ÉCHEC  ${f.subject}`);
    for (const p of f.invented) console.log(`    chemin inventé : ${p}`);
  }
}

main();
