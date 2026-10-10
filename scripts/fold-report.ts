// Numbers for the canvas acceptance check, from a terminal:
//   pnpm fold-report <résultat.json>
// Takes a parser output file. Exits 1 if a rule is broken.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fold, MAX_NODES } from "../graph/fold.ts";
import {
  buildScene,
  MORE_HANDLE,
  NODE_HANDLE,
  rowHandle,
  type Scene,
} from "../graph/scene.ts";
import { parseResult } from "../parser/validate.ts";

const arg = process.argv[2];
if (arg === undefined) {
  console.error("Usage : pnpm fold-report <résultat.json>  (le fichier produit par pnpm parse <dossier> --out …)");
  process.exit(2);
}
const file = resolve(arg);
const data = parseResult(JSON.parse(readFileSync(file, "utf8")));
const f = fold(data.files);
const source = { root: data.root, files: data.files, edges: data.edges };

const sizes = f.nodes.map((n) => n.files.length);
const directories = new Set(data.files.map((x) => x.folder)).size;
const problems: string[] = [];

console.log(`Données : ${file}`);
console.log(`Fichiers : ${data.files.length}, dossiers distincts : ${directories}, liens : ${data.edges.length}`);
console.log(`\n1. Nœuds : ${f.nodes.length} (seuil de repli ${f.threshold}, plafond ${MAX_NODES})`);
console.log(`   un nœud pour ${(data.files.length / f.nodes.length).toFixed(1)} fichiers`);
if (f.nodes.length > MAX_NODES) problems.push(`plus de ${MAX_NODES} nœuds`);

const single = f.nodes.filter((n) => n.files.length <= 1);
console.log(`\n2. Fichiers par nœud : de ${Math.min(...sizes)} à ${Math.max(...sizes)}`);
console.log(`   nœuds de 1 fichier ou moins : ${single.length}${single.length ? ` (${single.map((n) => n.id).join(", ")})` : ""}`);
if (single.length > 0) problems.push("des nœuds de 1 fichier");

const held = f.nodes.reduce((total, n) => total + n.files.length, 0);
console.log(`   fichiers dans un nœud : ${held} sur ${data.files.length}`);
if (held !== data.files.length) problems.push("des fichiers hors de tout nœud");
for (const n of f.nodes) console.log(`   ${String(n.files.length).padStart(4)}  ${n.id}`);

console.log("\n3. Liens dont une extrémité n'est pas un nœud :");
const check = (label: string, scene: Scene): void => {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const handles = (id: string): Set<string> => {
    const n = byId.get(id);
    if (n === undefined) return new Set();
    if (!n.open) return new Set([NODE_HANDLE]);
    const set = new Set(n.rows.map((_, i) => rowHandle(i)));
    if (n.hidden > 0) set.add(MORE_HANDLE);
    return set;
  };
  let dangling = 0;
  for (const e of scene.edges) {
    if (!handles(e.source.node).has(e.source.handle)) dangling++;
    if (!handles(e.target.node).has(e.target.handle)) dangling++;
  }
  console.log(`   ${label} : ${scene.edges.length} lignes, ${dangling} extrémité(s) sans nœud`);
  if (dangling > 0) problems.push(`${label} : extrémités sans nœud`);
};
const unmapped = data.edges.filter((e) => !f.nodeOf.has(e.from) || !f.nodeOf.has(e.to)).length;
console.log(`   liens du parseur hors de tout nœud : ${unmapped}`);
if (unmapped > 0) problems.push("liens du parseur hors de tout nœud");
check("tout fermé", buildScene(source, f, new Set()));
check("tout ouvert", buildScene(source, f, new Set(f.nodes.map((n) => n.id))));

if (problems.length > 0) {
  console.error(`\nÉCHEC : ${problems.join(" ; ")}`);
  process.exit(1);
}
console.log("\nOK");
