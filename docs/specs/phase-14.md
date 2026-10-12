# Phase 14 — Private repositories

**Goal.** An organization installs a GitHub App on the repositories it chooses,
and can then map those private repositories exactly like public ones, without
this app ever holding a credential that outlives a single run.

This phase is why the app is useful to the studio: client repositories live in a
private GitHub organization. Read `docs/project-doc.md`, "Private client code",
before building.

## Build

- **A GitHub App, read-only.** Repository contents and metadata, nothing else.
  Creating the App and putting its id and private key into the server
  environment is a manual step. Say exactly which values you need and where
  they go, then stop.
- **Installing it.** From an organization's settings, a button sends the person
  to GitHub to install the App on an account and pick repositories. On the way
  back, the installation is recorded against the organization that started the
  flow, not against anything the returning request claims. The flow carries a
  value that proves which organization started it and can't be replayed.
- **A table of installations.** One row per installation, with its organization
  and an index on it, built and read through the org-scoping builders like every
  other table. It holds the installation id and the account name. It holds no
  token and no key.
- **Choosing a repository.** The dashboard form gains a second way in: pick from
  the repositories the organization's installations can see, in addition to
  pasting a public URL. The list is fetched on demand and never stored.
- **Starting a run on a private repository** follows the same rules as before:
  one analysis per repository, created under the user's verified token. The
  analysis row records which installation it was made through. The pipeline
  reads that from the row, never from its caller.
- **Fetching.** For a private repository the pipeline mints an installation
  token for this run only, fetches the archive at one commit, records that
  commit, and discards the token. A public repository keeps its existing path
  and uses no token at all.
- **The checkout is temporary.** Extracted files exist on disk for the length of
  the run and are removed when it ends, including when it fails.
- **Removing an installation.** Disconnecting one stops new runs through it.
  Existing analyses stay readable, since they hold paths and edges only, and
  say so on screen. If GitHub reports the installation gone, runs fail with a
  stage that names that, not a generic error.
- **Private repositories and explanations.** Explaining a file needs its
  contents. They are fetched again at the analysed commit for that request,
  held in memory, and never written to Convex. If the repository can no longer
  be reached, the explanation says so instead of answering from nothing.
- **Trace privacy.** For an analysis of a private repository, nothing that
  contains file contents, prompts built from them, or model output reaches the
  trace store. The run is still recorded, with its stage, timing and cache hit
  or miss, so the cache stays verifiable. Decide how, and tell me which way you
  went before building.
- **The cache.** Cached explanations of private files are still org-scoped, and
  the cache key must not let one organization's lookup return another's entry.
  This is already required in phase 10. Check it still holds for private
  analyses.

## Constraints

- **No user GitHub token is ever stored or requested.** Sign-in is still
  identity only. The only long-lived secret is the App's private key, and it
  lives in the server environment, never in Convex and never in a client bundle.
- **No installation id comes from the browser at run time.** It is read off the
  analysis row, which was created under a verified token and an installation
  belonging to that organization.
- A function that accepts an installation id from a caller to act on it is the
  same bug as one that accepts an organization id.
- No file contents in Convex. The graph is paths, edges and counts, as before.
- The parser still takes a directory and nothing else. It does not learn that
  private repositories exist.
- The explanation check from phase 11 still runs, and private analyses are not
  exempt from it.

## Acceptance check

**Terminal, mine to run, report the output.**

1. The isolation check script from phase 2 still passes, and now covers the
   installations table.
2. Seeded with two organizations, each with an installation, a request from one
   naming the other's installation by id, through every function that could take
   one, returns nothing and starts nothing.
3. Search the Convex tables and the trace output for a private run for a
   distinctive string that appears only inside a source file of the repository.
   It is absent from both. Report what you searched.
4. After a run, success or failure, the extracted checkout is gone from disk.

**Browser, mine, a few minutes.**

5. Install the App on a test private repository from the studio's account.
   Pick it from the list. It maps, the progress page names the stages, and the
   coverage banner reads as it does for a public repository.
6. Explain a file in it. The explanation names only files that exist in the
   repository.
7. Sign in as someone in a different organization. The installation, the
   repository and the analysis are nowhere in what that person can see.
8. Uninstall the App on GitHub and start another run. It fails at a stage that
   says the installation is gone. The existing map is still there.

## Not in this phase

Re-analysing automatically when the repository changes. Webhooks. Branch
choice. Any language beyond TypeScript and JavaScript. Per-user permissions
inside an organization beyond the default roles.