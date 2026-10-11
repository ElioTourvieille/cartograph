import { fallbackAdapter, type Adapter } from "../adapter.ts";
import { nestjs } from "./nestjs.ts";
import { nextjs } from "./nextjs.ts";
import { react } from "./react.ts";

// The fixed order detection runs in. The first adapter whose test a package
// passes is the one used for it, so a package that depends on both Next.js and
// React is a Next.js one. Nothing matching leaves the fallback, which knows no
// framework at all.
export const ADAPTERS: readonly Adapter[] = [nextjs, nestjs, react];

export function adapterFor(dependencies: ReadonlySet<string>): Adapter {
  return ADAPTERS.find((adapter) => adapter.detect(dependencies)) ?? fallbackAdapter;
}

/** Every call name any adapter wants recorded, so the parser reads them in one pass. */
export const WATCHED_CALLS: ReadonlySet<string> = new Set(ADAPTERS.flatMap((a) => a.watch));
