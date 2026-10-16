"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { startAnalysis } from "@/app/actions/analyses";
import { takePending } from "@/components/landing/pending";
import { PrivatePicker } from "@/components/private-picker";

// The dashboard's form. An address already analysed leads to the existing
// analysis; it never creates a second one.
export function RepoForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // An address typed in the landing page's hero is waiting here after sign-in.
  // It is taken once (the ref also covers React's double effect in development),
  // shown in the field, and started: the field was the way in, not decoration.
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current) return;
    picked.current = true;
    const waiting = takePending();
    if (waiting === null) return;
    startTransition(async () => {
      setUrl(waiting);
      const result = await startAnalysis(waiting);
      if (result.ok) router.push(`/analyses/${result.id}`);
      else setError(result.error);
    });
  }, [router]);

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
    <div className="flex flex-col gap-3">
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
      <PrivatePicker />
    </div>
  );
}
