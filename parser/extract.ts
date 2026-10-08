import * as tsm from "ts-morph";
import type { EdgeKind } from "./types.ts";

export type RawImport = {
  kind: EdgeKind;
  /** null when a dynamic import's argument is not a literal string. */
  specifier: string | null;
  line: number;
};

// The three things that make an edge: a plain import, a re-export
// (`export … from`), and a dynamic import with a literal string. `require()`
// is deliberately not read.
export function extractImports(file: tsm.SourceFile): RawImport[] {
  const found: RawImport[] = [];

  for (const decl of file.getImportDeclarations()) {
    found.push({
      kind: "import",
      specifier: decl.getModuleSpecifierValue(),
      line: decl.getStartLineNumber(),
    });
  }

  for (const decl of file.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier === undefined) continue; // `export { a }` re-exports nothing
    found.push({ kind: "reexport", specifier, line: decl.getStartLineNumber() });
  }

  for (const call of file.getDescendantsOfKind(tsm.SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== tsm.SyntaxKind.ImportKeyword) continue;
    const arg = call.getArguments()[0];
    const literal =
      arg !== undefined &&
      (tsm.Node.isStringLiteral(arg) ||
        tsm.Node.isNoSubstitutionTemplateLiteral(arg))
        ? arg.getLiteralValue()
        : null;
    found.push({ kind: "dynamic", specifier: literal, line: call.getStartLineNumber() });
  }

  return found;
}
