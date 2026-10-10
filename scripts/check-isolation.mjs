// Organization isolation check. Run it from a terminal: `pnpm check:isolation`.
// Exits 1 and says why if either rule is broken:
//   1. every table carries an `orgId` field and an index that starts with it;
//   2. no file but convex/lib/org.ts uses a raw public builder (query,
//      mutation, action, httpAction), so a public function can only be written
//      through the org-scoping builders.
// It reads the schema and the source, so it does not depend on anyone
// remembering the rules, and it needs no deployment.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const convexDir = join(root, "convex");
const BUILDER_FILE = join(convexDir, "lib", "org.ts");
const RAW_PUBLIC_BUILDERS = new Set([
  "query",
  "mutation",
  "action",
  "httpAction",
  "queryGeneric",
  "mutationGeneric",
  "actionGeneric",
  "httpActionGeneric",
]);

const problems = [];

// --- 1. Schema --------------------------------------------------------------

// Node can't import a .ts file on every version we may run on, so transpile the
// schema next to node_modules (where "convex/server" resolves) and import that.
const cacheDir = join(root, "node_modules", ".cache", "cartograph");
mkdirSync(cacheDir, { recursive: true });

// The schema may import small relative modules (shared validators). Each is
// transpiled next to it, with its specifier pointed at the .mjs output, so the
// schema loads exactly as written.
function emit(sourcePath, outFile) {
  const { outputText } = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const rewritten = outputText.replace(/from "(\.\.?\/[^"]+)"/g, (_, spec) => {
    const dependency = join(dirname(sourcePath), spec + ".ts");
    const out = join(dirname(outFile), spec + ".mjs");
    mkdirSync(dirname(out), { recursive: true });
    emit(dependency, out);
    return `from "${spec}.mjs"`;
  });
  writeFileSync(outFile, rewritten);
}
const schemaFile = join(cacheDir, "schema.mjs");
emit(join(convexDir, "schema.ts"), schemaFile);
const schema = (await import(pathToFileURL(schemaFile).href)).default;
const tables = JSON.parse(schema.export()).tables;

if (tables.length === 0) problems.push("convex/schema.ts defines no table.");
for (const table of tables) {
  const field = table.documentType.value.orgId;
  if (field === undefined) {
    problems.push(`Table "${table.tableName}" has no orgId field.`);
  } else if (field.optional || field.fieldType?.type !== "string") {
    problems.push(`Table "${table.tableName}": orgId must be a required string.`);
  }
  const indexed = table.indexes.some((index) => index.fields[0] === "orgId");
  if (!indexed) {
    problems.push(`Table "${table.tableName}" has no index starting with orgId.`);
  }
}

// --- 2. Raw builders --------------------------------------------------------

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "_generated" || entry.name === "node_modules"
        ? []
        : sourceFiles(path);
    }
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

for (const file of sourceFiles(convexDir)) {
  if (file === BUILDER_FILE) continue;
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = statement.moduleSpecifier.text;
    if (!/(^|\/)_generated\/server(\.js)?$/.test(from) && from !== "convex/server") continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    const where = (node) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      return `${relative(root, file)}:${line + 1}`;
    };
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      problems.push(
        `${where(statement)}: namespace import of "${from}" can hide a raw builder; import by name.`,
      );
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) continue;
        const imported = (element.propertyName ?? element.name).text;
        if (RAW_PUBLIC_BUILDERS.has(imported)) {
          problems.push(
            `${where(element)}: raw builder "${imported}" builds a public function. Use orgQuery or orgMutation from convex/lib/org.ts.`,
          );
        }
      }
    }
  }
}

// --- Result -----------------------------------------------------------------

if (problems.length > 0) {
  console.error("Isolation check FAILED:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `Isolation check passed: ${tables.length} tables carry orgId and an org index; no raw public builder outside convex/lib/org.ts.`,
);
