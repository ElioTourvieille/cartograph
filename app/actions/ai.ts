"use server";

import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AiError, aiStatus, type AiStatus } from "@/lib/ai/client";
import { classifyUnidentified, type Classification } from "@/lib/ai/classify";
import { explainFile, explainFolder, type Explanation } from "@/lib/ai/explain";
import { fetchSource, sha256 } from "@/lib/ai/source";
import { latestCommit } from "@/lib/pipeline/github";

// What the explain pane and the classify control call. Every model call runs
// here, in server code, with the person's own token still valid, and writes
// back through the org-scoped functions. None of it ever touches the pipeline's
// secret.

export type ExplainOutcome =
  | ({ ok: true } & Explanation)
  | { ok: false; error: string };

export type ClassifyOutcome =
  | ({ ok: true } & Classification)
  | { ok: false; error: string };

export type Freshness =
  | {
      ok: true;
      /** The repository has commits the analysis does not include. */
      repoMoved: boolean;
      /** This file's content differs from the analysed one; null for a folder. */
      fileChanged: boolean | null;
      head: string;
    }
  | { ok: false };

const jwt = async (): Promise<string | null> => (await auth()).getToken();

function reason(error: unknown): string {
  if (error instanceof AiError) return error.message;
  if (error instanceof ConvexError) return String(error.data);
  console.error("[actions/ai]", error);
  return "Le modèle n'a pas pu répondre. Réessayez dans un instant.";
}

export async function explainFileAction(
  analysisId: Id<"analyses">,
  path: string,
): Promise<ExplainOutcome> {
  const token = await jwt();
  if (token === null) return { ok: false, error: "Session expirée : reconnectez-vous." };
  try {
    return { ok: true, ...(await explainFile(token, { analysisId, path })) };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

export async function explainFolderAction(
  analysisId: Id<"analyses">,
  folderId: string,
  paths: string[],
): Promise<ExplainOutcome> {
  const token = await jwt();
  if (token === null) return { ok: false, error: "Session expirée : reconnectez-vous." };
  try {
    return { ok: true, ...(await explainFolder(token, { analysisId, folderId, paths })) };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

export async function classifyAction(
  analysisId: Id<"analyses">,
  skip: number,
): Promise<ClassifyOutcome> {
  const token = await jwt();
  if (token === null) return { ok: false, error: "Session expirée : reconnectez-vous." };
  try {
    return { ok: true, ...(await classifyUnidentified(token, { analysisId, skip })) };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

/** Whether the model key and tracing are set up, so an absent key is visible. */
export async function aiStatusAction(): Promise<AiStatus> {
  return aiStatus();
}

// Is what was explained still what is in the repository? The stored hash is
// compared with the file at the repository's head, and the head commit with
// the one that was analysed. Not a model call, so not traced.
export async function freshnessAction(
  analysisId: Id<"analyses">,
  path: string | null,
): Promise<Freshness> {
  const token = await jwt();
  if (token === null) return { ok: false };
  try {
    const progress = await fetchQuery(api.analyses.progress, { analysisId }, { token });
    if (progress === null || progress.repo === null || progress.commitSha === null) {
      return { ok: false };
    }
    const [owner, name] = progress.repo.split("/");
    const head = await latestCommit(owner, name);
    const repoMoved = head !== progress.commitSha;

    if (path === null) return { ok: true, repoMoved, fileChanged: null, head };
    if (!repoMoved) return { ok: true, repoMoved, fileChanged: false, head };

    const [stored] = await fetchQuery(
      api.explanations.hashes,
      { analysisId, paths: [path] },
      { token },
    );
    const current = await fetchSource(owner, name, head, path);
    // A file that is gone at the head counts as changed.
    const fileChanged = stored === undefined || current === null || sha256(current) !== stored.hash;
    return { ok: true, repoMoved, fileChanged, head };
  } catch {
    return { ok: false };
  }
}
