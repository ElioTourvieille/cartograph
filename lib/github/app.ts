import { createPrivateKey, createSign } from "node:crypto";

// Talking to GitHub as the App. This is the only file that touches the App's
// private key, and the key never leaves this server's environment: not Convex,
// not a client bundle, not the agent. What it hands out is short-lived and goes
// no further than the run or the request that asked for it:
//
//   - an App JWT, valid for minutes, only used here to ask GitHub for a token;
//   - an installation token, one per run or request, narrowed to reading
//     repository contents, and thrown away with the run.
//
// Nothing here stores anything, and no user's GitHub token is ever involved.

/** An expected failure, with a message a person can act on. */
export class GithubAppError extends Error {}
/** GitHub says the installation no longer exists. */
export class InstallationGone extends GithubAppError {}

const API = "https://api.github.com";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new GithubAppError(`${name} manque dans .env.local : l'App GitHub n'est pas configurée.`);
  }
  return value;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

/** The App's own credential: proves we are the App, nothing more. */
function appJwt(): string {
  const key = createPrivateKey(
    Buffer.from(env("GITHUB_APP_PRIVATE_KEY"), "base64").toString("utf8"),
  );
  const now = Math.floor(Date.now() / 1000);
  // Issued a minute in the past: GitHub rejects a token from a clock ahead of its own.
  const body = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: env("GITHUB_APP_ID") }),
  )}`;
  return `${body}.${b64url(createSign("RSA-SHA256").update(body).sign(key))}`;
}

async function call(
  path: string,
  auth: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  try {
    return await fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${auth}`,
        "User-Agent": "cartograph",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GithubAppError("GitHub est injoignable ou n'a pas répondu à temps.");
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type InstallationInfo = { account: string; createdAt: number };

/** What GitHub says about an installation of this App, or null if there is none. */
export async function getInstallation(githubId: number): Promise<InstallationInfo | null> {
  const response = await call(`/app/installations/${githubId}`, appJwt());
  if (response.status === 404) return null;
  if (!response.ok) throw new GithubAppError(`GitHub a répondu ${response.status}.`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.account) || typeof body.account.login !== "string") {
    throw new GithubAppError("GitHub n'a pas renvoyé de compte pour cette installation.");
  }
  const created = typeof body.created_at === "string" ? Date.parse(body.created_at) : NaN;
  if (Number.isNaN(created)) {
    throw new GithubAppError("GitHub n'a pas renvoyé de date d'installation.");
  }
  return { account: body.account.login, createdAt: created };
}

/**
 * A token for one installation, narrowed to reading contents. The caller holds
 * it for the length of one run or one request and drops it.
 */
export async function installationToken(githubId: number): Promise<string> {
  const response = await call(`/app/installations/${githubId}/access_tokens`, appJwt(), {
    method: "POST",
    body: { permissions: { contents: "read" } },
  });
  if (response.status === 404) {
    throw new InstallationGone("L'installation GitHub n'existe plus : l'App a été désinstallée.");
  }
  if (response.status === 403 || response.status === 401) {
    throw new GithubAppError(
      "GitHub a refusé l'accès de l'App : l'installation est suspendue ou retirée.",
    );
  }
  if (!response.ok) throw new GithubAppError(`GitHub a répondu ${response.status}.`);
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.token !== "string" || body.token === "") {
    throw new GithubAppError("GitHub n'a pas renvoyé de jeton d'installation.");
  }
  return body.token;
}

/** Most repositories listed for one installation; the rest is counted, not fetched. */
export const REPO_LIST_CAP = 300;

export type RepoList = { repos: string[]; total: number };

/** "owner/name" of the repositories the installation can see. Fetched on demand, never stored. */
export async function listRepositories(token: string): Promise<RepoList> {
  const repos: string[] = [];
  let total = 0;
  for (let page = 1; repos.length < REPO_LIST_CAP; page++) {
    const response = await call(`/installation/repositories?per_page=100&page=${page}`, token);
    if (!response.ok) throw new GithubAppError(`GitHub a répondu ${response.status}.`);
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.repositories)) break;
    if (typeof body.total_count === "number") total = body.total_count;
    for (const repo of body.repositories) {
      if (isRecord(repo) && typeof repo.full_name === "string") repos.push(repo.full_name);
    }
    if (body.repositories.length < 100) break;
  }
  return { repos: repos.sort((a, b) => a.localeCompare(b)).slice(0, REPO_LIST_CAP), total };
}

/** Whether this installation's token can read the repository. */
export async function canRead(token: string, owner: string, name: string): Promise<boolean> {
  const response = await call(`/repos/${owner}/${name}`, token);
  return response.ok;
}
