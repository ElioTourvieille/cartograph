"use server";

import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { after } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseRepoUrl } from "@/convex/lib/repoUrl";
import {
  canRead,
  GithubAppError,
  installationToken,
  InstallationGone,
  listRepositories,
} from "@/lib/github/app";
import { runPipeline } from "@/lib/pipeline/run";

// The dashboard's second way in: pick a repository from the ones the
// organization's installations can see. Nothing the browser sends is trusted
// to name an installation: the ones that may be used are read from Convex under
// the person's own token (so only their organization's, only connected), and a
// chosen one must be among them. The list of repositories is fetched from
// GitHub each time it is asked for and never stored.

export type RepoGroup = {
  installationId: Id<"installations">;
  account: string;
  repos: string[];
  /** How many the installation can see, when that is more than is listed. */
  total: number;
  /** Set when the installation could not be listed, in words. */
  error: string | null;
};

export type RepoListResult = { ok: true; groups: RepoGroup[] } | { ok: false; error: string };

export type StartPrivateResult =
  | { ok: true; id: Id<"analyses"> }
  | { ok: false; error: string };

const jwt = async (): Promise<string | null> => (await auth()).getToken();

function reason(error: unknown): string {
  if (error instanceof ConvexError) return String(error.data);
  if (error instanceof GithubAppError) return error.message;
  console.error("[actions/github]", error);
  return "Une erreur est survenue. Réessayez.";
}

export async function listPrivateRepos(): Promise<RepoListResult> {
  const token = await jwt();
  if (token === null) return { ok: false, error: "Session expirée : reconnectez-vous." };
  try {
    const installations = await fetchQuery(api.installations.active, {}, { token });
    const groups: RepoGroup[] = [];
    for (const installation of installations) {
      try {
        const ghToken = await installationToken(installation.githubId);
        const { repos, total } = await listRepositories(ghToken);
        groups.push({
          installationId: installation.id,
          account: installation.account,
          repos,
          total,
          error: null,
        });
      } catch (error) {
        groups.push({
          installationId: installation.id,
          account: installation.account,
          repos: [],
          total: 0,
          error:
            error instanceof InstallationGone
              ? "L'App a été désinstallée sur GitHub."
              : reason(error),
        });
      }
    }
    return { ok: true, groups };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

export async function startPrivateAnalysis(
  installationId: Id<"installations">,
  repo: string,
): Promise<StartPrivateResult> {
  const token = await jwt();
  if (token === null) return { ok: false, error: "Session expirée : reconnectez-vous." };
  try {
    // Only an installation of THIS organization, still connected, is in this list.
    const installations = await fetchQuery(api.installations.active, {}, { token });
    const chosen = installations.find((i) => i.id === installationId);
    if (chosen === undefined) return { ok: false, error: "Installation introuvable." };

    const parsed = parseRepoUrl(`https://github.com/${repo}`);
    const ghToken = await installationToken(chosen.githubId);
    if (!(await canRead(ghToken, parsed.owner, parsed.name))) {
      return { ok: false, error: "Ce dépôt n'est pas accessible à cette installation GitHub." };
    }

    const { analysisId, created } = await fetchMutation(
      api.analyses.startPrivate,
      { installationId: chosen.id, repo: `${parsed.owner}/${parsed.name}` },
      { token },
    );
    // The run mints its own token from the installation on the analysis row.
    if (created) after(() => runPipeline(analysisId));
    return { ok: true, id: analysisId };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
