import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { isSourceFile } from "../../parser/walk.ts";

// Fetching a public repository as an archive. No repository scope is asked of
// anyone and no token is read or stored: these are the unauthenticated GitHub
// endpoints, which only ever see public repositories.

/** An expected failure, with a message a person can act on. */
export class PipelineError extends Error {}

const API = "https://api.github.com";
const HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "cartograph",
  "X-GitHub-Api-Version": "2022-11-28",
};

/** A repository bigger than this is not a repository to map in a browser. */
export const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

async function github(url: string, accept?: string, timeoutMs = 60_000): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: accept === undefined ? HEADERS : { ...HEADERS, Accept: accept },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new PipelineError("GitHub est injoignable ou n'a pas répondu à temps.");
  }
  if (response.status === 404) {
    throw new PipelineError(
      "Dépôt introuvable ou privé : seul un dépôt GitHub public peut être analysé.",
    );
  }
  if (response.status === 403 || response.status === 429) {
    throw new PipelineError(
      "Limite de requêtes GitHub atteinte : réessayez dans quelques minutes.",
    );
  }
  if (response.status === 409) throw new PipelineError("Le dépôt est vide.");
  if (!response.ok) throw new PipelineError(`GitHub a répondu ${response.status}.`);
  return response;
}

/** The full sha of the default branch's latest commit. */
export async function latestCommit(owner: string, name: string): Promise<string> {
  const response = await github(
    `${API}/repos/${owner}/${name}/commits/HEAD`,
    "application/vnd.github.sha",
  );
  const sha = (await response.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new PipelineError("GitHub n'a pas renvoyé de commit exploitable.");
  }
  return sha;
}

export type NotExtracted = { path: string; reason: string; detail: string | null };

/**
 * Downloads the archive of one commit and unpacks it into `dest`, without its
 * top-level folder. Entries that could not be written (links, names the file
 * system refuses) are returned, not dropped: the parser cannot count a file it
 * never saw, so whoever stores the coverage has to.
 */
export async function downloadArchive(
  owner: string,
  name: string,
  sha: string,
  dest: string,
): Promise<NotExtracted[]> {
  const response = await github(
    `${API}/repos/${owner}/${name}/tarball/${sha}`,
    undefined,
    10 * 60_000,
  );
  if (response.body === null) throw new PipelineError("L'archive est vide.");

  const missed: NotExtracted[] = [];
  const relative = (path: string): string => path.split("/").slice(1).join("/");

  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      if (bytes > MAX_ARCHIVE_BYTES) {
        done(new PipelineError("Le dépôt dépasse 250 Mo : trop volumineux pour être analysé."));
      } else {
        done(null, chunk);
      }
    },
  });

  const extract = tar.x({
    cwd: dest,
    strip: 1,
    // Links are not followed (they can point anywhere) but they are reported.
    filter: (path, entry) => {
      if ("type" in entry && (entry.type === "SymbolicLink" || entry.type === "Link")) {
        missed.push({ path: relative(path), reason: "lien-symbolique", detail: "non extrait" });
        return false;
      }
      return true;
    },
    onwarn: (_code, message, data) => {
      const path = typeof data.path === "string" ? relative(data.path) : "";
      missed.push({ path, reason: "non-extrait", detail: String(message) });
    },
  });

  try {
    await pipeline(Readable.from(response.body), limit, extract);
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("L'archive n'a pas pu être téléchargée ou décompressée.");
  }
  // Only entries that look like source count as files the map is missing.
  return missed.filter((m) => m.path !== "" && isSourceFile(m.path));
}
