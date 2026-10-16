import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GithubAppError, InstallationGone, installationToken } from "./app";

// How server code reaches the repository of an analysis AFTER the run: to
// explain a file, to label files, to check whether the repository has moved.
// Whether an analysis is private, and through which installation, is read off
// its own row under the person's verified token. It is never taken from the
// request, so naming another organization's installation gets nothing: that
// row is not visible to this token.

export type Access =
  | { private: false }
  | { private: true; githubId: number; account: string; removed: boolean };

/** The repository cannot be reached now. The message is what the person reads. */
export class RepoUnreachable extends Error {}

export async function accessOf(token: string, analysisId: Id<"analyses">): Promise<Access> {
  const row = await fetchQuery(api.installations.forAnalysis, { analysisId }, { token });
  if (row !== null) return { private: true, ...row };
  // Null means no installation row is visible for this analysis: a public
  // analysis, OR a private one whose installation row cannot be read. Ask the
  // analysis itself, so a private analysis is never mistaken for a public one
  // and read without a token.
  const progress = await fetchQuery(api.analyses.progress, { analysisId }, { token });
  if (progress !== null && progress.access !== null) {
    return { private: true, githubId: 0, account: progress.access.account, removed: true };
  }
  return { private: false };
}

/**
 * A token to read this analysis's repository for one request, or undefined for
 * a public repository, which needs none. Minted now, never stored: the caller
 * holds it for the request and lets it go.
 */
export async function tokenFor(access: Access): Promise<string | undefined> {
  if (!access.private) return undefined;
  if (access.removed) {
    throw new RepoUnreachable(
      access.account === ""
        ? "L'installation GitHub de ce dépôt n'est plus connectée : le dépôt ne peut plus être relu."
        : `L'installation GitHub de ${access.account} n'est plus connectée : le dépôt ne peut plus être relu.`,
    );
  }
  try {
    return await installationToken(access.githubId);
  } catch (error) {
    if (error instanceof InstallationGone) {
      throw new RepoUnreachable(
        `L'installation GitHub de ${access.account} a disparu : l'App a été désinstallée. Le dépôt ne peut plus être relu.`,
      );
    }
    if (error instanceof GithubAppError) throw new RepoUnreachable(error.message);
    throw error;
  }
}
