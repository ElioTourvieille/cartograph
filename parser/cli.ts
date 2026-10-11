// Runs the parser against a directory and prints what it found.
//   pnpm parse <dossier> [--out résultat.json]
// With --out the result is written, read back and validated against the
// contract, so the file on disk is proven to hold.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRepository } from "./parse.ts";
import type { Occurrence, ParseResult, Tally } from "./types.ts";
import { parseResult } from "./validate.ts";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex === -1 ? null : args[outIndex + 1];
const dir = args.find(
  (a, i) => !a.startsWith("--") && (outIndex === -1 || i !== outIndex + 1),
);

if (dir === undefined || (outIndex !== -1 && outPath === undefined)) {
  console.error("Usage : pnpm parse <dossier> [--out résultat.json]");
  process.exit(2);
}

const result = parseRepository(resolve(dir));
print(result);

if (outPath !== null) {
  const file = resolve(outPath);
  const json = JSON.stringify(result, null, 2);
  writeFileSync(file, json);
  const back = parseResult(JSON.parse(readFileSync(file, "utf8")));
  if (JSON.stringify(back, null, 2) !== json) {
    console.error("Le fichier relu diffère du résultat écrit.");
    process.exit(1);
  }
  console.log(`\nÉcrit dans ${file}, relu et validé.`);
}

function print({ coverage: c, files, edges, root, frameworks, roles, routes }: ParseResult): void {
  const folders = new Set(files.map((f) => f.folder));
  console.log(`Dépôt : ${root} (frameworks : ${frameworks.join(", ") || "aucun"})`);
  console.log(
    `tsconfig : ${c.tsconfig ?? "aucun"}${c.tsconfigError === null ? "" : ` (échec : ${c.tsconfigError})`}`,
  );

  console.log(
    `\nFichiers : ${c.files.found} trouvés = ${c.files.parsed} analysés + ${c.files.skipped} ignorés`,
  );
  for (const s of c.skipped) {
    console.log(`  ignoré  ${s.path} — ${s.reason}${s.detail === null ? "" : ` (${s.detail})`}`);
  }
  for (const d of c.ignoredDirectories) {
    console.log(`  dossier non parcouru  ${d.path} — ${d.reason}`);
  }
  console.log(`Dossiers distincts : ${folders.size}`);
  console.log(`Liens : ${edges.length} (sans doublons)`);

  const perRole = new Map<string, number>();
  for (const r of roles) perRole.set(r.role, (perRole.get(r.role) ?? 0) + 1);
  console.log(
    `Rôles : ${roles.length} fichiers sur ${files.length} — ` +
      ([...perRole].map(([role, n]) => `${role} ${n}`).join(", ") || "(aucun)"),
  );
  console.log(`Routes : ${routes.length}`);
  for (const r of routes) console.log(`  ${r.method.padEnd(7)} ${r.pattern}   ${r.file}`);

  console.log("\nImports vus, par issue :");
  console.log(`  ${row("tous", c.imports)}`);
  for (const kind of ["import", "reexport", "dynamic", "require"] as const) {
    console.log(`  ${row(kind, c.byKind[kind])}`);
  }

  for (const g of c.unresolved) {
    console.log(`\nNon résolus — ${g.reason} : ${g.count}`);
    g.examples.forEach((o) => console.log(`  ${show(o)}`));
  }
  for (const g of c.excluded) {
    console.log(`\nExclus — ${g.reason} : ${g.count}`);
    g.examples.forEach((o) => console.log(`  ${show(o)}`));
  }
  if (c.externalPackages.length > 0) {
    const top = c.externalPackages.slice(0, 8).map((p) => `${p.name} (${p.count})`);
    console.log(`\nExternes : ${c.externalPackages.length} noms, dont ${top.join(", ")}`);
  }
}

function row(label: string, t: Tally): string {
  return `${label.padEnd(9)} vus ${t.seen} = résolus ${t.resolved} + externes ${t.external} + exclus ${t.excluded} + non résolus ${t.unresolved}`;
}

function show(o: Occurrence): string {
  return `${o.from}:${o.line}  ${o.kind}  ${o.specifier ?? "(non littéral)"}`;
}
