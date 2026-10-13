// The invented-path check. Take every path-shaped token in an explanation and
// test it against the exact set of paths the model was shown: anything else
// was invented.
//
// This is deterministic code and nothing else, on purpose. It is set
// membership, which has an exact answer, and a hallucination detector that
// hallucinates is worth nothing. It imports nothing, so it runs the same in the
// app (as a live evaluator on real traffic) and in the scripts outside it.

export type PathCheck = {
  /** Every distinct path-shaped token found in the text. */
  tokens: string[];
  /** The tokens that are not in the set of paths the model was shown. */
  invented: string[];
  /** 1 when nothing was invented (or nothing was cited); else the share that held. */
  score: number;
};

// Extensions that make a bare name (no slash) in a code span a file reference.
// A name like Next.js or Node.js in prose is never one: it is only looked at
// inside a code span, and only with one of these extensions.
const FILE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "json",
  "css",
  "scss",
  "md",
  "mdx",
  "yml",
  "yaml",
  "html",
  "svg",
  "toml",
  "sql",
  "prisma",
  "graphql",
];
const BARE_FILE = new RegExp(
  `^[A-Za-z0-9_@\\-\\[\\]()]+(?:\\.[A-Za-z0-9_\\-]+)*\\.(?:${FILE_EXTENSIONS.join("|")})$`,
);

// A run of path characters, possibly with slashes.
const CANDIDATE = /[A-Za-z0-9_@.\-[\]()/]+/g;

const count = (text: string, char: string): number => text.split(char).length - 1;

// Strips punctuation that belongs to the sentence, not to the path, keeping the
// brackets and parentheses that are part of it ("app/(app)/page.tsx").
function trim(token: string): string {
  let t = token;
  for (;;) {
    const before = t;
    t = t.replace(/[.,;:!?]+$/, "");
    if (t.endsWith(")") && count(t, "(") < count(t, ")")) t = t.slice(0, -1);
    if (t.endsWith("]") && count(t, "[") < count(t, "]")) t = t.slice(0, -1);
    if (t.startsWith("(") && count(t, "(") > count(t, ")")) t = t.slice(1);
    if (t === before) return t;
  }
}

/** Whether a token has the shape of a repository path (not whether it is one). */
function isPathShaped(token: string, inCode: boolean): boolean {
  if (token === "" || token.includes("://") || token.startsWith("//")) return false;
  if (token.includes("/")) {
    // A folder is written with its trailing slash; a file has an extension that
    // starts with a letter. "and/or" and "client/serveur" are neither.
    return token.endsWith("/") || /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(token);
  }
  return inCode && BARE_FILE.test(token);
}

export function pathTokens(text: string): string[] {
  const found = new Set<string>();

  // Inside backticks the whole span is one candidate, and a bare file name
  // counts there.
  const withoutCode = text.replace(/`([^`\n]+)`/g, (_, span: string) => {
    const t = trim(span.trim());
    if (isPathShaped(t, true)) found.add(t);
    return " ";
  });

  // In prose only slash-bearing tokens count.
  for (const match of withoutCode.matchAll(CANDIDATE)) {
    const t = trim(match[0]);
    if (isPathShaped(t, false)) found.add(t);
  }
  return [...found].sort();
}

/**
 * @param shown every path the model was handed: the file, its neighbours, and
 *   for a folder the lists it was given.
 */
export function checkPaths(text: string, shown: ReadonlySet<string>): PathCheck {
  const tokens = pathTokens(text);
  const invented = tokens.filter((token) => {
    if (shown.has(token)) return false;
    // A folder the model names is fine if it is the folder of something it was
    // shown: it was handed the files, and a folder is part of their path.
    if (token.endsWith("/")) {
      for (const path of shown) if (path.startsWith(token)) return false;
    }
    return true;
  });
  return {
    tokens,
    invented,
    score: tokens.length === 0 ? 1 : 1 - invented.length / tokens.length,
  };
}
