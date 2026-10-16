// Does anything of a private repository's source reach the database or the
// trace store? Run it from a terminal after analysing and explaining a file of
// a private repository:
//
//   pnpm check:leak --org org_… --needle "<a string that appears only inside a
//     source file of that repository, such as an unusual identifier or a
//     sentence from a comment>"
//
// It searches, for that string:
//   1. every row of every table the organization has in Convex (projects,
//      analyses, files, edges, routes, explanations, fileRoles, insights,
//      installations), as stored JSON;
//   2. every run in the LangSmith project since --since (default: the last
//      two hours): inputs, outputs, metadata, tags, error and name, as the
//      trace store holds them.
//
// A hit anywhere is a FAIL and the place is named. It also prints WHAT was
// searched (counts), because "nothing found" means little when nothing was
// looked at; and it fails if either side had nothing to search. The needle is
// never printed back in full beyond the first characters.

import { Client } from "langsmith";
import { convexRun } from "../evals/lib/convex.ts";

process.loadEnvFile(".env.local");

const TABLES = [
  "projects",
  "analyses",
  "files",
  "edges",
  "routes",
  "explanations",
  "fileRoles",
  "insights",
  "installations",
] as const;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const org = option("org");
const needle = option("needle");
const hours = Number(option("since") ?? "2");
if (org === undefined || needle === undefined || needle.length < 8) {
  console.error(
    'FAIL  usage : pnpm check:leak --org org_… --needle "<au moins 8 caractères, propres au code source>" [--since <heures>]',
  );
  process.exit(1);
}

type Page = { page: string[]; isDone: boolean; cursor: string };

let failures = 0;
const found: string[] = [];

// --- 1. Convex ---------------------------------------------------------------

let rowsSearched = 0;
const perTable: string[] = [];
for (const table of TABLES) {
  let cursor: string | null = null;
  let count = 0;
  for (;;) {
    const result = convexRun("evalData:rows", {
      orgId: org,
      table,
      cursor,
      numItems: 1000,
    }) as Page;
    for (const row of result.page) {
      count++;
      if (row.includes(needle)) found.push(`Convex, table ${table}`);
    }
    if (result.isDone) break;
    cursor = result.cursor;
  }
  rowsSearched += count;
  perTable.push(`${table} ${count}`);
}
console.log(`Convex : ${rowsSearched} lignes cherchées (${perTable.join(", ")}).`);
if (rowsSearched === 0) {
  console.error("FAIL  Convex : aucune ligne pour cette organisation, la recherche ne prouve rien.");
  failures++;
}

// --- 2. LangSmith ------------------------------------------------------------

async function searchTraces(): Promise<void> {
  const project = process.env.LANGSMITH_PROJECT;
  if (project === undefined || project === "") {
    throw new Error("LANGSMITH_PROJECT manque dans .env.local.");
  }
  const client = new Client();
  const since = new Date(Date.now() - hours * 3_600_000);
  let runs = 0;
  let privateRuns = 0;
  for await (const run of client.listRuns({ projectName: project, startTime: since })) {
    runs++;
    const tags = run.tags ?? [];
    if (tags.includes("private")) privateRuns++;
    const text = JSON.stringify({
      name: run.name,
      inputs: run.inputs,
      outputs: run.outputs,
      extra: run.extra,
      error: run.error,
      tags,
      events: run.events,
    });
    if (text.includes(needle as string)) found.push(`LangSmith, run ${run.id} (${run.name})`);
  }
  console.log(
    `LangSmith : ${runs} runs cherchés dans « ${project} » depuis ${hours} h, dont ${privateRuns} marqués « private ».`,
  );
  if (runs === 0) {
    console.error("FAIL  LangSmith : aucun run dans la fenêtre, la recherche ne prouve rien.");
    failures++;
  } else if (privateRuns === 0) {
    console.error(
      "FAIL  LangSmith : aucun run marqué « private » : expliquez d'abord un fichier du dépôt privé, ou élargissez --since.",
    );
    failures++;
  }
}

try {
  await searchTraces();
} catch (error) {
  console.error(
    "FAIL  LangSmith n'a pas pu être lu :",
    error instanceof Error ? error.message : error,
  );
  failures++;
}

console.log("");
if (found.length > 0) {
  failures++;
  for (const place of [...new Set(found)]) {
    console.error(`FAIL  « ${needle.slice(0, 6)}… » trouvé dans : ${place}`);
  }
} else {
  console.log(`« ${needle.slice(0, 6)}… » n'apparaît nulle part dans ce qui a été cherché.`);
}
console.log(failures === 0 ? "\nTout passe." : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
