"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { startAnalysis } from "@/app/actions/analyses";

// The dashboard's form. An address already analysed leads to the existing
// analysis; it never creates a second one.
export function RepoForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await startAnalysis(url);
      if (result.ok) router.push(`/analyses/${result.id}`);
      else setError(result.error);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/propriétaire/dépôt"
          aria-label="Adresse du dépôt GitHub"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs"
        />
        <button
          type="submit"
          disabled={pending || url.trim() === ""}
          className="cursor-pointer rounded border border-border px-3 py-1 text-xs disabled:cursor-default disabled:opacity-50"
        >
          {pending ? "Envoi…" : "Analyser"}
        </button>
      </div>
      {error !== null && <p className="text-xs">{error}</p>}
    </form>
  );
}
