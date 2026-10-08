// Pure functions over a file list and an edge list.

export type Link = { from: string; to: string };

/** Drops repeated (from, to) pairs, keeping first-seen order. */
export function dedupeLinks<T extends Link>(links: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const link of links) {
    const key = `${link.from}\0${link.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

/** Fan-in and fan-out per file, from the edges after duplicates are removed. */
export function computeFan(
  files: string[],
  edges: Link[],
): Map<string, { fanIn: number; fanOut: number }> {
  const fan = new Map(files.map((f) => [f, { fanIn: 0, fanOut: 0 }]));
  for (const { from, to } of dedupeLinks(edges)) {
    const source = fan.get(from);
    const target = fan.get(to);
    if (source) source.fanOut += 1;
    if (target) target.fanIn += 1;
  }
  return fan;
}
