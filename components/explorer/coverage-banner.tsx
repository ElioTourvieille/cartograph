"use client";

import { useState, type ReactNode } from "react";
import {
  importFigure,
  isPartial,
  PARTIAL_BELOW,
  percent,
  type StoredCoverage,
} from "@/graph/coverage";

// Says how much of the repository the map covers. It may collapse, but only to
// one line that still names the figure: a graph that is quietly missing a
// third of its links must never be able to look complete. It opens by itself
// when the figure is under PARTIAL_BELOW.

const UNRESOLVED: Record<string, string> = {
  "fichier-introuvable": "Fichier introuvable",
  "alias-sans-correspondance": "Alias sans correspondance",
  "introuvable-sous-baseurl": "Introuvable sous baseUrl",
  "specifier-non-litteral": "Import dynamique non littéral",
  "paquet-non-declare": "Paquet ou alias non déclaré",
  "paquet-interne-non-resolu": "Paquet interne non résolu",
};

const EXCLUDED: Record<string, string> = {
  ressource: "Ressource non analysée (style, image…)",
  "dossier-exclu": "Dossier exclu (dépendances, sortie de build)",
  "fichier-ignore": "Fichier ignoré",
};

const SKIPPED: Record<string, string> = {
  "trop-volumineux": "Trop volumineux",
  "lien-symbolique": "Lien symbolique",
  illisible: "Illisible",
  "analyse-impossible": "Analyse impossible",
  "non-extrait": "Non extrait de l'archive",
};

export function CoverageBanner({
  coverage,
  commit,
  action,
}: {
  coverage: StoredCoverage;
  commit?: string;
  action?: ReactNode;
}) {
  const figure = importFigure(coverage);
  const partial = isPartial(coverage);
  const [open, setOpen] = useState(figure !== null && figure < PARTIAL_BELOW);

  return (
    <section
      aria-label="Couverture"
      className={`shrink-0 border-b bg-surface text-xs ${partial ? "border-foreground" : "border-border"}`}
    >
      <div className="flex items-center gap-2 px-3 py-1">
        <span className={partial ? "font-semibold" : "text-muted"}>
          {partial ? "Graphe partiel · " : ""}
          {figure === null
            ? "Aucun import interne à résoudre"
            : `${percent(figure)} des imports internes résolus`}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted">
          {coverage.imports.unresolved} non résolus · {coverage.filesSkipped} fichiers ignorés ·{" "}
          {coverage.filesParsed} analysés sur {coverage.filesFound}
          {commit !== undefined && ` · commit ${commit.slice(0, 7)}`}
        </span>
        {action}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="shrink-0 cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px]"
        >
          {open ? "Réduire" : "Détails"}
        </button>
      </div>

      {open && (
        <div className="grid max-h-56 gap-3 overflow-y-auto border-t border-border px-3 py-2 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-muted">
              Imports vus : {coverage.imports.seen} = {coverage.imports.resolved} résolus +{" "}
              {coverage.imports.external} paquets externes + {coverage.imports.excluded} exclus +{" "}
              {coverage.imports.unresolved} non résolus.
            </p>
            {coverage.tsconfigError !== null && (
              <p className="text-[10px]">
                Configuration TypeScript non chargée : {coverage.tsconfigError}
              </p>
            )}
            <Groups title="Non résolus" labels={UNRESOLVED} groups={coverage.unresolved} />
          </div>
          <div className="flex flex-col gap-2">
            <Groups title="Exclus volontairement" labels={EXCLUDED} groups={coverage.excluded} />
            {coverage.skipped.length > 0 && (
              <div>
                <h3 className="mb-0.5 text-[10px] font-semibold uppercase text-muted">
                  Fichiers ignorés ({coverage.filesSkipped})
                </h3>
                <ul className="flex flex-col">
                  {coverage.skipped.map((s) => (
                    <li key={s.path} className="font-mono text-[11px] leading-tight">
                      {s.path} <span className="font-sans text-muted">— {SKIPPED[s.reason] ?? s.reason}</span>
                    </li>
                  ))}
                </ul>
                {coverage.filesSkipped > coverage.skipped.length && (
                  <p className="mt-0.5 text-[10px] text-muted">
                    et {coverage.filesSkipped - coverage.skipped.length} de plus
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Groups({
  title,
  labels,
  groups,
}: {
  title: string;
  labels: Record<string, string>;
  groups: StoredCoverage["unresolved"];
}) {
  if (groups.length === 0) return null;
  return (
    <div>
      <h3 className="mb-0.5 text-[10px] font-semibold uppercase text-muted">{title}</h3>
      {groups.map((g) => (
        <div key={g.reason} className="mb-1.5">
          <p>
            {labels[g.reason] ?? g.reason} <span className="font-mono text-muted">{g.count}</span>
          </p>
          <ul className="flex flex-col">
            {g.examples.map((o) => (
              <li
                key={`${o.from}:${o.line}:${o.specifier}`}
                className="font-mono text-[11px] leading-tight text-muted"
              >
                {o.from}:{o.line} {o.specifier ?? "(non littéral)"}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
