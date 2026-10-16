// Can one organization use another's GitHub installation? Run it from a
// terminal:
//   pnpm check:installations
//
// It seeds two test organizations, each with an installation and a private
// analysis made through it, then acts as the second one and names the first's
// installation (and its analysis) by id through every public function that
// could take one. Each attempt must return nothing, change nothing and start
// nothing; the first organization's rows are compared before and after. The
// controls (the same calls as the owner) must work, or a refusal would prove
// nothing. Any FAIL exits 1; a check that cannot run says so and exits 1.
//
// Needs Convex reachable and the agent key pair (AGENT_PRIVATE_KEY here,
// AGENT_JWKS_URI on the deployment): it acts as a test organization with a
// token signed by the same key the app uses.

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { mintOrganizationToken } from "../lib/agent/credential.ts";
import { convexRun } from "../evals/lib/convex.ts";

process.loadEnvFile(".env.local");

const ORG_A = "org_check_a";
const ORG_B = "org_check_b";

type Seeded = {
  orgId: string;
  githubId: number;
  installationId: string;
  analysisId: string;
};
type Stored = { id: string; githubId: number; removed: boolean }[];
type AnalysisRows = { id: string }[];

let failures = 0;
function report(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : ` — ${detail}`}`);
}

async function refused(
  call: () => Promise<unknown>,
): Promise<{ threw: boolean; message: string }> {
  try {
    await call();
    return { threw: false, message: "" };
  } catch (error) {
    // A ConvexError carries its sentence in `data`; its `message` is only "Server Error".
    const data =
      typeof error === "object" && error !== null && "data" in error ? error.data : undefined;
    return {
      threw: true,
      message:
        typeof data === "string"
          ? data
          : error instanceof Error
            ? error.message.split("\n")[0]
            : String(error),
    };
  }
}

function clientFor(orgId: string): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (url === undefined || url === "") throw new Error("NEXT_PUBLIC_CONVEX_URL manque.");
  const client = new ConvexHttpClient(url);
  client.setAuth(mintOrganizationToken(orgId));
  return client;
}

const cleanup = () => {
  for (const org of [ORG_A, ORG_B]) {
    try {
      convexRun("orgData:deleteOrgData", { orgId: org });
    } catch (error) {
      console.error(
        `Nettoyage de ${org} impossible :`,
        error instanceof Error ? error.message : error,
      );
      failures++;
    }
  }
};

async function main() {
  const secret = process.env.PIPELINE_SECRET;
  if (secret === undefined || secret === "") {
    throw new Error("PIPELINE_SECRET manque dans .env.local.");
  }

  // Start clean: a previous interrupted run may have left rows.
  cleanup();

  const [a, b] = convexRun("seed:seedInstallations", { orgA: ORG_A, orgB: ORG_B }) as Seeded[];
  const asA = clientFor(ORG_A);
  const asB = clientFor(ORG_B);
  const aBefore = convexRun("evalData:installations", { orgId: ORG_A }) as Stored;
  const bAnalysesBefore = (convexRun("evalData:analyses", { orgId: ORG_B }) as AnalysisRows).length;

  // --- controls: the owner can do these, so a refusal below means something ---
  const ownList = (await asA.query(anyApi.installations.list, {})) as { id: string }[];
  report("contrôle : A voit sa propre installation", ownList.some((i) => i.id === a.installationId));

  const ownLink = (await asA.query(anyApi.installations.forAnalysis, {
    analysisId: a.analysisId,
  })) as { githubId: number } | null;
  report(
    "contrôle : A lit l'installation de son analyse",
    ownLink !== null && ownLink.githubId === a.githubId,
  );

  const ownProbe = await asA.query(anyApi.lookup.exists, {
    table: "installations",
    id: a.installationId,
  });
  report("contrôle : la sonde par id voit l'installation de A depuis A", ownProbe === true);

  // --- B names A's installation, through every function that could take one ---
  const bList = (await asB.query(anyApi.installations.list, {})) as { id: string }[];
  report(
    "B : sa liste d'installations ne contient pas celle de A",
    bList.every((i) => i.id !== a.installationId) && bList.some((i) => i.id === b.installationId),
  );

  const bActive = (await asB.query(anyApi.installations.active, {})) as { id: string }[];
  report(
    "B : la liste utilisable pour lancer une analyse ne contient pas celle de A",
    bActive.every((i) => i.id !== a.installationId),
  );

  const probe = await asB.query(anyApi.lookup.exists, {
    table: "installations",
    id: a.installationId,
  });
  report("B : la sonde par id ne voit pas l'installation de A", probe === false);

  const link = await asB.query(anyApi.installations.forAnalysis, { analysisId: a.analysisId });
  report("B : forAnalysis sur l'analyse de A -> rien", link === null);

  const progress = await asB.query(anyApi.analyses.progress, { analysisId: a.analysisId });
  report("B : progress sur l'analyse de A -> rien", progress === null);

  const files = (await asB.query(anyApi.graph.files, {
    analysisId: a.analysisId,
    paginationOpts: { numItems: 10, cursor: null },
  })) as { page: unknown[] };
  report(
    "B : les fichiers de l'analyse de A -> rien",
    files.page.length === 0,
    `${files.page.length}`,
  );

  const start = await refused(() =>
    asB.mutation(anyApi.analyses.startPrivate, {
      installationId: a.installationId,
      repo: "compte-7000001/autre",
    }),
  );
  report("B : startPrivate avec l'installation de A refusé", start.threw, start.message);

  const rerun = await refused(() =>
    asB.mutation(anyApi.analyses.requestRerun, { analysisId: a.analysisId }),
  );
  report("B : relancer l'analyse de A refusé", rerun.threw, rerun.message);

  const off = await refused(() =>
    asB.mutation(anyApi.installations.disconnect, { id: a.installationId }),
  );
  report("B : déconnecter l'installation de A refusé", off.threw, off.message);

  // Claiming A's GitHub installation as B: with the right secret it is refused
  // because it is taken; without it, because the browser has no secret.
  const claimTaken = await refused(() =>
    asB.mutation(anyApi.installations.claim, {
      githubId: a.githubId,
      account: "x",
      githubCreatedAt: Date.now(),
      secret,
    }),
  );
  report(
    "B : revendiquer l'installation GitHub de A (avec le secret) refusé",
    claimTaken.threw && claimTaken.message.includes("autre organisation"),
    claimTaken.message,
  );
  const claimBare = await refused(() =>
    asB.mutation(anyApi.installations.claim, {
      githubId: 7_000_999,
      account: "x",
      githubCreatedAt: Date.now(),
      secret: "pas-le-secret",
    }),
  );
  report("B : revendiquer sans le secret du serveur refusé", claimBare.threw, claimBare.message);

  const claimOld = await refused(() =>
    asB.mutation(anyApi.installations.claim, {
      githubId: 7_000_998,
      account: "x",
      githubCreatedAt: Date.now() - 60 * 60_000,
      secret,
    }),
  );
  report(
    "B : revendiquer une installation libre mais ancienne refusé",
    claimOld.threw && claimOld.message.includes("dix minutes"),
    claimOld.message,
  );

  // --- nothing changed, nothing started ---
  const aAfter = convexRun("evalData:installations", { orgId: ORG_A }) as Stored;
  report(
    "les installations de A sont inchangées",
    JSON.stringify(aAfter) === JSON.stringify(aBefore),
  );
  const bAnalysesAfter = (convexRun("evalData:analyses", { orgId: ORG_B }) as AnalysisRows).length;
  report(
    "B n'a lancé aucune analyse",
    bAnalysesAfter === bAnalysesBefore,
    `${bAnalysesBefore} -> ${bAnalysesAfter}`,
  );

  // --- a private repository first tried as a public address ---
  // It failed (GitHub answers "not found" to a private repository without a
  // token). Starting it from the list must take over THAT analysis, not hand
  // back the failure; a finished public analysis must stay public.
  const takeOver = (await asA.mutation(anyApi.analyses.startPrivate, {
    installationId: a.installationId,
    repo: "compte-7000001/echec",
  })) as { analysisId: string; created: boolean };
  const taken = (await asA.query(anyApi.analyses.progress, {
    analysisId: takeOver.analysisId,
  })) as { status: string; access: { removed: boolean } | null; error: string | null } | null;
  report(
    "A : un dépôt privé d'abord collé en public repart avec l'installation",
    takeOver.created === true &&
      taken !== null &&
      taken.status === "queued" &&
      taken.access?.removed === false &&
      taken.error === null,
    `created=${takeOver.created}, status=${taken?.status}`,
  );
  const publicOne = (await asA.mutation(anyApi.analyses.startPrivate, {
    installationId: a.installationId,
    repo: "compte-7000001/public",
  })) as { analysisId: string; created: boolean };
  const stayed = (await asA.query(anyApi.analyses.progress, {
    analysisId: publicOne.analysisId,
  })) as { status: string; access: unknown } | null;
  report(
    "A : une analyse publique terminée reste publique",
    publicOne.created === false && stayed !== null && stayed.status === "complete" && stayed.access === null,
  );
  const bTakes = await refused(() =>
    asB.mutation(anyApi.analyses.startPrivate, {
      installationId: b.installationId,
      repo: "compte-7000001/echec",
    }),
  );
  // B has no such project: this creates B's own, never touches A's failed one.
  const aFailedStill = (await asA.query(anyApi.analyses.progress, {
    analysisId: takeOver.analysisId,
  })) as { access: { account: string } | null } | null;
  report(
    "B : démarrer le même nom de dépôt ne touche pas l'analyse de A",
    !bTakes.threw && aFailedStill?.access?.account === "compte-7000001",
  );

  // --- a disconnected installation stops new runs through it ---
  await asA.mutation(anyApi.installations.disconnect, { id: a.installationId });
  const afterOff = await refused(() =>
    asA.mutation(anyApi.analyses.startPrivate, {
      installationId: a.installationId,
      repo: "compte-7000001/autre",
    }),
  );
  report(
    "A : après déconnexion, startPrivate refusé",
    afterOff.threw && afterOff.message.includes("plus connectée"),
    afterOff.message,
  );
  const rerunOff = await refused(() =>
    asA.mutation(anyApi.analyses.requestRerun, { analysisId: a.analysisId }),
  );
  report("A : après déconnexion, relancer refusé", rerunOff.threw, rerunOff.message);
  const stillThere = (await asA.query(anyApi.analyses.progress, {
    analysisId: a.analysisId,
  })) as { status: string; access: { removed: boolean } | null } | null;
  report(
    "A : l'analyse reste lisible et dit que l'installation est retirée",
    stillThere !== null && stillThere.status === "complete" && stillThere.access?.removed === true,
  );
}

main()
  .catch((error: unknown) => {
    console.error("FAIL  la vérification n'a pas pu s'exécuter :", error);
    failures++;
  })
  .then(() => {
    cleanup();
    console.log(failures === 0 ? "\nTout passe." : `\n${failures} échec(s).`);
    process.exit(failures === 0 ? 0 : 1);
  });
