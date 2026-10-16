"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  listPrivateRepos,
  startPrivateAnalysis,
  type RepoGroup,
} from "@/app/actions/github";

// The dashboard's second way in: a repository chosen from the ones this
// organization's GitHub installations can see. The list is fetched when it is
// asked for and kept only in this component: it is never stored anywhere.
export function PrivatePicker() {
  const router = useRouter();
  const [groups, setGroups] = useState<RepoGroup[] | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () =>
    startTransition(async () => {
      setError(null);
      const result = await listPrivateRepos();
      if (result.ok) setGroups(result.groups);
      else setError(result.error);
    });

  const start = () => {
    const [installationId, ...rest] = choice.split("|");
    const repo = rest.join("|");
    if (installationId === "" || repo === "") return;
    startTransition(async () => {
      setError(null);
      const result = await startPrivateAnalysis(
        installationId as RepoGroup["installationId"],
        repo,
      );
      if (result.ok) router.push(`/analyses/${result.id}`);
      else setError(result.error);
    });
  };

  if (groups === null) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className="w-fit cursor-pointer rounded border border-border px-3 py-1 text-xs disabled:cursor-default disabled:opacity-50"
        >
          {pending ? "Chargement…" : "Choisir un dépôt privé"}
        </button>
        {error !== null && <p className="text-xs">{error}</p>}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="text-xs text-muted">
        Aucune installation GitHub n&apos;est connectée à cette organisation.{" "}
        <Link href="/parametres" className="underline">
          Connecter GitHub
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="Dépôt privé"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs"
        >
          <option value="">Choisir un dépôt…</option>
          {groups.map((g) => (
            <optgroup key={g.installationId} label={g.account}>
              {g.repos.map((repo) => (
                <option key={repo} value={`${g.installationId}|${repo}`}>
                  {repo}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          onClick={start}
          disabled={pending || choice === ""}
          className="cursor-pointer rounded border border-border px-3 py-1 text-xs disabled:cursor-default disabled:opacity-50"
        >
          {pending ? "Envoi…" : "Analyser"}
        </button>
      </div>
      {groups.map((g) =>
        g.error !== null ? (
          <p key={g.installationId} className="text-xs">
            {g.account} : {g.error}
          </p>
        ) : g.total > g.repos.length ? (
          <p key={g.installationId} className="text-xs text-muted">
            {g.account} : {g.repos.length} dépôts listés sur {g.total}.
          </p>
        ) : null,
      )}
      {error !== null && <p className="text-xs">{error}</p>}
    </div>
  );
}
