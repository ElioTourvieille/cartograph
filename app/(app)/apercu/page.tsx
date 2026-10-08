import { Explorer } from "@/components/explorer/explorer";
import data from "@/preview/zod-src.json";
import { parseResult } from "@/parser/validate";

// Scaffolding: the explorer drawn from a checked-in parser output (zod's
// packages/zod/src, 332 files), so the interface can be built without an
// account, a database or a network. Deleted once analyses are stored (phase 7).
// The JSON is validated against the parser's contract before anything uses it.
export default function Apercu() {
  return <Explorer data={parseResult(data)} />;
}
