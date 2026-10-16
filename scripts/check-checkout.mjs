// Is a run's checkout gone from disk? Run it after a run, success or failure:
//   pnpm check:checkout
//
// A run unpacks the repository into a temporary folder named cartograph-…, and
// the parser leaves its result in a file beside it (cartograph-…-resultat.json).
// Both are removed when the run ends, failure included. This lists what is
// still in the system's temporary folder under those names and exits 1 if
// there is anything. It reports how many entries it looked at, so an empty
// result is distinguishable from a folder it could not read.
//
// Run it with the dev server idle: a run in progress has a checkout by design.

import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = tmpdir();
let entries;
try {
  entries = readdirSync(dir);
} catch (error) {
  console.error(`FAIL  ${dir} n'a pas pu être lu : ${error.message}`);
  process.exit(1);
}

// mkdtemp(".../cartograph-") appends exactly six characters; the parser's result
// file is that name plus "-resultat.json". Nothing else matches: other files of
// the same name prefix (logs, test folders) are not a run's checkout.
const left = entries.filter((name) => /^cartograph-[A-Za-z0-9]{6}(-resultat\.json)?$/.test(name));
console.log(`${dir} : ${entries.length} entrées regardées.`);
if (left.length === 0) {
  console.log("PASS  aucun checkout ni fichier de résultat restant.");
  process.exit(0);
}
for (const name of left) {
  const stat = statSync(join(dir, name));
  console.error(
    `FAIL  reste : ${name} (${stat.isDirectory() ? "dossier" : "fichier"}, modifié le ${stat.mtime.toISOString()})`,
  );
}
process.exit(1);
