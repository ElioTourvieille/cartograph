"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { AgentEvent } from "@/lib/agent/events";
import { RenderedExplanation } from "./explanation";

// Asking the repository a question. What the person sees is the agent working:
// each lookup appears as it starts and says what it came back with, and the
// answer is written under them. An answer with no lookup above it is shown as
// such, not hidden: it is the exact failure this product exists to prevent.

type Step = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** null while the lookup is running. */
  result: { found: boolean; total: number | null; more: number | null } | null;
};

export type Turn = {
  question: string;
  steps: Step[];
  answer: string;
  status: "running" | "done" | "error";
  error: string | null;
};

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

// The agent's lookups, in the person's words. The names of the tools are ours
// and stay out of the screen.
function describe(step: Step): string {
  const path = asText(step.args.path);
  switch (step.name) {
    case "summary":
      return "Vue d'ensemble de l'analyse";
    case "search_files":
      return `Recherche de fichiers : « ${asText(step.args.query)} »`;
    case "files_by_role":
      return `Fichiers du rôle « ${asText(step.args.role)} »`;
    case "neighbours":
      return `Voisins directs de ${path}`;
    case "walk":
      return step.args.direction === "dependencies"
        ? `Tout ce dont ${path} a besoin`
        : `Tout ce qui dépend de ${path}`;
    case "routes":
      return "Table des routes";
    default:
      // A built-in of the agent's runtime: shown as it is, never hidden.
      return step.name;
  }
}

function outcome(step: Step): string {
  if (step.result === null) return "en cours";
  if (!step.result.found) return "rien trouvé";
  if (step.result.total === null) return "obtenu";
  const more = step.result.more ?? 0;
  return more > 0
    ? `${step.result.total} trouvés, ${more} non listés`
    : `${step.result.total} trouvés`;
}

/**
 * The conversation, held above the pane so toggling out of Ask does not lose
 * it, and a stream in flight keeps writing into it.
 */
export function useAsk(analysisId: Id<"analyses"> | undefined) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const thread = useRef<string | null>(null);

  const patchLast = useCallback((fn: (turn: Turn) => Turn) => {
    setTurns((all) => (all.length === 0 ? all : [...all.slice(0, -1), fn(all[all.length - 1])]));
  }, []);

  const apply = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "thread":
          thread.current = event.threadId;
          break;
        case "tool":
          // Text written before a lookup was the agent thinking aloud, not the
          // answer: the answer is what follows the last lookup.
          patchLast((t) => ({
            ...t,
            answer: "",
            steps: [
              ...t.steps,
              { id: event.id, name: event.name, args: event.args, result: null },
            ],
          }));
          break;
        case "result":
          patchLast((t) => ({
            ...t,
            steps: t.steps.map((s) =>
              s.id === event.id
                ? { ...s, result: { found: event.found, total: event.total, more: event.more } }
                : s,
            ),
          }));
          break;
        case "text":
          patchLast((t) => ({ ...t, answer: t.answer + event.delta }));
          break;
        case "done":
          patchLast((t) => ({ ...t, status: t.status === "error" ? "error" : "done" }));
          break;
        case "error":
          patchLast((t) => ({ ...t, status: "error", error: event.message }));
          break;
      }
    },
    [patchLast],
  );

  const ask = useCallback(
    async (question: string, selected: string | null) => {
      if (analysisId === undefined || busy) return;
      setBusy(true);
      setTurns((all) => [
        ...all,
        { question, steps: [], answer: "", status: "running", error: null },
      ]);
      try {
        const response = await fetch("/api/agent/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ analysisId, question, threadId: thread.current, selected }),
        });
        if (!response.ok || response.body === null) {
          let message = "L'agent n'a pas pu répondre.";
          try {
            const body: unknown = await response.json();
            if (typeof body === "object" && body !== null && "error" in body) {
              message = String(body.error);
            }
          } catch {
            // keep the generic message
          }
          if (response.status === 503) {
            message = "L'agent n'est pas joignable. Le reste de l'application fonctionne.";
          }
          apply({ type: "error", message });
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line !== "") apply(JSON.parse(line) as AgentEvent);
            newline = buffer.indexOf("\n");
          }
        }
      } catch {
        apply({ type: "error", message: "La connexion à l'agent a été interrompue." });
      } finally {
        setBusy(false);
        // A stream that ended without saying so is finished, not still running.
        patchLast((t) => (t.status === "running" ? { ...t, status: "done" } : t));
      }
    },
    [analysisId, busy, apply, patchLast],
  );

  const reset = useCallback(() => {
    thread.current = null;
    setTurns([]);
  }, []);

  return { turns, busy, ask, reset };
}

type LinkProps = {
  known: ReadonlySet<string>;
  link: { onSelectFile: (path: string) => void; onHover: (path: string | null) => void };
};

export function AskPanel({
  turns,
  busy,
  ask,
  reset,
  selectedPath,
  known,
  link,
}: ReturnType<typeof useAsk> & LinkProps & { selectedPath: string | null }) {
  const [draft, setDraft] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (question === "" || busy) return;
    setDraft("");
    void ask(question, selectedPath);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {turns.length === 0 ? (
          <p className="text-xs text-muted">
            Posez une question sur ce dépôt : où se trouve une chose, ce qui dépend d&apos;un
            fichier, les routes. Chaque réponse est précédée des consultations qui la fondent.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {turns.map((turn, i) => (
              <section key={i} className="flex flex-col gap-1.5 text-xs">
                <p className="font-semibold">{turn.question}</p>
                {turn.steps.length > 0 && (
                  <ol className="flex flex-col gap-0.5 text-[11px] text-muted">
                    {turn.steps.map((step) => (
                      <li key={step.id} className="flex justify-between gap-2">
                        <span className="min-w-0 break-all">{describe(step)}</span>
                        <span className="shrink-0">{outcome(step)}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {turn.status !== "running" && turn.steps.length === 0 && turn.error === null && (
                  <p className="text-[11px] text-muted">
                    Aucune consultation du dépôt derrière cette réponse : ne la tenez pas pour
                    établie.
                  </p>
                )}
                {turn.answer !== "" && (
                  <RenderedExplanation text={turn.answer} known={known} link={link} />
                )}
                {turn.status === "running" && turn.answer === "" && (
                  <p className="text-[11px] text-muted">En attente de l&apos;agent…</p>
                )}
                {turn.error !== null && <p>{turn.error}</p>}
              </section>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={submit} className="shrink-0 border-t border-border p-2">
        {selectedPath !== null && (
          <p className="mb-1 truncate font-mono text-[10px] text-muted" title={selectedPath}>
            Sélection : {selectedPath}
          </p>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder="Où est gérée l'authentification ?"
          className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs"
        />
        <div className="mt-1 flex justify-between gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={busy || turns.length === 0}
            className="cursor-pointer rounded border border-border px-2 py-0.5 text-[10px] disabled:cursor-default disabled:opacity-50"
          >
            Nouvelle conversation
          </button>
          <button
            type="submit"
            disabled={busy || draft.trim() === ""}
            className="cursor-pointer rounded border border-border px-2 py-0.5 text-[10px] disabled:cursor-default disabled:opacity-50"
          >
            {busy ? "Réponse en cours…" : "Envoyer"}
          </button>
        </div>
      </form>
    </div>
  );
}
