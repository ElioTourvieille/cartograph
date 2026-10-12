import { createHash } from "node:crypto";

// A file's text, fetched from the repository when it is needed. Nothing here is
// stored: the analysis keeps only each file's hash, and the text is read again
// at the commit that was analysed.

/** A file longer than this is cut before it reaches a prompt. */
export const MAX_SOURCE_CHARS = 40_000;

/**
 * The file at a given commit of a public repository, or null if it is not
 * there or GitHub cannot be reached. Decoded as bytes, so a leading BOM is kept
 * exactly as the parser read it and the hash matches the stored one.
 */
export async function fetchSource(
  owner: string,
  name: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${encoded}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer()).toString("utf8");
  } catch {
    return null;
  }
}

/** The same hash the parser stores for a file's contents. */
export const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
