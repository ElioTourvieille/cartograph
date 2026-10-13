// The current explanation prompts, and the functions that turn what the stored
// analysis says into the text a model is handed. Pure and import-free, so the
// application and the evaluation scripts build the exact same request.
//
// Each builder returns the paths it listed as well as the text: that list IS
// the set of paths the model was shown, which is what the invented-path check
// tests an answer against.
//
// A retired prompt does not live here. It lives with the evaluations, so that
// no dead prompt ships in the product for a test to reach.

export type Neighbour = { path: string; role: string | null };

// The prompt permits exactly three pieces of formatting, because the pane is
// narrow and the renderer draws exactly these: inline code, bold, bullets.
const FORMAT_RULES = `Mise en forme : uniquement du \`code en ligne\`, du **gras** et des puces qui commencent par "- ". Jamais de titre, de tableau, de bloc de code ni de lien. Cite chaque fichier par son chemin exact, en code en ligne. N'écris jamais un chemin qui ne figure pas dans les listes fournies.`;

export const FILE_SYSTEM = `Tu aides un développeur à comprendre un dépôt qu'il ne connaît pas. Réponds en français, en un ou deux courts paragraphes (120 mots au plus).
Explique ce que fait le fichier donné, dans le contexte de ses voisins réels : les fichiers qu'il importe et ceux qui l'importent, dont la liste complète t'est fournie. Dis à quoi il sert pour eux et ce qu'ils attendent de lui.
Ne prétends jamais que deux fichiers sont liés si les listes ne le montrent pas. Ne juge pas la qualité du code, ne note rien, ne propose pas de correction.
${FORMAT_RULES}`;

export const FOLDER_SYSTEM = `Tu aides un développeur à comprendre un dépôt qu'il ne connaît pas. Réponds en français, en un ou deux courts paragraphes (140 mots au plus).
On te décrit un dossier : ce qu'il contient, ce qui l'importe de l'extérieur et ce qu'il importe. Réponds à deux questions : qu'y a-t-il là-dedans, et pourquoi tant de fichiers pointent-ils vers lui. Appuie-toi sur les nombres fournis, sans en inventer.
Parle du dossier, pas d'un seul fichier qu'il contient. Ne juge pas la qualité du code, ne note rien.
${FORMAT_RULES}`;

export type Built = { text: string; shown: string[] };

const listOf = (items: readonly Neighbour[]): string =>
  items.length === 0
    ? "(aucun)"
    : items.map((n) => (n.role === null ? `- ${n.path}` : `- ${n.path} (${n.role})`)).join("\n");

// --- a file -------------------------------------------------------------------

export type FileInput = {
  path: string;
  role: string | null;
  repo: string;
  imports: readonly Neighbour[];
  dependents: readonly Neighbour[];
  /** The file's text, already cut to the length a prompt may carry. */
  source: string;
  clipped: boolean;
};

export function fileUserPrompt(input: FileInput): Built {
  const text = [
    `Fichier : ${input.path}${input.role === null ? "" : ` (${input.role})`}`,
    `Dépôt : ${input.repo}`,
    ``,
    `Fichiers qu'il importe (${input.imports.length}) :`,
    listOf(input.imports),
    ``,
    `Fichiers qui l'importent (${input.dependents.length}) :`,
    listOf(input.dependents),
    ``,
    `Contenu${input.clipped ? " (tronqué)" : ""} :`,
    input.source,
  ].join("\n");
  return {
    text,
    shown: [
      ...new Set([
        input.path,
        ...input.imports.map((n) => n.path),
        ...input.dependents.map((n) => n.path),
      ]),
    ],
  };
}

// --- a folded folder ------------------------------------------------------------

/** Files of the folder listed in the prompt; the rest is only counted. */
export const FOLDER_FILES_LISTED = 60;

export type FolderInput = {
  folderId: string;
  fileCount: number;
  lines: number;
  internalImports: number;
  /** Role label -> files of the folder with that role. */
  byRole: readonly (readonly [string, number])[];
  files: readonly Neighbour[];
  incomingTotal: number;
  incomingFrom: number;
  /** Files of the folder most imported from outside: path, count. */
  topInto: readonly (readonly [string, number])[];
  /** Outside files that import the folder most. */
  topFrom: readonly (readonly [string, number])[];
  /** Outside files the folder imports most. */
  topTowards: readonly (readonly [string, number])[];
};

const counted = (rows: readonly (readonly [string, number])[]): string =>
  rows.length === 0 ? "(aucun)" : rows.map(([p, c]) => `- ${p} (${c})`).join("\n");

export function folderUserPrompt(input: FolderInput): Built {
  const listed = input.files.slice(0, FOLDER_FILES_LISTED);
  const text = [
    `Dossier : ${input.folderId === "." ? "(racine du dépôt)" : input.folderId}`,
    `Contenu : ${input.fileCount} fichiers, ${input.lines} lignes au total, ${input.internalImports} imports entre ses propres fichiers.`,
    `Répartition : ${input.byRole.map(([r, c]) => `${r} ${c}`).join(", ")}.`,
    ``,
    `Fichiers du dossier :`,
    listOf(listed),
    input.fileCount > FOLDER_FILES_LISTED ? `(et ${input.fileCount - FOLDER_FILES_LISTED} autres)` : ``,
    ``,
    `Imports qui arrivent de l'extérieur : ${input.incomingTotal}, venant de ${input.incomingFrom} fichiers.`,
    `Fichiers du dossier les plus importés de l'extérieur :`,
    counted(input.topInto),
    `Fichiers extérieurs qui importent le plus ce dossier :`,
    counted(input.topFrom),
    ``,
    `Fichiers extérieurs que ce dossier importe le plus :`,
    counted(input.topTowards),
  ].join("\n");
  return {
    text,
    shown: [
      ...new Set([
        ...listed.map((n) => n.path),
        ...input.topInto.map(([p]) => p),
        ...input.topFrom.map(([p]) => p),
        ...input.topTowards.map(([p]) => p),
      ]),
    ],
  };
}
