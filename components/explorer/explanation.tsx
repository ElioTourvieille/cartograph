"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  aiStatusAction,
  explainFileAction,
  explainFolderAction,
  freshnessAction,
  type Freshness,
} from "@/app/actions/ai";
import { rerunAnalysis } from "@/app/actions/analyses";
import type { Id } from "@/convex/_generated/dataModel";
import type { AiStatus } from "@/lib/ai/client";

// The Explanation tab. What a model wrote is shown through a small renderer
// that draws exactly the three things the prompt permits (inline code, bold,
// bullets) and turns every repository path into a link that moves the map.
// Forbidding formatting outright and printing whatever comes back leaves
// backticks showing as backticks; permitting a subset and rendering it is the
// option that survives contact with a model.

export type Subject =
  | { kind: "file"; path: string }
  | { kind: "folder"; id: string; paths: string[] };

export type Entry =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "done";
      text: string;
      cached: boolean;
      model: string;
      fresh: Freshness | null;
    };

type Link = {
  onSelectFile: (path: string) => void;
  onHover: (path: string | null) => void;
};

// A candidate path inside prose: segments joined by slashes.
const PATH = /[A-Za-z0-9_@.\-[\]()]+(?:\/[A-Za-z0-9_@.\-[\]()]+)+/g;

function PathLink({ path, link }: { path: string; link: Link }) {
  return (
    <button
      type="button"
      title={path}
      onClick={() => link.onSelectFile(path)}
      onMouseEnter={() => link.onHover(path)}
      onMouseLeave={() => link.onHover(null)}
      className="cursor-pointer break-all font-mono text-[11px] underline decoration-dotted underline-offset-2 hover:bg-foreground/10"
    >
      {path}
    </button>
  );
}

// Plain text: stray markup characters are dropped (they are never meant to be
// shown), and every token that is exactly a known path becomes a link.
function Plain({ text, known, link }: { text: string; known: ReadonlySet<string>; link: Link }) {
  const clean = text.replace(/[`*#]/g, "");
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of clean.matchAll(PATH)) {
    const raw = match[0];
    const path = raw.replace(/[.,;:]+$/, "");
    if (!known.has(path)) continue;
    const at = match.index ?? 0;
    out.push(clean.slice(last, at));
    out.push(<PathLink key={`${at}-${path}`} path={path} link={link} />);
    last = at + path.length;
  }
  out.push(clean.slice(last));
  return <>{out}</>;
}

function Inline({ text, known, link }: { text: string; known: ReadonlySet<string>; link: Link }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
          const code = part.slice(1, -1);
          return known.has(code) ? (
            <PathLink key={i} path={code} link={link} />
          ) : (
            <code key={i} className="rounded-sm bg-foreground/10 px-1 font-mono text-[11px]">
              {code}
            </code>
          );
        }
        if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i}>
              <Plain text={part.slice(2, -2)} known={known} link={link} />
            </strong>
          );
        }
        return <Plain key={i} text={part} known={known} link={link} />;
      })}
    </>
  );
}

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;

export function RenderedExplanation({
  text,
  known,
  link,
}: {
  text: string;
  known: ReadonlySet<string>;
  link: Link;
}) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push(
        <p key={blocks.length} className="leading-relaxed">
          <Inline text={paragraph.join(" ")} known={known} link={link} />
        </p>,
      );
      paragraph = [];
    }
    if (bullets.length > 0) {
      blocks.push(
        <ul key={blocks.length} className="ml-4 flex list-disc flex-col gap-1">
          {bullets.map((b, i) => (
            <li key={i} className="leading-relaxed">
              <Inline text={b} known={known} link={link} />
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };

  for (const rawLine of text.split("\n")) {
    // A heading is not permitted; if one comes back anyway it is shown as the
    // paragraph it should have been, without its hash marks.
    const line = rawLine.replace(/^\s*#{1,6}\s+/, "").trimEnd();
    if (line.trim() === "") {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      if (paragraph.length > 0) flush();
      bullets.push(bullet[1]);
    } else {
      if (bullets.length > 0) flush();
      paragraph.push(line.trim());
    }
  }
  flush();

  return <div className="flex flex-col gap-2 text-xs">{blocks}</div>;
}

export function ExplanationPanel({
  analysisId,
  subject,
  entry,
  onEntry,
  known,
  link,
}: {
  analysisId: Id<"analyses"> | undefined;
  subject: Subject;
  entry: Entry | undefined;
  onEntry: (entry: Entry) => void;
  known: ReadonlySet<string>;
  link: Link;
}) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void aiStatusAction().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);

  if (analysisId === undefined) {
    return <p className="text-xs text-muted">Aucune explication pour cet aperçu.</p>;
  }

  const explain = async () => {
    onEntry({ status: "loading" });
    const result =
      subject.kind === "file"
        ? await explainFileAction(analysisId, subject.path)
        : await explainFolderAction(analysisId, subject.id, subject.paths);
    if (!result.ok) {
      onEntry({ status: "error", error: result.error });
      return;
    }
    const done: Entry = {
      status: "done",
      text: result.text,
      cached: result.cached,
      model: result.model,
      fresh: null,
    };
    onEntry(done);
    // Checked after the answer is shown, so staleness never delays it.
    const fresh = await freshnessAction(
      analysisId,
      subject.kind === "file" ? subject.path : null,
    );
    onEntry({ ...done, fresh });
  };

  return (
    <div className="flex flex-col gap-3">
      {entry === undefined && (
        <button
          type="button"
          onClick={() => void explain()}
          className="w-fit cursor-pointer rounded border border-border px-3 py-1 text-xs"
        >
          {subject.kind === "file" ? "Expliquer ce fichier" : "Expliquer ce dossier"}
        </button>
      )}

      {entry?.status === "loading" && (
        <p className="text-xs text-muted">Lecture du fichier et de ses voisins…</p>
      )}

      {entry?.status === "error" && (
        <div className="flex flex-col gap-2 text-xs">
          <p>{entry.error}</p>
          <button
            type="button"
            onClick={() => void explain()}
            className="w-fit cursor-pointer rounded border border-border px-3 py-1"
          >
            Réessayer
          </button>
        </div>
      )}

      {entry?.status === "done" && (
        <>
          <RenderedExplanation text={entry.text} known={known} link={link} />
          <Staleness analysisId={analysisId} entry={entry} subject={subject} />
          <p className="text-[10px] text-muted">
            {entry.cached ? "Réponse déjà en mémoire · " : ""}
            {entry.model}
          </p>
        </>
      )}

      <p className="border-t border-border pt-2 text-[10px] text-muted">
        {status === null
          ? "…"
          : !status.model
            ? "Clé du modèle absente : aucune explication ne peut être produite."
            : status.tracing
              ? "Traçage actif : les appels sont enregistrés."
              : "Traçage non configuré : les appels réussissent mais ne sont pas enregistrés."}
      </p>
    </div>
  );
}

// Says so when what was explained is no longer what is in the repository, and
// offers to analyse it again.
function Staleness({
  analysisId,
  entry,
  subject,
}: {
  analysisId: Id<"analyses">;
  entry: Extract<Entry, { status: "done" }>;
  subject: Subject;
}) {
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const fresh = entry.fresh;
  if (fresh === null || !fresh.ok) return null;
  if (!fresh.repoMoved && fresh.fileChanged !== true) return null;

  const what =
    fresh.fileChanged === true
      ? "Ce fichier a changé depuis l'analyse : cette explication décrit l'ancienne version."
      : subject.kind === "folder"
        ? "Le dépôt a de nouveaux commits depuis l'analyse : ce dossier a pu changer."
        : "Le dépôt a de nouveaux commits depuis l'analyse, mais ce fichier n'a pas changé.";

  return (
    <div className="flex flex-col gap-1.5 rounded border border-foreground p-2 text-xs">
      <p>{what}</p>
      <button
        type="button"
        disabled={state === "running"}
        onClick={async () => {
          setState("running");
          const result = await rerunAnalysis(analysisId);
          setState(result.ok ? "idle" : "error");
        }}
        className="w-fit cursor-pointer rounded border border-border px-2 py-0.5 disabled:opacity-50"
      >
        {state === "running" ? "Relance…" : "Relancer l'analyse"}
      </button>
      {state === "error" && <p>La relance n&apos;a pas pu démarrer.</p>}
    </div>
  );
}
