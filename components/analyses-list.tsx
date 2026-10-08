"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// What each state is called on screen. Colour is kept for what carries meaning
// elsewhere (direction, kind), so state is text only.
const STATUS_LABEL = {
  queued: "en attente",
  parsing: "analyse en cours",
  complete: "terminée",
  failed: "échouée",
} as const;

const DATE = new Intl.DateTimeFormat("fr-CH", {
  dateStyle: "short",
  timeStyle: "short",
});

// Live: re-runs by itself when the organization switches. Nothing here filters
// by organization; the query only ever returns the current one's rows.
export function AnalysesList() {
  // Convex gets its token from Clerk asynchronously. Until it has one, the
  // query would run anonymously and throw "Non connecté." — so wait.
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.analyses.list, isAuthenticated ? {} : "skip");

  if (data === undefined) return <p className="text-xs text-muted">…</p>;

  if (data.rows.length === 0) {
    return (
      <p className="text-xs text-muted">
        Aucune analyse pour cette organisation.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <table className="w-full text-left text-xs">
        <thead className="text-muted">
          <tr className="border-b border-border">
            <th className="py-1 pr-3 font-normal">Dépôt</th>
            <th className="py-1 pr-3 font-normal">État</th>
            <th className="py-1 font-normal">Créée</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id} className="border-b border-border align-top">
              <td className="py-1 pr-3 font-mono">{row.repo ?? "—"}</td>
              <td className="py-1 pr-3">
                {STATUS_LABEL[row.status]}
                {row.error !== null && (
                  <span className="text-muted"> : {row.error}</span>
                )}
              </td>
              <td className="py-1 text-muted">{DATE.format(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.truncated && (
        <p className="text-xs text-muted">
          Les 100 analyses les plus récentes seulement.
        </p>
      )}
    </div>
  );
}
