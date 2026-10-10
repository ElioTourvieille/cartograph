// The parser as a child process, for a server that must not freeze while a big
// repository is parsed:
//   node parser/run.ts <dossier> <sortie.json>
// One JSON line per stage on stdout ({"stage":"select"}, then "parse"), then
// the whole result written to the output file. Exits 1 with the reason on
// stderr if anything throws.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRepository } from "./parse.ts";

const [dir, out] = process.argv.slice(2);
if (dir === undefined || out === undefined) {
  console.error("Usage : node parser/run.ts <dossier> <sortie.json>");
  process.exit(2);
}

try {
  const result = parseRepository(resolve(dir), (stage) =>
    console.log(JSON.stringify({ stage })),
  );
  writeFileSync(resolve(out), JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
