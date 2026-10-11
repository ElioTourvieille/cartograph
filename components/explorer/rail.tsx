import type { Categories } from "@/graph/categories";

// The left rail: categories of file, each with its swatch, its name and how
// many files it holds, in the taxonomy's fixed order. Picking one dims
// everything not in it on the map; it never removes anything, so the shape of
// the whole stays. Picking it again clears it. Categories with no file are not
// listed.
export function Rail({
  categories,
  active,
  onPick,
}: {
  categories: Categories;
  active: string | null;
  onPick: (category: string | null) => void;
}) {
  return (
    <aside
      aria-label="Catégories"
      className="w-48 shrink-0 overflow-y-auto border-r border-border bg-surface p-2"
    >
      <h2 className="mb-1.5 text-[10px] font-semibold uppercase text-muted">Catégories</h2>
      <ul className="flex flex-col gap-0.5">
        {categories.list
          .filter((c) => categories.counts.has(c.id))
          .map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={active === c.id}
                onClick={() => onPick(active === c.id ? null : c.id)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-left text-xs ${active === c.id ? "bg-foreground/10 font-semibold" : "hover:bg-foreground/5"}`}
              >
                <span
                  className="size-2 shrink-0 rounded-sm"
                  style={{ background: c.swatch }}
                />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <span className="font-mono text-muted">{categories.counts.get(c.id)}</span>
              </button>
            </li>
          ))}
      </ul>
    </aside>
  );
}
