# Phase 7 — The pipeline

**Goal.** Paste a URL and watch your own repository become a map.

## Build

- Fetching a public repository as an archive. No repository scope is requested
  and no token is ever stored.
- Record which commit the archive came from. A later phase needs to know
  whether the repository has moved on since.
- The run: fetch, select, parse, store — with named stages, and a catch at the
  top that writes a failed state rather than leaving a row stuck mid-parse
  forever. Parsing runs in the Next.js server, not inside Convex.
- **Starting a run** is a mutation under the user's verified token. It creates
  the analysis row for their organization, or finds the existing one. Only
  after that does the pipeline begin.
- **The pipeline's write path.** It is handed an analysis id and a server-only
  secret, nothing else. It writes in batches and sets the stage. The
  organization comes from the analysis row, never from the caller.
- The form on the dashboard, finally wired to something.
- **One analysis per repository.** Submitting a URL that has already been
  analysed does not create a second one — it takes you to the existing
  analysis. Re-running the same repository is a deliberate act from that
  analysis, not something you get by pasting the URL again. A re-run clears the
  analysis's previous rows before writing new ones.
- A progress page that names the stage as it happens, updated live.
- The explorer, now reading real stored rows instead of the checked-in file.
- A coverage banner on the map, which says the graph is partial when it is.

## Constraints

- **Live progress is a subscribed query, not browser polling.** It returns only
  the stage, its message and its timestamps. It must not read the files, edges
  or any other table the run is writing into, or every batch re-runs it.
- Check-then-create for "one analysis per repository" happens inside a single
  mutation. Convex has no unique constraint, so the guarantee is that
  transaction and nothing else. Two people pasting the same URL at the same
  moment still yield one row.
- Writes go in batches that stay well inside Convex's limits on documents and
  bytes per call. State the batch size and how you chose it against a big
  repository, not a small one.
- **Partial rows are never shown.** A failed or abandoned run leaves some rows
  written. The explorer reads only analyses marked complete, and a re-run clears
  before it writes.
- **The server-only secret never reaches the browser**, and the write path
  rejects every call without it. The organization is not an input to that path.
- The explorer loads a whole analysis into the browser once, and everything
  after that is computed locally with no further function calls. A repository
  of four thousand files and ten thousand edges has to load. If it does not
  fit in one call, page it in and show a loading state for the load only.
- A run that fails writes _why_ it failed and which stage it failed in.
- **A run that dies without failing has to be visible too.** Nothing here has a
  queue, so a process that stops mid-parse leaves a row that will say "parsing"
  forever. Any unfinished run past a few minutes old shows as stale on the
  dashboard, so the difference between working and abandoned is legible
  without opening it. Say whether you did that with a scheduled check
  or in the display; I'd take the scheduled check because it also fixes the
  stored state.
- The coverage banner may collapse, but it collapses to a single line that
  still names the figure. A graph that is quietly thirty percent complete must
  never be able to look complete.
- **Delete the checked-in parser output and the preview route as part of this
  phase.** It was scaffolding to build the interface against; analyses are
  stored properly now. Everything built on it keeps working, on live data.

## Acceptance check

1. Paste a public repository URL. The stages tick past with real names, not a
   spinner, and land on its map.
2. Paste a repository you've already analysed. You land on the existing
   analysis. There is still one row for it, not two.
3. Paste a URL for a repository that doesn't exist. It fails with a message
   that says what went wrong, and the dashboard row reads failed — not
   "parsing" forever.
4. Open the dashboard in a second tab during a run. The stage updates there
   too, without a refresh.
5. Analyse a repository with a deliberately awkward setup — aliases, or a
   nested app — and confirm the coverage banner appears and names a figure
   under 95%.
6. Analyse a repository of several thousand files. It loads into the map, and
   report the batch size and how long it took.
7. Call the pipeline's write path without the secret, and then with it but with
   the id of an analysis belonging to another organization signed in. The first
   is rejected; the second can only ever write to that analysis's own
   organization.

## Not in this phase

Framework-specific roles, and routes.