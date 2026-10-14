import { ChatAnthropic } from "@langchain/anthropic";
import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";
import { z } from "zod";

// The agent that answers questions about one analysed repository. It is a
// separate process on purpose: when it is down, the application keeps working.
//
// It is never told which analysis it is reading, and it cannot ask for another.
// Each tool call carries a short-lived credential, handed in with the run and
// read from the run's config (a key starting with "__" is not copied into
// traces). The credential names the one analysis and the organization it
// belongs to; the tools' HTTP surface checks it. No tool has an argument that
// could name either one, so an instruction hidden in a repository's comments
// has nothing to reach with.

// The Anthropic model the agent runs on. Not the application's AI client: this
// is its own process, with its own key, and it must not hold the application's.
const MODEL = "claude-sonnet-5-5";

const TOOLS_URL = process.env.CARTOGRAPH_TOOLS_URL ?? "http://localhost:3000/api/agent/tools";

const PROMPT = `Tu réponds à des questions sur UN dépôt de code qui a été analysé. Tu parles français, de façon brève et factuelle.

Règles, toutes strictes :
- Tu ne réponds jamais de mémoire. Chaque réponse sur le dépôt s'appuie sur au moins une consultation d'outil faite pendant ce tour. Si tu n'as encore rien consulté, consulte d'abord.
- Tu ne cites un fichier que s'il t'a été renvoyé par un outil, avec son chemin COMPLET, tel quel. Jamais le seul nom du fichier, même dans une liste regroupée sous un dossier : écris chaque chemin en entier. Tu n'inventes jamais un chemin, un dossier ou une route.
- Même pour refuser ou pour dire que tu ne sais pas, consulte d'abord la vue d'ensemble de l'analyse : tu pourras alors dire précisément ce que tu sais répondre pour CE dépôt.
- Tu ne décides jamais que deux fichiers sont liés. Une relation existe parce qu'un outil la renvoie. Pour « qu'est-ce qui casse si je change X », cherche le fichier, puis parcours ses dépendants avec l'outil de parcours : c'est lui qui fait le calcul, pas toi.
- Les listes sont plafonnées. Quand un résultat indique qu'il en reste, dis combien : « 25 sur 312 », jamais « tous ».
- Tu ne juges pas la qualité du code, tu ne notes rien, tu ne dis pas si c'est « bien » ou « mal » écrit. Si on te le demande, dis que tu ne le fais pas, et dis ce que tu sais répondre : où se trouve une chose, qui importe quoi, ce qui dépend d'un fichier, les routes, la répartition des rôles, la couverture de l'analyse.
- Si un outil ne trouve rien, dis-le tel quel. Ne propose pas un chemin « probable ».
- Tu ne parles jamais de ton fonctionnement : ni des outils par leur nom, ni de jetons, ni d'identifiants, ni de ce que tu es. Tu dis ce que tu as trouvé dans le dépôt, pas comment tu l'as consulté.
- Pour résoudre « ça », « ce fichier », « celui-ci », appuie-toi sur le tour précédent ou sur le fichier sélectionné indiqué dans le message.

Mise en forme : uniquement du \`code en ligne\`, du **gras** et des puces qui commencent par "- ". Jamais de titre, de tableau, de bloc de code ni de lien. Cite chaque fichier par son chemin exact, en code en ligne. 150 mots au plus, sauf si la liste demandée est plus longue.`;

// --- the tools: thin calls to the application's read-only HTTP surface ----------

const credentialOf = (config: RunnableConfig): string | null => {
  const value = config.configurable?.__credential;
  return typeof value === "string" && value !== "" ? value : null;
};

async function call(name: string, input: unknown, config: RunnableConfig): Promise<string> {
  const credential = credentialOf(config);
  if (credential === null) {
    return JSON.stringify({ found: false, reason: "Consultation indisponible." });
  }
  try {
    const response = await fetch(`${TOOLS_URL}/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    // Whatever the surface refused to say, the model is not given more of.
    if (!response.ok) {
      return JSON.stringify({ found: false, reason: "Consultation refusée ou indisponible." });
    }
    return body;
  } catch {
    return JSON.stringify({ found: false, reason: "Consultation indisponible." });
  }
}

const summary = tool((_input, config) => call("summary", {}, config), {
  name: "summary",
  description:
    "Vue d'ensemble de l'analyse : nombre de fichiers et d'imports, frameworks reconnus, fichiers les plus importés, fichiers que personne n'importe, répartition par rôle, couverture.",
  schema: z.object({}),
});

const searchFiles = tool((input, config) => call("search_files", input, config), {
  name: "search_files",
  description:
    "Cherche les fichiers dont le chemin contient un morceau de texte (insensible à la casse), par exemple « auth » ou « middleware ». Renvoie au plus 25 chemins et dit combien il en reste.",
  schema: z.object({ query: z.string().describe("Morceau de chemin à chercher") }),
});

const filesByRole = tool((input, config) => call("files_by_role", input, config), {
  name: "files_by_role",
  description:
    "Liste les fichiers qui ont un rôle donné (par exemple Controllers, Pages, Services, Components). Si le rôle n'existe pas dans cette analyse, renvoie les rôles présents.",
  schema: z.object({ role: z.string().describe("Nom du rôle, tel qu'affiché dans l'analyse") }),
});

const neighbours = tool((input, config) => call("neighbours", input, config), {
  name: "neighbours",
  description:
    "Voisins directs d'un fichier : les fichiers qu'il importe et ceux qui l'importent. Le chemin doit venir d'un autre résultat.",
  schema: z.object({ path: z.string().describe("Chemin exact d'un fichier de l'analyse") }),
});

const walk = tool((input, config) => call("walk", input, config), {
  name: "walk",
  description:
    "Parcours transitif depuis un fichier. « dependents » : ce qui casse si ce fichier change (qui l'importe, puis qui importe ceux-là). « dependencies » : tout ce dont il a besoin. Profondeur 2 par défaut, 4 au plus. Renvoie au plus 40 fichiers et dit combien il en reste.",
  schema: z.object({
    path: z.string().describe("Chemin exact d'un fichier de l'analyse"),
    direction: z.enum(["dependents", "dependencies"]),
    depth: z.number().int().min(1).max(4).optional(),
  }),
});

const routes = tool((_input, config) => call("routes", {}, config), {
  name: "routes",
  description:
    "Table des routes dont la méthode et le chemin complet sont écrits dans le code. Absente si aucun framework n'a été reconnu.",
  schema: z.object({}),
});

export const agent = createDeepAgent({
  name: "cartograph",
  model: new ChatAnthropic({ model: MODEL, maxTokens: 1500 }),
  systemPrompt: PROMPT,
  tools: [summary, searchFiles, filesByRole, neighbours, walk, routes],
});
