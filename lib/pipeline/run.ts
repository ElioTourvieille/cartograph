import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { ConvexError } from "convex/values";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BATCH } from "@/convex/lib/limits";
import { SKIPPED_SHOWN, type Stage } from "@/convex/lib/validators";
import type { ParseResult } from "@/parser/types";
import { parseResult } from "@/parser/validate";
import { GithubAppError, InstallationGone, installationToken } from "@/lib/github/app";
import { downloadArchive, latestCommit, PipelineError, type NotExtracted } from "./github";

// One run, end to end: fetch, select, parse, store. It runs in the Next.js
// server, never inside Convex, and it writes to Convex only through the
// pipeline functions, handing them the analysis id and the server-only secret.
// The secret is read from the environment here and goes no further than the
// call to Convex; nothing in this file is imported by browser code.

const PARSE_TIMEOUT_MS = 15 * 60_000;
const HEARTBEAT_MS = 30_000;

export async function runPipeline(analysisId: Id<"analyses">): Promise<void> {
  const secret = process.env.PIPELINE_SECRET;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!secret || !url) {
    // Without the secret there is no way to write a failure either. The
    // scheduled check marks the run abandoned; this makes the cause visible.
    console.error("[pipeline] PIPELINE_SECRET ou NEXT_PUBLIC_CONVEX_URL manque dans .env.local.");
    return;
  }
  const convex = new ConvexHttpClient(url);
  const base = { analysisId, secret };

  let stage: Stage = "fetch";
  let claimed = false;
  let dir: string | undefined;
  const beat = setInterval(() => {
    void convex.mutation(api.pipeline.touch, base).catch(() => {});
  }, HEARTBEAT_MS);
  const timings: Record<string, number> = {};
  let mark = Date.now();
  const lap = (name: string) => {
    timings[name] = (Date.now() - mark) / 1000;
    mark = Date.now();
  };

  try {
    const target = await convex.mutation(api.pipeline.begin, base);
    claimed = true;

    // --- access (private repositories only) ----------------------------------
    // The installation came off the analysis row, never from a caller. A token
    // is minted for this run, narrowed to reading contents, held in this
    // variable and dropped once the archive is down. A public repository takes
    // none of this and uses no token at all.
    let token: string | undefined;
    if (target.installation !== null) {
      stage = "access";
      const { githubId, account, removed } = target.installation;
      if (removed) {
        throw new PipelineError(
          `L'installation GitHub de ${account} n'est plus connectée : le dépôt ne peut plus être relu. L'analyse existante reste lisible.`,
        );
      }
      try {
        token = await installationToken(githubId);
      } catch (error) {
        if (error instanceof InstallationGone) {
          await convex.mutation(api.pipeline.installationGone, base);
          throw new PipelineError(
            `L'installation GitHub de ${account} a disparu : l'App a été désinstallée sur GitHub. L'analyse existante reste lisible.`,
          );
        }
        if (error instanceof GithubAppError) throw new PipelineError(error.message);
        throw error;
      }
      stage = "fetch";
    }

    // --- fetch -------------------------------------------------------------
    const sha = await latestCommit(target.owner, target.name, token);
    await convex.mutation(api.pipeline.setStage, {
      ...base,
      stage: "fetch",
      message: `Téléchargement de l'archive (commit ${sha.slice(0, 7)}).`,
      commitSha: sha,
    });
    dir = await mkdtemp(join(tmpdir(), "cartograph-"));
    const notExtracted = await downloadArchive(target.owner, target.name, sha, dir, token);
    token = undefined; // thrown away: nothing after this reads GitHub
    lap("fetch");

    // --- select, parse ------------------------------------------------------
    const result = await parseInChild(dir, async (next) => {
      stage = next;
      await convex.mutation(api.pipeline.setStage, {
        ...base,
        stage: next,
        message:
          next === "select"
            ? "Sélection des fichiers du dépôt."
            : "Lecture des imports et résolution des liens.",
      });
    });
    lap("select+parse");

    // --- store ---------------------------------------------------------------
    stage = "store";
    await convex.mutation(api.pipeline.setStage, {
      ...base,
      stage: "store",
      message: "Enregistrement du résultat.",
    });
    // A re-run clears what the previous one wrote before it writes anything.
    for (;;) {
      const { done } = await convex.mutation(api.pipeline.clear, base);
      if (done) break;
    }

    for (let i = 0; i < result.files.length; i += BATCH) {
      await convex.mutation(api.pipeline.writeFiles, {
        ...base,
        message: `Écriture des fichiers : ${Math.min(i + BATCH, result.files.length)} sur ${result.files.length}.`,
        files: result.files.slice(i, i + BATCH).map((f) => ({
          path: f.path,
          folder: f.folder,
          lines: f.lines,
          hash: f.hash,
        })),
      });
    }

    // One row per (from, to, kind), as the schema stores them.
    const edges = result.edges.flatMap((e) =>
      e.kinds.map((kind) => ({ from: e.from, to: e.to, kind })),
    );
    for (let i = 0; i < edges.length; i += BATCH) {
      await convex.mutation(api.pipeline.writeEdges, {
        ...base,
        message: `Écriture des liens : ${Math.min(i + BATCH, edges.length)} sur ${edges.length}.`,
        edges: edges.slice(i, i + BATCH),
      });
    }

    for (let i = 0; i < result.roles.length; i += BATCH) {
      await convex.mutation(api.pipeline.writeRoles, {
        ...base,
        message: `Écriture des rôles : ${Math.min(i + BATCH, result.roles.length)} sur ${result.roles.length}.`,
        roles: result.roles.slice(i, i + BATCH),
      });
    }
    for (let i = 0; i < result.routes.length; i += BATCH) {
      await convex.mutation(api.pipeline.writeRoutes, {
        ...base,
        message: `Écriture des routes : ${Math.min(i + BATCH, result.routes.length)} sur ${result.routes.length}.`,
        routes: result.routes.slice(i, i + BATCH),
      });
    }

    await convex.mutation(api.pipeline.complete, {
      ...base,
      commitSha: sha,
      coverage: coverageOf(result, notExtracted),
      frameworks: result.frameworks,
    });
    lap("store");
    console.log(
      `[pipeline] ${analysisId} terminé : ${result.files.length} fichiers, ${edges.length} liens, ${result.roles.length} rôles, ${result.routes.length} routes, lots de ${BATCH}, ` +
        Object.entries(timings)
          .map(([k, s]) => `${k} ${s.toFixed(1)} s`)
          .join(", "),
    );
  } catch (error) {
    console.error(`[pipeline] ${analysisId} échec au stade ${stage} :`, error);
    // Never write a failure onto a run this process did not claim: that row
    // may belong to another run that is working fine.
    if (claimed) {
      await convex
        .mutation(api.pipeline.fail, { ...base, stage, error: explain(error) })
        .catch(() => {});
    }
  } finally {
    clearInterval(beat);
    // The checkout is temporary: it exists for the length of the run and is
    // removed when it ends, success or failure, along with the parser's result
    // file that sits beside it.
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      await rm(join(dir, "..", `${dir.split(/[\\/]/).pop()}-resultat.json`), { force: true }).catch(
        () => {},
      );
    }
  }
}

function explain(error: unknown): string {
  if (error instanceof PipelineError) return error.message;
  if (error instanceof ConvexError) return String(error.data);
  return `Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`;
}

// The parser runs in its own process so a big repository cannot freeze this
// server. It reports each stage as it starts, and leaves the result in a file.
async function parseInChild(
  dir: string,
  onStage: (stage: "select" | "parse") => Promise<void>,
): Promise<ParseResult> {
  const out = join(dir, "..", `${dir.split(/[\\/]/).pop()}-resultat.json`);
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--max-old-space-size=4096",
      join(process.cwd(), "parser", "run.ts"),
      dir,
      out,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

  // Stage lines are handled one after the other, so the stored stage never
  // runs backwards.
  let chain: Promise<void> = Promise.resolve();
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const { stage } = JSON.parse(line) as { stage?: unknown };
      if (stage === "select" || stage === "parse") {
        chain = chain.then(() => onStage(stage));
      }
    } catch {
      // Not a stage line: ignored.
    }
  });

  const timer = setTimeout(() => child.kill(), PARSE_TIMEOUT_MS);
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  await chain;

  if (code !== 0) {
    throw new PipelineError(
      code === null
        ? `L'analyse du code a dépassé ${PARSE_TIMEOUT_MS / 60000} minutes.`
        : `L'analyse du code a échoué : ${stderr.trim().split("\n")[0] || `code ${code}`}`,
    );
  }
  try {
    return parseResult(JSON.parse(await readFile(out, "utf8")));
  } finally {
    await rm(out, { force: true });
  }
}

// What the explorer's banner needs, from the parser's report, plus the files
// the archive could not even unpack: those never reached the parser, so they
// are added to what was found and to what was skipped, never left out.
function coverageOf(result: ParseResult, notExtracted: NotExtracted[]) {
  const c = result.coverage;
  return {
    filesFound: c.files.found + notExtracted.length,
    filesParsed: c.files.parsed,
    filesSkipped: c.files.skipped + notExtracted.length,
    skipped: [...c.skipped, ...notExtracted].slice(0, SKIPPED_SHOWN),
    ignoredDirectories: c.ignoredDirectories.length,
    imports: c.imports,
    unresolved: c.unresolved,
    excluded: c.excluded,
    tsconfig: c.tsconfig,
    tsconfigError: c.tsconfigError,
  };
}
