"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const DATE = new Intl.DateTimeFormat("fr-CH", { dateStyle: "short" });

// What the organization has connected on GitHub. A connection is one
// installation of the App, on the repositories its owner picked on GitHub; it
// holds no key and no token. Disconnecting stops new runs through it; analyses
// already made stay readable.
export function Installations() {
  // Asked only once Convex has the person's token, as every other list is:
  // before that the function would answer "not signed in".
  const { isAuthenticated } = useConvexAuth();
  const rows = useQuery(api.installations.list, isAuthenticated ? {} : "skip");
  const disconnect = useMutation(api.installations.disconnect);
  const [armed, setArmed] = useState<Id<"installations"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold">Installations GitHub</h2>
        {/* A plain link: the flow starts on the server, which signs the state. */}
        <a
          href="/api/github/install"
          className="rounded border border-border px-3 py-1 text-xs hover:border-accent hover:text-accent"
        >
          Connecter GitHub
        </a>
      </div>

      {rows === undefined ? (
        <p className="text-xs text-muted">…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted">
          Aucune installation. Connectez l&apos;App GitHub pour analyser des dépôts privés : vous
          choisissez sur GitHub les dépôts qu&apos;elle peut lire, en lecture seule.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border text-xs">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="font-mono">{row.account}</span>
                <span className="text-muted">
                  {" "}
                  · connectée le {DATE.format(row.connectedAt)}
                  {row.removed && " · retirée"}
                </span>
              </span>
              {!row.removed && (
                <button
                  type="button"
                  onClick={async () => {
                    if (armed !== row.id) {
                      setArmed(row.id);
                      return;
                    }
                    setArmed(null);
                    setError(null);
                    try {
                      await disconnect({ id: row.id });
                    } catch {
                      setError("La déconnexion a échoué. Réessayez.");
                    }
                  }}
                  onBlur={() => setArmed(null)}
                  className="shrink-0 cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px]"
                >
                  {armed === row.id ? "Confirmer" : "Déconnecter"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error !== null && <p className="text-xs">{error}</p>}
      <p className="text-xs text-muted">
        Déconnecter n&apos;efface pas les analyses : elles ne contiennent que des chemins et des
        liens. Pour retirer l&apos;accès à GitHub même, désinstallez l&apos;App dans ses réglages
        GitHub.
      </p>
    </div>
  );
}
