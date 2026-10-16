// Does the masked trace client hide a prompt from the trace store? Run it from a
// terminal (one small model call, a few cents):
//   pnpm check:masking
//
// It makes two traced model calls through the application's own client: one as a
// private repository, one as a public one, each with a distinctive string in
// the prompt. Then it reads the runs back from LangSmith and looks for both.
// PASS means the private string is in no run, the public one IS (so the search
// can find something), and the private run still carries its cache metadata.

import { Client } from "langsmith";
import { traceable } from "langsmith/traceable";
import { ai, privateTracing } from "../lib/ai/client.ts";
process.loadEnvFile(".env.local");

const NEEDLE = `SECRET_PRIVE_${Math.random().toString(36).slice(2, 10)}`;
const PUBLIC_NEEDLE = `PUBLIC_${Math.random().toString(36).slice(2, 10)}`;

async function run(needle: string, isPrivate: boolean) {
  const traced = traceable(
    async (args: { note: string }) => {
      const message = await ai({ private: isPrivate }).messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 20,
        messages: [{ role: "user", content: `Répète exactement ce mot : ${args.note}` }],
      });
      return { answer: message.content.map((b) => (b.type === "text" ? b.text : "")).join("") };
    },
    {
      name: "probe-masquage",
      run_type: "chain",
      ...(isPrivate ? { client: privateTracing() } : {}),
      tags: ["probe", ...(isPrivate ? ["private"] : [])],
      metadata: { cache: "miss" },
    },
  );
  return traced({ note: needle });
}

const a = await run(NEEDLE, true);
const b = await run(PUBLIC_NEEDLE, false);
console.log("réponse privée :", a.answer.slice(0, 40));
console.log("réponse publique :", b.answer.slice(0, 40));
await privateTracing().awaitPendingTraceBatches();
await new Client().awaitPendingTraceBatches();
await new Promise((r) => setTimeout(r, 8000));

const client = new Client();
const project = process.env.LANGSMITH_PROJECT as string;
let seen = 0, hitPrivate = 0, hitPublic = 0, metaOk = 0;
for await (const r of client.listRuns({ projectName: project, startTime: new Date(Date.now() - 10 * 60_000) })) {
  if (!(r.tags ?? []).includes("probe") && r.name !== "probe-masquage" && !JSON.stringify(r).includes("claude-haiku")) continue;
  seen++;
  const text = JSON.stringify({ i: r.inputs, o: r.outputs, e: r.extra, err: r.error });
  if (text.includes(NEEDLE)) hitPrivate++;
  if (text.includes(PUBLIC_NEEDLE)) hitPublic++;
  if ((r.tags ?? []).includes("private") && JSON.stringify(r.extra).includes('"cache":"miss"')) metaOk++;
}
console.log(`runs regardés: ${seen} | chaîne privée trouvée dans ${hitPrivate} | chaîne publique trouvée dans ${hitPublic} | run privé avec métadonnée cache: ${metaOk}`);
const ok = hitPrivate === 0 && hitPublic > 0 && metaOk > 0;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
