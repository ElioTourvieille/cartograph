// Does the agent's credential hold? Run it from a terminal with the app running:
//   pnpm agent:check --org <orgId> --analysis <analysisId> --other <analysisId>
//
// It signs credentials with the real key and tries each way of using one that
// must not work, against the tools' HTTP surface and against Convex directly.
// Every line is PASS or FAIL; any FAIL exits 1. A check that cannot run (no key,
// app not reachable) fails loudly rather than reporting nothing.
//
//   --org       the organization that owns --analysis
//   --analysis  a COMPLETE analysis of that organization
//   --other     a different analysis (same organization is fine)
//   --url       where the app listens (default http://localhost:3000)

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { mintCredential } from "../lib/agent/credential.ts";

process.loadEnvFile(".env.local");

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}
function required(name: string): string {
  const value = option(name);
  if (value === undefined || value === "") {
    console.error(`FAIL  option --${name} manquante`);
    process.exit(1);
  }
  return value;
}

const org = required("org");
const analysis = required("analysis");
const other = required("other");
const base = option("url") ?? "http://localhost:3000";
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (convexUrl === undefined || convexUrl === "") {
  console.error("FAIL  NEXT_PUBLIC_CONVEX_URL manque dans .env.local");
  process.exit(1);
}

let failures = 0;
function report(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : ` — ${detail}`}`);
}

async function tool(name: string, token: string | null, input: unknown = {}) {
  const response = await fetch(`${base}/api/agent/tools/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ input }),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, body, text };
}

const hasData = (body: unknown): boolean =>
  typeof body === "object" && body !== null && "files" in body && Number(body.files) > 0;

async function main() {
  const valid = mintCredential({ orgId: org, analysisId: analysis });

  // 1. The credential does what it is for.
  const ok = await tool("summary", valid);
  report(
    "jeton valide : résumé de l'analyse",
    ok.status === 200 && hasData(ok.body),
    `HTTP ${ok.status}`,
  );

  const absent = await tool("neighbours", valid, { path: "does/not/exist.ts" });
  report(
    "jeton valide : chemin absent de l'analyse -> found:false",
    absent.status === 200 &&
      typeof absent.body === "object" &&
      absent.body !== null &&
      "found" in absent.body &&
      absent.body.found === false,
    `HTTP ${absent.status}`,
  );

  // 2. A credential for one analysis, aimed at another one, through Convex.
  const convex = new ConvexHttpClient(convexUrl as string);
  convex.setAuth(valid);
  const asked = (id: string) =>
    convex.query(anyApi.graph.files, {
      analysisId: id,
      paginationOpts: { numItems: 10, cursor: null },
    });
  const own = await asked(analysis);
  report(
    "jeton valide : lit son analyse (Convex)",
    own.page.length > 0,
    `${own.page.length} fichiers`,
  );
  const foreign = await asked(other);
  report(
    "jeton d'une analyse, lecture d'une autre : rien",
    foreign.page.length === 0,
    `${foreign.page.length} fichiers`,
  );
  // The same the other way round, which is the one that proves something when
  // --other has no rows of its own: a credential for it must read nothing of
  // the complete analysis, which has rows.
  const reversed = new ConvexHttpClient(convexUrl as string);
  reversed.setAuth(mintCredential({ orgId: org, analysisId: other }));
  const crossedRows = await reversed.query(anyApi.graph.files, {
    analysisId: analysis,
    paginationOpts: { numItems: 10, cursor: null },
  });
  report(
    "jeton de l'autre analyse, lecture de celle-ci : rien",
    crossedRows.page.length === 0,
    `${crossedRows.page.length} fichiers`,
  );
  let wide = "lu";
  try {
    await convex.query(anyApi.analyses.list, {});
  } catch {
    wide = "refusé";
  }
  report("jeton d'analyse : liste de l'organisation refusée", wide === "refusé", wide);

  // 3. It cannot write.
  let wrote = "écrit";
  try {
    await convex.mutation(anyApi.analyses.requestRerun, { analysisId: analysis });
  } catch {
    wrote = "refusé";
  }
  report("jeton d'analyse : écriture refusée", wrote === "refusé", wrote);

  // 4. An analysis in another organization.
  const foreignOrg = mintCredential({ orgId: "org_autre_organisation", analysisId: analysis });
  const crossed = await tool("summary", foreignOrg);
  report(
    "autre organisation : refusé, aucune donnée",
    crossed.status === 401 && !crossed.text.includes('"files"'),
    `HTTP ${crossed.status}`,
  );

  // 5. Expired.
  const now = Math.floor(Date.now() / 1000);
  const expired = mintCredential({ orgId: org, analysisId: analysis, now: now - 3600, ttl: 60 });
  const late = await tool("summary", expired);
  report(
    "jeton expiré : refusé",
    late.status === 401 && !late.text.includes('"files"'),
    `HTTP ${late.status}`,
  );

  // 6. Tampered: the claim is changed, the signature kept.
  const [head, payload, signature] = valid.split(".");
  const claims: Record<string, unknown> = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  claims.analysis = other;
  const forged = `${head}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
  const tampered = await tool("summary", forged);
  report(
    "jeton modifié : refusé",
    tampered.status === 401 && !tampered.text.includes('"files"'),
    `HTTP ${tampered.status}`,
  );

  // 7. No credential at all, and one that is not a token.
  const none = await tool("summary", null);
  report("sans jeton : refusé", none.status === 401, `HTTP ${none.status}`);
  const junk = await tool("summary", "pas-un-jeton");
  report("jeton illisible : refusé", junk.status === 401, `HTTP ${junk.status}`);
}

main()
  .catch((error: unknown) => {
    console.error("FAIL  la vérification n'a pas pu s'exécuter :", error);
    process.exit(1);
  })
  .then(() => {
    console.log(failures === 0 ? "\nTout passe." : `\n${failures} échec(s).`);
    process.exit(failures === 0 ? 0 : 1);
  });
