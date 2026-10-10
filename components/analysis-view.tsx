"use client";

import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { rerunAnalysis } from "@/app/actions/analyses";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { READ_PAGE } from "@/convex/lib/limits";
import { Explorer } from "@/components/explorer/explorer";
import { STAGE_LABEL, STAGE_ORDER } from "@/components/stages";
import type { StoredCoverage } from "@/graph/coverage";
import { computeFan } from "@/parser/metrics";
import type { Graph } from "@/graph/types";
import { fallbackAdapter } from "@/parser/adapter";
import type { EdgeKind } from "@/parser/types";

const DATE = new Intl.DateTimeFormat("fr-CH", { dateStyle: "short", timeStyle: "medium" });

// One analysis. While it runs, a subscribed query names the stage as it
// happens; when it has failed, it says why and where; when it is complete, the
// explorer loads the whole analysis once and works on it locally.
export function AnalysisView({ id }: { id: string }) {
  const { isAuthenticated } = useConvexAuth();
  const progress = useQuery(api.analyses.progress, isAuthenticated ? { analysisId: id } : "skip");

  if (progress === undefined) return <p className="text-xs text-muted">…</p>;
  if (progress === null) return <p className="text-xs">Analyse introuvable.</p>;

  if (progress.status === "complete") {
    return (
      <Loaded
        id={id}
        analysisId={progress.id}
        repo={progress.repo}
        commit={progress.commitSha}
        coverage={progress.coverage}
      />
    );
  }

  const failed = progress.status === "failed";
  const current = failed ? progress.failedStage : progress.stage;
  const at = current === null ? 0 : STAGE_ORDER.indexOf(current);

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <div>
        <h1 className="font-mono text-xs font-semibold">{progress.repo ?? "Dépôt inconnu"}</h1>
        <p className="text-xs text-muted">
          Démarrée le {DATE.format(progress.startedAt)}
          {progress.commitSha !== null && ` · commit ${progress.commitSha.slice(0, 7)}`}
        </p>
      </div>

      <ol className="flex flex-col gap-1 text-xs">
        {STAGE_ORDER.map((stage, i) => {
          const state = i < at ? "done" : i === at ? (failed ? "failed" : "current") : "todo";
          return (
            <li key={stage} className={state === "todo" ? "text-muted" : ""}>
              <span className="inline-block w-24 font-mono text-[10px] text-muted">
                {state === "done" ? "terminé" : state === "current" ? "en cours" : state === "failed" ? "échec" : "à venir"}
              </span>
              <span className={state === "current" || state === "failed" ? "font-semibold" : ""}>
                {STAGE_LABEL[stage]}
              </span>
              {state === "current" && progress.message !== null && (
                <p className="ml-24 text-muted">{progress.message}</p>
              )}
            </li>
          );
        })}
      </ol>

      {failed && (
        <div className="flex flex-col gap-2 border-t border-border pt-2 text-xs">
          <p>{progress.error ?? "L'analyse a échoué."}</p>
          <Rerun id={progress.id} />
        </div>
      )}
    </div>
  );
}

// Re-running clears the analysis and writes it again, and the map goes away
// while it runs. On a finished analysis it therefore asks twice.
function Rerun({ id, confirm = false }: { id: Id<"analyses">; confirm?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      const result = await rerunAnalysis(id);
      if (!result.ok) setError(result.error);
    });
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => (confirm && !armed ? setArmed(true) : run())}
        onBlur={() => setArmed(false)}
        className={
          confirm
            ? "shrink-0 cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] disabled:cursor-default disabled:opacity-50"
            : "w-fit cursor-pointer rounded border border-border px-3 py-1 disabled:cursor-default disabled:opacity-50"
        }
      >
        {pending ? "Relance…" : armed ? "Confirmer la relance" : "Relancer l'analyse"}
      </button>
      {error !== null && <p>{error}</p>}
    </div>
  );
}

// The whole analysis, loaded once in pages. After this nothing calls a
// function: the explorer computes everything from these rows.
function Loaded({
  id,
  analysisId,
  repo,
  commit,
  coverage,
}: {
  id: string;
  analysisId: Id<"analyses">;
  repo: string | null;
  commit: string | null;
  coverage: StoredCoverage | null;
}) {
  const files = usePaginatedQuery(api.graph.files, { analysisId: id }, { initialNumItems: READ_PAGE });
  const edges = usePaginatedQuery(api.graph.edges, { analysisId: id }, { initialNumItems: READ_PAGE });

  useEffect(() => {
    if (files.status === "CanLoadMore") files.loadMore(READ_PAGE);
  }, [files]);
  useEffect(() => {
    if (edges.status === "CanLoadMore") edges.loadMore(READ_PAGE);
  }, [edges]);

  const ready = files.status === "Exhausted" && edges.status === "Exhausted";
  const graph = useMemo<Graph | null>(() => {
    if (!ready) return null;
    // Rows hold one edge per kind; the explorer wants one per pair.
    const byPair = new Map<string, { from: string; to: string; kinds: Set<EdgeKind> }>();
    for (const e of edges.results) {
      const key = `${e.from}\0${e.to}`;
      const pair = byPair.get(key) ?? { from: e.from, to: e.to, kinds: new Set<EdgeKind>() };
      pair.kinds.add(e.kind);
      byPair.set(key, pair);
    }
    const order: EdgeKind[] = ["import", "reexport", "dynamic"];
    const pairs = [...byPair.values()].map((p) => ({
      from: p.from,
      to: p.to,
      kinds: order.filter((k) => p.kinds.has(k)),
    }));
    const fan = computeFan(
      files.results.map((f) => f.path),
      pairs,
    );
    return {
      root: repo?.split("/").pop() ?? "dépôt",
      adapter: fallbackAdapter.name,
      files: files.results.map((f) => ({
        path: f.path,
        folder: f.folder,
        lines: f.lines,
        hash: f.hash,
        fanIn: fan.get(f.path)?.fanIn ?? 0,
        fanOut: fan.get(f.path)?.fanOut ?? 0,
      })),
      edges: pairs,
    };
  }, [ready, files.results, edges.results, repo]);

  if (graph === null) {
    return (
      <p className="text-xs text-muted">
        Chargement de l&apos;analyse : {files.results.length} fichiers, {edges.results.length} liens…
      </p>
    );
  }
  if (graph.files.length === 0) {
    return (
      <p className="text-xs">
        Aucun fichier TypeScript ou JavaScript dans ce dépôt : il n&apos;y a rien à cartographier.
      </p>
    );
  }
  return (
    <Explorer
      data={graph}
      coverage={coverage ?? undefined}
      commit={commit ?? undefined}
      action={<Rerun id={analysisId} confirm />}
    />
  );
}
