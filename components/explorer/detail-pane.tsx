"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  fileDetail,
  indexEdges,
  nodeDetail,
  summarize,
  type Ranked,
} from "@/graph/detail";
import type { Fold } from "@/graph/fold";
import { KINDS } from "@/graph/kinds";
import type { Selection } from "@/graph/select";
import type { ParseResult } from "@/parser/types";

// The right-hand column. It is always there, and it always says something:
// with nothing selected it is the repository summary, which is its resting
// state, not a placeholder. Everything shown is already in the browser, so
// selecting fires no request.

/** What the pointer is over, on the map or in this pane. */
export type Hover = { path: string | null; node: string | null };

type Tab = "structure" | "explication";

type Props = {
  data: ParseResult;
  fold: Fold;
  selection: Selection | null;
  hover: Hover;
  onSelectFile: (path: string) => void;
  onHover: (path: string | null) => void;
};

export function DetailPane({ data, fold, selection, hover, onSelectFile, onHover }: Props) {
  // Kept here, not reset when the selection changes: someone comparing
  // explanations across files should not reopen the tab each time.
  const [tab, setTab] = useState<Tab>("structure");
  const index = useMemo(() => indexEdges(data.edges), [data.edges]);
  const summary = useMemo(() => summarize(data), [data]);

  const hot = (path: string): boolean =>
    hover.path === path ||
    (hover.node !== null && fold.nodeOf.get(path) === hover.node);
  const link = { hot, onSelectFile, onHover };

  return (
    <aside
      aria-label="Détail"
      className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
    >
      {selection === null ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <Summary summary={summary} {...link} />
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
              <p className="text-xs text-muted">Aucune explication pour l&apos;instant.</p>
            ) : selection.kind === "file" ? (
              <FileView detail={fileDetail(data, index, selection.path)} {...link} />
            ) : (
              <NodeView detail={nodeDetail(fold, selection.id)} />
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

function Summary({ summary, ...link }: { summary: ReturnType<typeof summarize> } & LinkProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="break-all font-mono text-xs font-semibold">{summary.name}</h2>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <Fact label="Framework" value={summary.framework} />
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

      <p className="text-xs text-muted">
        {summary.unidentified} fichiers qu&apos;aucune convention n&apos;a identifiés.
      </p>
    </div>
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
  hot,
  onSelectFile,
  onHover,
}: { path: string; count?: number } & LinkProps) {
  return (
    <button
      type="button"
      title={path}
      onClick={() => onSelectFile(path)}
      onMouseEnter={() => onHover(path)}
      onMouseLeave={() => onHover(null)}
      className={`flex w-full cursor-pointer items-baseline gap-2 rounded-sm px-1 py-0.5 text-left ${hot(path) ? "bg-foreground/10" : "hover:bg-foreground/5"}`}
    >
      <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-tight">{path}</span>
      {count !== undefined && <span className="shrink-0 text-[10px] text-muted">{count}</span>}
    </button>
  );
}

function FileView({
  detail,
  ...link
}: { detail: ReturnType<typeof fileDetail> } & LinkProps) {
  if (detail === null) return null;
  const kind = KINDS.find((k) => k.id === detail.kind)?.label ?? detail.kind;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="break-all font-mono text-xs font-semibold">{detail.path}</h2>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted">Type</dt>
          <dd className="flex items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: `var(--kind-${detail.kind})` }}
            />
            {kind}
          </dd>
          <Fact label="Longueur" value={`${detail.lines} lignes`} />
          <Fact label="Importe" value={String(detail.imports.length)} />
          <Fact label="Importé par" value={String(detail.dependents.length)} />
        </dl>
      </div>

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
          {detail.kinds.map((k) => (
            <li key={k.id} className="flex items-center gap-2">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: `var(--kind-${k.id})` }}
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
