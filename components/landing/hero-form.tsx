"use client";

import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parseRepoUrl } from "@/convex/lib/repoUrl";
import { keepPending } from "./pending";

// The hero's field. It is the real entry to the product, not a button that
// scrolls to one: the address is checked here with the same parser the server
// uses, kept for the trip through sign-in, and picked up by the dashboard,
// which starts the analysis.
export function HeroForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const repo = parseRepoUrl(url);
      setError(null);
      keepPending(repo.url);
      router.push("/sign-in");
    } catch (e) {
      setError(e instanceof ConvexError ? String(e.data) : "Adresse non reconnue.");
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full max-w-[34rem] flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/propriétaire/dépôt"
          aria-label="Adresse du dépôt GitHub"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={url.trim() === ""}
          className="cursor-pointer rounded border border-accent bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-50"
        >
          Analyser
        </button>
      </div>
      {error === null ? (
        <p className="text-xs text-muted">
          Dépôts GitHub publics. Une connexion est demandée ensuite.
        </p>
      ) : (
        <p className="text-xs">{error}</p>
      )}
    </form>
  );
}
