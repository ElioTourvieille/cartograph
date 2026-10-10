import * as tsm from "ts-morph";
import type { Arg, CallFact, ClassFact, DecoratorFact, FileFacts } from "./facts.ts";
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

// --- facts for the adapters ---------------------------------------------------

function toArg(node: tsm.Node): Arg {
  if (tsm.Node.isStringLiteral(node) || tsm.Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  if (tsm.Node.isArrayLiteralExpression(node)) {
    return { array: node.getElements().map(toArg) };
  }
  if (tsm.Node.isObjectLiteralExpression(node)) {
    const entries: Record<string, Arg> = {};
    for (const property of node.getProperties()) {
      if (tsm.Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        entries[property.getName()] = initializer === undefined ? null : toArg(initializer);
      } else if (tsm.Node.isShorthandPropertyAssignment(property)) {
        entries[property.getName()] = null;
      } else {
        // A spread or a method: keys this object holds are not known, so the
        // marker key makes any reader of it treat the whole object as unknown.
        entries["..."] = null;
      }
    }
    return { object: entries };
  }
  return null;
}

const decoratorsOf = (node: { getDecorators(): tsm.Decorator[] }): DecoratorFact[] =>
  node.getDecorators().map((d) => ({
    name: d.getName(),
    args: d.getArguments().map(toArg),
  }));

// Reads a file's syntax into facts. `watch` names the calls worth recording
// (by the last name in the call, so `app.setGlobalPrefix(...)` is
// "setGlobalPrefix"); the parser does not know why anyone wants them.
export function extractFacts(file: tsm.SourceFile, watch: ReadonlySet<string>): FileFacts {
  const directives: string[] = [];
  for (const statement of file.getStatements()) {
    if (!tsm.Node.isExpressionStatement(statement)) break;
    const expression = statement.getExpression();
    if (!tsm.Node.isStringLiteral(expression)) break;
    directives.push(expression.getLiteralValue());
  }

  const exports = new Set<string>();
  for (const statement of file.getStatements()) {
    if (
      tsm.Node.isFunctionDeclaration(statement) ||
      tsm.Node.isClassDeclaration(statement) ||
      tsm.Node.isEnumDeclaration(statement)
    ) {
      if (statement.isDefaultExport()) exports.add("default");
      else if (statement.isExported()) {
        const name = statement.getName();
        if (name !== undefined) exports.add(name);
      }
    } else if (tsm.Node.isVariableStatement(statement) && statement.isExported()) {
      for (const declaration of statement.getDeclarations()) {
        if (tsm.Node.isIdentifier(declaration.getNameNode())) exports.add(declaration.getName());
      }
    } else if (tsm.Node.isExportDeclaration(statement) && !statement.hasModuleSpecifier()) {
      for (const named of statement.getNamedExports()) {
        exports.add(named.getAliasNode()?.getText() ?? named.getName());
      }
    } else if (tsm.Node.isExportAssignment(statement)) {
      exports.add("default");
    }
  }

  const classes: ClassFact[] = file.getClasses().map((c) => ({
    name: c.getName() ?? null,
    decorators: decoratorsOf(c),
    methods: c.getMethods().map((m) => ({ name: m.getName(), decorators: decoratorsOf(m) })),
  }));

  const calls: CallFact[] = [];
  if (watch.size > 0) {
    for (const call of file.getDescendantsOfKind(tsm.SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      const name = tsm.Node.isIdentifier(callee)
        ? callee.getText()
        : tsm.Node.isPropertyAccessExpression(callee)
          ? callee.getName()
          : null;
      if (name !== null && watch.has(name)) {
        calls.push({ name, args: call.getArguments().map(toArg) });
      }
    }
  }

  return { directives, exports: [...exports].sort(), classes, calls };
}
