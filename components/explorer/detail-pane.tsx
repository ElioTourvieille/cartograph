"use client";

import { useMemo, useState, type ReactNode } from "react";
import { classifyAction } from "@/app/actions/ai";
import type { Id } from "@/convex/_generated/dataModel";
import { AskPanel, useAsk } from "./ask";
import { ExplanationPanel, type Entry } from "./explanation";
import {
  fileDetail,
  indexEdges,
  LIST_LIMIT,
  nodeDetail,
  summarize,
  type Index,
  type Ranked,
} from "@/graph/detail";
import type { Categories, Category } from "@/graph/categories";
import type { Fold } from "@/graph/fold";
import { insights, SENTENCE, type Insights } from "@/graph/insights";
import { DEFAULT_DEPTH, reach, type Way } from "@/graph/reach";
import type { Selection } from "@/graph/select";
import type { Graph } from "@/graph/types";

// The right-hand column. It is always there, and it always says something:
// with nothing selected it is the repository summary, which is its resting
// state, not a placeholder. Everything shown is already in the browser, so
// selecting fires no request.

/** What the pointer is over, on the map or in this pane. */
export type Hover = { path: string | null; node: string | null };

type Tab = "structure" | "explication";

type Props = {
  data: Graph;
  categories: Categories;
  /** The analysis being shown, which an explanation is asked and cached under. */
  analysisId?: Id<"analyses">;
  /** Why the agent cannot be asked about this repository, when it cannot. */
  askUnavailable?: string;
  fold: Fold;
  selection: Selection | null;
  hover: Hover;
  onSelectFile: (path: string) => void;
  onHover: (path: string | null) => void;
};

export function DetailPane({
  data,
  categories,
  analysisId,
  askUnavailable,
  fold,
  selection,
  hover,
  onSelectFile,
  onHover,
}: Props) {
  // Kept here, not reset when the selection changes: someone comparing
  // explanations across files should not reopen the tab each time.
  const [tab, setTab] = useState<Tab>("structure");
  // Ask is a mode of the whole pane, not a tab: it is about the repository, so
  // it must not vanish when nothing is selected. Toggling out returns to
  // whatever was selected, and the conversation is kept above the pane.
  const [mode, setMode] = useState<"detail" | "ask">("detail");
  const ask = useAsk(analysisId);
  // What has been explained stays here for as long as the pane does: move the
  // selection away and back and the answer is still there, with no second click.
  const [explained, setExplained] = useState<Readonly<Record<string, Entry>>>({});
  const known = useMemo(() => new Set(data.files.map((f) => f.path)), [data.files]);
  const index = useMemo(() => indexEdges(data.edges), [data.edges]);
  const summary = useMemo(() => summarize(data), [data]);
  const found = useMemo(
    () => insights(data, categories.reached),
    [data, categories],
  );

  const hot = (path: string): boolean =>
    hover.path === path ||
    (hover.node !== null && fold.nodeOf.get(path) === hover.node);
  const link = { hot, onSelectFile, onHover };

  return (
    <aside
      aria-label="Détail"
      className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
    >
      {analysisId !== undefined && askUnavailable !== undefined && (
        <p className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted">
          {askUnavailable}
        </p>
      )}
      {analysisId !== undefined && askUnavailable === undefined && (
        <button
          type="button"
          aria-pressed={mode === "ask"}
          onClick={() => setMode(mode === "ask" ? "detail" : "ask")}
          className="shrink-0 cursor-pointer border-b border-border px-3 py-1.5 text-left text-xs hover:bg-foreground/5"
        >
          {mode === "ask" ? "← Retour au détail" : "Poser une question sur le dépôt"}
        </button>
      )}
      {mode === "ask" ? (
        <AskPanel
          {...ask}
          selectedPath={selection?.kind === "file" ? selection.path : null}
          known={known}
          link={{ onSelectFile, onHover }}
        />
      ) : selection === null ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <Summary summary={summary} found={found} analysisId={analysisId} {...link} />
        </div>
      ) : (
        <>
          <div role="tablist" className="flex shrink-0 border-b border-border text-xs">
            <TabButton id="structure" tab={tab} onPick={setTab}>
              Structure
            </TabButton>
            <TabButton id="explication" tab={tab} onPick={setTab}>
              Explication
            </TabButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "explication" ? (
              <ExplanationPanel
                key={selection.kind === "file" ? selection.path : `folder:${selection.id}`}
                analysisId={analysisId}
                subject={
                  selection.kind === "file"
                    ? { kind: "file", path: selection.path }
                    : {
                        kind: "folder",
                        id: selection.id,
                        paths: fold.nodes.find((n) => n.id === selection.id)?.files ?? [],
                      }
                }
                entry={explained[selection.kind === "file" ? `file:${selection.path}` : `folder:${selection.id}`]}
                onEntry={(entry) =>
                  setExplained((all) => ({
                    ...all,
                    [selection.kind === "file" ? `file:${selection.path}` : `folder:${selection.id}`]: entry,
                  }))
                }
                known={known}
                link={{ onSelectFile, onHover }}
              />
            ) : selection.kind === "file" ? (
              <FileView
                key={selection.path}
                detail={fileDetail(data, index, selection.path)}
                index={index}
                category={categories.get(categories.of(selection.path))}
                {...link}
              />
            ) : (
              <NodeView detail={nodeDetail(fold, selection.id, categories)} />
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function TabButton({
  id,
  tab,
  onPick,
  children,
}: {
  id: Tab;
  tab: Tab;
  onPick: (tab: Tab) => void;
  children: ReactNode;
}) {
  const active = tab === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onPick(id)}
      className={`flex-1 cursor-pointer border-b-2 px-3 py-1.5 ${active ? "border-accent font-semibold" : "border-transparent text-muted"}`}
    >
      {children}
    </button>
  );
}

type LinkProps = {
  hot: (path: string) => boolean;
  onSelectFile: (path: string) => void;
  onHover: (path: string | null) => void;
};

function Summary({
  summary,
  found,
  analysisId,
  ...link
}: {
  summary: ReturnType<typeof summarize>;
  found: Insights;
  analysisId: Id<"analyses"> | undefined;
} & LinkProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="break-all font-mono text-xs font-semibold">{summary.name}</h2>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <Fact
            label="Framework"
            value={summary.frameworks.length === 0 ? "aucun" : summary.frameworks.join(", ")}
          />
          <Fact label="Fichiers" value={String(summary.files)} />
          <Fact label="Imports" value={String(summary.imports)} />
          <Fact label="Routes" value={summary.routes === null ? "—" : String(summary.routes)} />
        </dl>
      </div>

      <Section title="Ce dont le reste dépend le plus" hint="importé par">
        <PathList items={summary.leaned} {...link} />
      </Section>

      <Section
        title={`Rien ne les importe (${summary.unimportedTotal})`}
        hint="importe"
      >
        <PathList items={summary.unimported} {...link} />
        {summary.unimportedTotal > summary.unimported.length && (
          <p className="mt-1 text-[10px] text-muted">
            et {summary.unimportedTotal - summary.unimported.length} de plus
          </p>
        )}
      </Section>

      <RoutesTable routes={summary.routeList} {...link} />

      <p className="text-xs text-muted">
        {summary.unidentified} fichiers qu&apos;aucune convention n&apos;a identifiés.
      </p>
      {summary.unidentified > 0 && analysisId !== undefined && (
        <ClassifyControl analysisId={analysisId} />
      )}

      <InsightsPanel found={found} {...link} />
    </div>
  );
}

// Collapsed until opened, and below everything else: this explains a codebase,
// it is not the first thing anyone sees and it never grades one. What leads is
// the explanatory kind (where to start reading); cycles and length read closer
// to a verdict, so they go underneath.
function InsightsPanel({ found, ...link }: { found: Insights } & LinkProps) {
  return (
    <details className="border-t border-border pt-2">
      <summary className="cursor-pointer text-[10px] font-semibold uppercase text-muted">
        Repères
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        <InsightSection
          title="Rien ne les importe"
          sentence={SENTENCE.unimported}
          items={found.unimported}
          {...link}
        />
        <InsightSection
          title="Très importés"
          sentence={SENTENCE.hub}
          items={found.hubs}
          {...link}
        />
        <Section title={`Boucles d'imports (${found.cycles.length})`}>
          <p className="mb-1 text-[10px] text-muted">{SENTENCE.cycle}</p>
          {found.cycles.length === 0 && <p className="text-xs text-muted">Aucune.</p>}
          {found.cycles.slice(0, LIST_LIMIT).map((cycle) => (
            <div key={cycle.files[0]} className="mb-2">
              <p className="text-[10px] text-muted">{cycle.size} fichiers concernés</p>
              <ul className="flex flex-col">
                {cycle.files.map((path, i) => (
                  <li key={path}>
                    <PathButton path={path} prefix={i === 0 ? "" : "→ "} {...link} />
                  </li>
                ))}
                <li className="px-1 text-[10px] text-muted">→ retour à {cycle.files[0]}</li>
              </ul>
            </div>
          ))}
        </Section>
        <InsightSection
          title="Très longs"
          sentence={SENTENCE.long}
          items={found.long}
          {...link}
        />
      </div>
    </details>
  );
}

function InsightSection({
  title,
  sentence,
  items,
  ...link
}: {
  title: string;
  sentence: string;
  items: { path: string; value: number }[];
} & LinkProps) {
  return (
    <Section title={`${title} (${items.length})`}>
      <p className="mb-1 text-[10px] text-muted">{sentence}</p>
      <PathList
        items={items.slice(0, LIST_LIMIT).map((i) => ({ path: i.path, count: i.value }))}
        {...link}
      />
      {items.length > LIST_LIMIT && (
        <p className="mt-1 text-[10px] text-muted">et {items.length - LIST_LIMIT} de plus</p>
      )}
    </Section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1 flex items-baseline justify-between text-[10px] font-semibold uppercase text-muted">
        <span>{title}</span>
        {hint !== undefined && <span className="font-normal normal-case">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

function PathList({ items, ...link }: { items: Ranked[] } & LinkProps) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.path}>
          <PathButton path={item.path} count={item.count} {...link} />
        </li>
      ))}
    </ul>
  );
}

function PathButton({
  path,
  count,
  prefix = "",
  hot,
  onSelectFile,
  onHover,
}: { path: string; count?: number; prefix?: string } & LinkProps) {
  return (
    <button
      type="button"
      title={path}
      onClick={() => onSelectFile(path)}
      onMouseEnter={() => onHover(path)}
      onMouseLeave={() => onHover(null)}
      className={`flex w-full cursor-pointer items-baseline gap-2 rounded-sm px-1 py-0.5 text-left ${hot(path) ? "bg-foreground/10" : "hover:bg-foreground/5"}`}
    >
      <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-tight">{prefix}{path}</span>
      {count !== undefined && <span className="shrink-0 text-[10px] text-muted">{count}</span>}
    </button>
  );
}

function FileView({
  detail,
  index,
  category,
  ...link
}: {
  detail: ReturnType<typeof fileDetail>;
  index: Index;
  category: Category | undefined;
} & LinkProps) {
  if (detail === null) return null;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="break-all font-mono text-xs font-semibold">{detail.path}</h2>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted">Type</dt>
          <dd className="flex items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: category?.swatch ?? "var(--muted)" }}
            />
            {category?.label ?? "—"}
          </dd>
          <Fact label="Longueur" value={`${detail.lines} lignes`} />
          <Fact label="Importe" value={String(detail.imports.length)} />
          <Fact label="Importé par" value={String(detail.dependents.length)} />
        </dl>
      </div>

      <ReachSection path={detail.path} index={index} {...link} />

      <Section title={`Importe (${detail.imports.length})`}>
        <Neighbours paths={detail.imports} {...link} />
      </Section>
      <Section title={`Importé par (${detail.dependents.length})`}>
        <Neighbours paths={detail.dependents} {...link} />
      </Section>
    </div>
  );
}

function Neighbours({ paths, ...link }: { paths: string[] } & LinkProps) {
  if (paths.length === 0) return <p className="text-xs text-muted">Aucun.</p>;
  return (
    <ul className="flex flex-col">
      {paths.map((path) => (
        <li key={path}>
          <PathButton path={path} {...link} />
        </li>
      ))}
    </ul>
  );
}

function NodeView({ detail }: { detail: ReturnType<typeof nodeDetail> }) {
  if (detail === null) return null;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="break-all font-mono text-xs font-semibold">
          {detail.id === "." ? "(racine)" : detail.id}
        </h2>
        <p className="mt-1 text-xs text-muted">{detail.files} fichiers</p>
      </div>
      <Section title="Types de fichiers">
        <ul className="flex flex-col gap-0.5 text-xs">
          {detail.categories.map((k) => (
            <li key={k.id} className="flex items-center gap-2">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: k.swatch }}
              />
              <span className="min-w-0 flex-1 truncate">{k.label}</span>
              <span className="font-mono text-muted">{k.count}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// Blast radius and dependency chain: one walk, two directions. The answer is
// computed from the edge list already in the browser, so it appears at once.
function ReachSection({
  path,
  index,
  ...link
}: { path: string; index: Index } & LinkProps) {
  const [way, setWay] = useState<Way | null>(null);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const reached = useMemo(
    () => (way === null ? [] : reach(index, path, way, depth)),
    [index, path, way, depth],
  );

  const toggle = (next: Way) => setWay((current) => (current === next ? null : next));
  return (
    <section className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <ReachButton active={way === "dependents"} onClick={() => toggle("dependents")}>
          Rayon d&apos;impact
        </ReachButton>
        <ReachButton active={way === "dependencies"} onClick={() => toggle("dependencies")}>
          Chaîne de dépendances
        </ReachButton>
      </div>

      {way !== null && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
            <span>
              {reached.length} fichiers, jusqu&apos;à {depth} niveaux
            </span>
            <span className="flex items-center gap-1">
              <StepButton
                label="Un niveau de moins"
                disabled={depth <= 1}
                onClick={() => setDepth(depth - 1)}
              >
                −
              </StepButton>
              <StepButton
                label="Un niveau de plus"
                disabled={depth >= MAX_DEPTH}
                onClick={() => setDepth(depth + 1)}
              >
                +
              </StepButton>
            </span>
          </div>
          {Array.from({ length: depth }, (_, i) => i + 1).map((level) => {
            const at = reached.filter((r) => r.distance === level);
            if (at.length === 0) return null;
            return (
              <div key={level} className="mb-1.5">
                <p className="text-[10px] font-semibold uppercase text-muted">
                  Niveau {level} ({at.length})
                </p>
                <ul className="flex flex-col">
                  {at.map((r) => (
                    <li key={r.path}>
                      <PathButton path={r.path} {...link} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {reached.length === 0 && <p className="text-xs text-muted">Aucun.</p>}
        </div>
      )}
    </section>
  );
}

/** The most levels the pane offers; deeper is most of the repository. */
const MAX_DEPTH = 5;

function ReachButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex-1 cursor-pointer rounded border px-2 py-1 text-[11px] ${active ? "border-accent font-semibold" : "border-border"}`}
    >
      {children}
    </button>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="size-4 cursor-pointer rounded border border-border leading-none disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// The routes the adapters recovered, each with the file that declares it. Only
// routes whose method and full pattern are written in the code are here: a
// repository can have more routes than this table shows, never fewer lines
// than it is sure of.
function RoutesTable({ routes, ...link }: { routes: Graph["routes"] } & LinkProps) {
  if (routes.length === 0) return null;
  return (
    <Section title={`Routes (${routes.length})`}>
      <ul className="flex max-h-72 flex-col overflow-y-auto">
        {routes.map((route) => (
          <li key={`${route.method} ${route.pattern} ${route.file}`}>
            <button
              type="button"
              title={route.file}
              onClick={() => link.onSelectFile(route.file)}
              onMouseEnter={() => link.onHover(route.file)}
              onMouseLeave={() => link.onHover(null)}
              className={`flex w-full cursor-pointer flex-col rounded-sm px-1 py-0.5 text-left ${link.hot(route.file) ? "bg-foreground/10" : "hover:bg-foreground/5"}`}
            >
              <span className="flex gap-2 font-mono text-[11px] leading-tight">
                <span className="w-12 shrink-0 font-semibold">{route.method}</span>
                <span className="min-w-0 flex-1 break-all">{route.pattern}</span>
              </span>
              <span className="break-all pl-14 font-mono text-[10px] leading-tight text-muted">
                {route.file}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// Asks a small model for a role for the files no convention named. A button and
// not an automatic step: it costs, and the person should see that it does. Each
// click looks at the next group of files; a role the model could not decide on
// is simply left without one.
function ClassifyControl({ analysisId }: { analysisId: Id<"analyses"> }) {
  const [state, setState] = useState<
    | { status: "idle"; next: number; note: string | null }
    | { status: "running"; next: number }
    | { status: "error"; next: number; error: string }
  >({ status: "idle", next: 0, note: null });

  const run = async () => {
    const from = state.next;
    setState({ status: "running", next: from });
    const result = await classifyAction(analysisId, from);
    if (!result.ok) {
      setState({ status: "error", next: from, error: result.error });
      return;
    }
    setState({
      status: "idle",
      next: result.next,
      note:
        `${result.saved} fichiers classés sur ${result.scanned} examinés` +
        (result.remaining > 0 ? `, ${result.remaining} restent à examiner.` : "."),
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={state.status === "running"}
        onClick={() => void run()}
        className="w-fit cursor-pointer rounded border border-border px-2 py-1 text-[11px] disabled:opacity-50"
      >
        {state.status === "running" ? "Classement en cours…" : "Déduire les rôles avec un modèle"}
      </button>
      {state.status === "idle" && state.note !== null && (
        <p className="text-[10px] text-muted">{state.note}</p>
      )}
      {state.status === "error" && <p className="text-[10px]">{state.error}</p>}
    </div>
  );
}
