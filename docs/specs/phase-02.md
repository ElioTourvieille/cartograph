# Phase 2 — Dashboard and schema

**Goal.** The workspace exists, it belongs to one team, and it can prove that.

## Build

- The schema, in version control. Eight tables: projects, analyses, files,
  edges, routes, explanations, file roles, insights. Every one of them carries
  the id of the organization that owns it, with an index on it.
- **The org-scoping builders.** The only way to define a public query or
  mutation. They read the organization off the verified token, refuse to run
  with none, and hand the function a database handle that can only be asked for
  rows through the organization index. Replace the diagnostic query from phase 1
  with these.
- **A deletion function that removes everything an organization owns**, in
  batches, because there is no cascade. Hooking it to the identity provider's
  organization-deleted event is a later concern; the function and its check
  exist now.
- **An isolation check anyone can run from a terminal.** It fails if any table
  lacks an organization field or its index, or if any public function is built
  from a raw builder.
- The dashboard: the list of analyses belonging to the organization you're
  currently in, what state each one is in, and an empty state for a team that
  has never run one.
- Seeded rows for two different organizations, because nothing creates a real
  one yet. The seed is an internal function run from the terminal, never
  reachable from the browser.

## Constraints

- Authorization is one code path, not a check each function remembers to
  perform. A public function cannot be written without going through the
  builders. The check enforces that rather than trusting it.
- **No function takes an organization id as an argument.** Not to filter, not
  to switch, not "for admins". The organization comes from the token and
  nothing else.
- **Asking for a row by its id still goes through the organization.** Fetching
  another organization's analysis id directly must return nothing, exactly as if
  it did not exist. Listing is not the only way to leak.
- The schema is a file in version control. No table or index is created by
  hand in a dashboard.
- The dashboard does not filter by organization in application code. If the
  query returned another organization's row, the bug is the builder.
- Switching organization changes what the same page shows, without a different
  query being written for it.
- Documents stay small. Nothing stores a file's contents; that is fetched from
  the repository when needed.
- The shape of the files and edges tables has to survive a repository of four
  thousand files and ten thousand edges being read into the browser whole in
  phase 7. State now how a read that large fits inside Convex's per-call
  limits, and what you chose if the answer is to pack rows into larger
  documents. If it is, tell me before building, with the option you'd take.

## Acceptance check

1. With analyses seeded for two different organizations: signed in to the
   first, the dashboard lists only that organization's rows. Switch
   organization, the list changes, and no code went looking for a different
   table.
2. Run the isolation check. It passes. Then add a table without an index, and
   separately a public function from a raw builder, and confirm it fails each
   time. Remove both.
3. Signed in to the first organization, ask for an analysis id belonging to the
   second, by id. Nothing comes back. Same for each other table with an id from
   the second organization.
4. Run the deletion function on the second organization: all eight tables are
   empty of its rows, and the first organization's rows are untouched.

## Not in this phase

The "analyse a repository" form. There is nothing behind it to call yet, and a
button that does nothing for a long stretch is worse than no button.