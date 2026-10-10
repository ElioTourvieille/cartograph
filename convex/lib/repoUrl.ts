import { ConvexError } from "convex/values";

// A repository as a person types it: a GitHub URL, with or without the scheme,
// a trailing ".git" or a path below the repository, or just "owner/name".
// Pure, so the server and the Convex mutation read a URL the same way.

export type Repo = {
  owner: string;
  name: string;
  /** "owner/name" lowercased: the key one analysis per repository rests on. */
  key: string;
  url: string;
};

const OWNER = /^[A-Za-z0-9-]+$/;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function parseRepoUrl(input: string): Repo {
  const trimmed = input.trim();
  const path = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?github\.com\//i, "");
  // After stripping, "owner/name/…" is what is left of a GitHub address. Another
  // host stays whole in the first segment ("gitlab.com") and fails the owner
  // check below: a GitHub owner has no dot in it.
  const [owner, rawName, ...rest] = path.split("/");
  const name = rawName?.replace(/\.git$/i, "");

  if (
    owner === undefined ||
    name === undefined ||
    !OWNER.test(owner) ||
    !SEGMENT.test(name) ||
    name === "." ||
    name === ".." ||
    (rest.length > 0 && rest[0] !== "tree" && rest[0] !== "blob" && rest[0] !== "")
  ) {
    throw new ConvexError(
      "Adresse non reconnue : indiquez un dépôt GitHub public, par exemple https://github.com/propriétaire/dépôt.",
    );
  }
  return {
    owner,
    name,
    key: `${owner}/${name}`.toLowerCase(),
    url: `https://github.com/${owner}/${name}`,
  };
}
