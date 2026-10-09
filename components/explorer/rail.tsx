import { KINDS, kindOf, type KindId } from "@/graph/kinds";

// The left rail: categories of file, each with its swatch, its name and how
// many files it holds. Picking one dims everything not in it on the map; it
// never removes anything, so the shape of the whole stays. Picking it again
// clears it. Categories with no file are not listed.
export function Rail({
  paths,
  active,
  onPick,
}: {
  paths: readonly string[];
  active: KindId | null;
  onPick: (kind: KindId | null) => void;
}) {
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
      <ul className="flex flex-col gap-0.5">
        {KINDS.filter((k) => counts.has(k.id)).map((k) => (
          <li key={k.id}>
            <button
              type="button"
              aria-pressed={active === k.id}
              onClick={() => onPick(active === k.id ? null : k.id)}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-left text-xs ${active === k.id ? "bg-foreground/10 font-semibold" : "hover:bg-foreground/5"}`}
            >
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ background: `var(--kind-${k.id})` }}
              />
              <span className="min-w-0 flex-1 truncate">{k.label}</span>
              <span className="font-mono text-muted">{counts.get(k.id)}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
