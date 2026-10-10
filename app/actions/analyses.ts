"use server";

import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { after } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { runPipeline } from "@/lib/pipeline/run";

// The two ways a run begins. Both go through a mutation under the person's own
// verified token, so the organization is theirs and nothing else. Only after
// that mutation has created or reset the row does the pipeline start, in the
// background of this same server (after the response has gone), which is where
// parsing is meant to run.

export type StartResult =
  | { ok: true; id: Id<"analyses">; created: boolean }
  | { ok: false; error: string };

export type RerunResult = { ok: true } | { ok: false; error: string };

function reason(error: unknown): string {
  if (error instanceof ConvexError) return String(error.data);
  // The person gets a plain sentence; the cause stays readable in this
  // server's terminal instead of vanishing.
  console.error("[actions/analyses]", error);
  return "Une erreur est survenue. Réessayez.";
}

async function token(): Promise<string | null> {
  return (await auth()).getToken();
}

export async function startAnalysis(repoUrl: string): Promise<StartResult> {
  const jwt = await token();
  if (jwt === null) return { ok: false, error: "Session expirée : reconnectez-vous." };
  try {
    const { analysisId, created } = await fetchMutation(
      api.analyses.start,
      { repoUrl },
      { token: jwt },
    );
    // An address already analysed leads to the existing analysis: no second
    // row, and no second run.
    if (created) after(() => runPipeline(analysisId));
    return { ok: true, id: analysisId, created };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

export async function rerunAnalysis(id: Id<"analyses">): Promise<RerunResult> {
  const jwt = await token();
  if (jwt === null) return { ok: false, error: "Session expirée : reconnectez-vous." };
  try {
    await fetchMutation(api.analyses.requestRerun, { analysisId: id }, { token: jwt });
    after(() => runPipeline(id));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
