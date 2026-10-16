import { createHash } from "node:crypto";

// A file's text, fetched from the repository when it is needed. Nothing here is
// stored: the analysis keeps only each file's hash, and the text is read again
// at the commit that was analysed.

/** A file longer than this is cut before it reaches a prompt. */
export const MAX_SOURCE_CHARS = 40_000;

/**
 * The file at a given commit, or null if it is not there or GitHub cannot be
 * reached. Decoded as bytes, so a leading BOM is kept exactly as the parser
 * read it and the hash matches the stored one.
 *
 * With an installation token (a private repository) the file comes through the
 * API as raw content, with that token; without one it comes from the public
 * raw endpoint. The text is returned to the caller and held in memory for one
 * request: nothing here writes it anywhere.
 */
export async function fetchSource(
  owner: string,
  name: string,
  ref: string,
  path: string,
  token?: string,
): Promise<string | null> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  try {
    const response =
      token === undefined
        ? await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${ref}/${encoded}`, {
            signal: AbortSignal.timeout(20_000),
          })
        : await fetch(
            `https://api.github.com/repos/${owner}/${name}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
            {
              headers: {
                Accept: "application/vnd.github.raw+json",
                Authorization: `Bearer ${token}`,
                "User-Agent": "cartograph",
                "X-GitHub-Api-Version": "2022-11-28",
              },
              signal: AbortSignal.timeout(20_000),
            },
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
