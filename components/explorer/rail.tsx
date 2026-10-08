import { KINDS, kindOf } from "@/graph/kinds";

// The left rail: categories of file, each with its swatch, its name and how
// many files it holds. Nothing happens on click yet; that arrives with the
// graph maths. Categories with no file are not listed.
export function Rail({ paths }: { paths: readonly string[] }) {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const kind = kindOf(path);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return (
    <aside
      aria-label="Catégories"
      className="w-48 shrink-0 overflow-y-auto border-r border-border bg-surface p-2"
    >
      <h2 className="mb-1.5 text-[10px] font-semibold uppercase text-muted">Catégories</h2>
      <ul className="flex flex-col gap-1">
        {KINDS.filter((k) => counts.has(k.id)).map((k) => (
          <li key={k.id} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-sm"
              style={{ background: `var(--kind-${k.id})` }}
            />
            <span className="min-w-0 flex-1 truncate">{k.label}</span>
            <span className="font-mono text-muted">{counts.get(k.id)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
