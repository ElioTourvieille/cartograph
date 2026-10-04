# Phase 10 — Explain, cached and traced

**Goal.** The first model call, and everything that has to be true around it.

## Build

- One place in the entire codebase that constructs the AI client (the Anthropic
  SDK), wrapped so every call through it is traced.
- **Explaining a file**, written from that file's real neighbours — the things
  it imports and the things importing it, all of them handed to the model.
- **Explaining a folded folder**, which is a different question: what's in here,
  and why does so much point at it.
- Assigning roles to files no adapter could identify.
- A cache for both, keyed on the content of the thing being explained. It lives
  in the explanations and file roles tables, read and written under the user's
  verified token like everything else.
- **An explanation already fetched stays in the pane.** Move the selection
  away, come back, and it is still there without a second click. A cache
  nobody can feel is not a cache.
- **Rendering the explanation.** The prompt permits exactly three pieces of
  formatting — inline code, bullets and bold — and no headings, because the pane
  is narrow and headings cut a few short paragraphs into labelled fragments.
  Render those three, and turn every repository path in the prose into a link
  that moves the map.
- **Staleness.** Each explained file's stored content hash is checked against
  the repository. If the file has changed, or the repository has moved past the
  commit that was analysed, say so and offer to re-analyse.

## Constraints

- The model may explain and label. It may not decide that two files are
  connected, and it may not walk the graph. Every path it sees was handed to it.
- **The cache read happens inside the traced call**, not before it. A cache hit
  must appear in the traces as a recorded run containing no model call —
  otherwise there's no way to tell a working cache from a broken one. This
  cache is ours, keyed on content. It has nothing to do with the provider's
  prompt caching, and the two must not be confused in code or in names.
- Model versions are pinned exactly, never to a moving alias, and the model
  name is part of the cache key. Re-pinning one invalidates only its own cache.
  Use a small model for classification and a larger one for explanations, name
  both, and say where you found each exact identifier.
- Classification may only answer with roles that are _not_ structural. It may
  say service, repository, model, util, config, component or hook. It may never
  say page, route or controller — those decide the route table and the
  entry-point colouring, and convention owns them. The allowed set is enforced
  by the shape of the request, and anything outside it is rejected in code
  after the answer as well.
- Don't forbid formatting outright and print whatever comes back. Models don't
  reliably obey that, and the result is backticks rendered as backticks —
  markdown with the renderer missing. Permitting a small subset and rendering it
  is the option that survives contact.
- A model call happens in server code with the user's token still valid, and
  writes its result back through the org-scoped path. It never uses the
  pipeline's secret.
- If tracing is unconfigured, calls still succeed. Make that state visible
  somewhere, because an absent key otherwise looks exactly like a working setup
  with no traffic.
- Prompts contain other people's source code. Say in one line where traces
  are stored and whether inputs and outputs can be hidden, because that is a
  decision the owner has to make before client code goes through this.

## Acceptance check

1. Click **Explain** on a file: a paragraph describing what it does in the
   context of its actual neighbours. It names files that are genuinely its
   neighbours, and clicking one of those names moves the map to it.
2. No stray backticks, asterisks or hash symbols anywhere in the rendered
   output.
3. Click it again: instant. Then open the tracing dashboard — both runs are
   there, and the second one records zero tokens.
4. Explain a folded folder. The answer is about the folder, not a summary of
   one file in it.
5. Push a commit to the analysed repository, reload, click Explain on the file
   you changed. It says the explanation is stale and offers to re-analyse.
6. Find a file no adapter matched. It has a sensible role, and that role is not
   a routable one.
7. Signed in to a second organization, explain the same file from the same
   repository. It does not reuse the first organization's cached explanation.

## Not in this phase

Measuring whether any of this is any good. That comes next.