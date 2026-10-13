import { ai } from "../../lib/ai/client.ts";
import { EXPLAIN_MODEL } from "../../lib/ai/models.ts";

// The judge of the prompt comparison. A model is used here, and that is
// unavoidable: "is this specific enough to be useful" has no exact answer, so
// unlike the invented-path check this number is a model's opinion, and is
// harder to defend than a set-membership test. It is stated everywhere it is
// shown.
//
// Pinned by exact identifier. It is deliberately a DIFFERENT model from the one
// being judged (EXPLAIN_MODEL): a model grading its own writing is the weaker
// design, and a larger one grading a smaller one's output is the safer one.
// The judge is blind: it is never told which prompt produced the text.

export const JUDGE_MODEL = "claude-opus-5-5";

// Compared as plain strings, so it is still checked at run time if either
// identifier is re-pinned to the other's value.
const sameModel = (a: string, b: string): boolean => a === b;
export const JUDGE_IS_DIFFERENT_FROM_JUDGED = !sameModel(JUDGE_MODEL, EXPLAIN_MODEL);

// This model refuses a forced tool call, so the answer is one strict line that
// is parsed and validated below. An answer that does not match is an error, not
// a zero: a judge that could not judge must never look like a low score.
const SYSTEM = `Tu évalues l'explication d'un fichier de code, écrite pour un développeur qui découvre le dépôt. Note-la de 1 à 5 selon sa précision utile :
5 = dit concrètement ce que fait le fichier ET sa relation à des voisins précis, cités par leur chemin exact, de façon vérifiable avec les listes fournies.
4 = concret et juste, mais la relation aux voisins est partielle.
3 = juste mais en partie générique : on apprend peu qu'on ne devinerait pas du nom du fichier.
2 = surtout générique ou vague, avec peu d'éléments concrets.
1 = générique ou creux : pourrait décrire n'importe quel fichier.
Ne récompense ni la longueur ni le ton. Une affirmation sur un fichier qui n'est pas dans les listes fournies n'est pas concrète : elle ne compte pas en sa faveur.
Réponds par une seule ligne, exactement de la forme :
NOTE=<un chiffre de 1 à 5> | <une phrase qui justifie la note>`;

export type Verdict = { score: number; reason: string };

const ANSWER = /NOTE\s*=\s*([1-5])\s*\|\s*(.+)/;

export async function judge(args: {
  path: string;
  imports: readonly string[];
  dependents: readonly string[];
  explanation: string;
}): Promise<Verdict> {
  const list = (paths: readonly string[]): string =>
    paths.length === 0 ? "(aucun)" : paths.map((p) => `- ${p}`).join("\n");
  const prompt = [
    `Fichier : ${args.path}`,
    `Fichiers qu'il importe :\n${list(args.imports)}`,
    `Fichiers qui l'importent :\n${list(args.dependents)}`,
    ``,
    `Explication à noter :`,
    args.explanation,
  ].join("\n");

  // An empty or malformed answer is asked for again, up to three times. After
  // that it is an error: it is never turned into a score.
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const message = await ai().messages.create({
      model: JUDGE_MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    last = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
    const match = ANSWER.exec(last);
    if (match !== null) return { score: Number(match[1]), reason: match[2].trim() };
  }
  throw new Error(`Le juge n'a pas renvoyé de note exploitable après 3 essais : « ${last.slice(0, 120)} »`);
}
