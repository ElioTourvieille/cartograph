# Phase 1 — Auth and teams

**Goal.** Someone signs in, belongs to a team, and lands somewhere that belongs
to that team, in the theme they prefer.

Sign-in itself is already scaffolded. This phase is about what has to be true
around it.

## Build

- **Organizations.** Signing in for the first time lands the person inside one
  without being asked to create it. There's a way to switch between them, and a
  way to invite someone else into one. Accepting an invitation brings the person
  to this app's login page.
- **The current organization is readable during server rendering**, not only in
  the browser.
- Whichever sign-in methods are enabled all lead to the same place. Adding or
  removing one is configuration, not a code change.
- Signed-out visitors to a protected route get sent to the login screen before
  anything renders.
- A theme control with three states: follow the system, force light, force
  dark. Written to the root element so the colour tokens key off it.
- The application shell everything later renders inside.
- The Convex client wired in with the identity provider's token, and one
  diagnostic query that returns the organization claim as Convex sees it.

## Constraints

- **Identity is a token, and the token carries the organization.** Everything
  built after this decides what someone can see by reading that claim. Nothing
  downstream should ever have to ask the identity provider a question at
  runtime.
- Use what the sign-in scaffolding already provides rather than rebuilding it.
  If a hand-written login form appears in this phase, something has gone wrong.
- **One session system, not two.** Convex gets its token from the identity
  provider's existing session. No second auth provider, no second cookie, no
  middleware slot contested by two libraries.
- **The Convex client carries the signed-in token.** The only query that exists
  is the diagnostic one, but the client has to be constructed so the token
  travels with every request, because that's what makes the organization claim
  readable inside a function later. A client wired up anonymously looks
  completely fine until the first scoped function exists, and then returns
  nothing. The organization claim must be present in the token Convex receives,
  not only in the one the browser holds. Say how you confirmed that.
- Environment configuration fails loudly at startup if it's missing. A blank
  value that produces a confusing error three screens later is worse than a
  crash on boot.
- Nothing here creates a table. No schema yet.

## Acceptance check

1. Sign in on a brand new account with each method that's enabled. They all land
   in the same place, and the account is already inside an organization without
   having been asked to make one.
2. Invite a second account. Accepting the invitation arrives at the login page,
   and signing in from there lands in that organization's workspace.
3. Read the current organization in a server component and render it. It's there
   on the first paint, not after a client-side hydration.
4. Switch the theme, reload, the choice is still there. All three states work,
   and forcing light while the system is dark actually wins.
5. Visit a protected route while signed out, get redirected to login. Confirm in
   the network tab that the page's HTML was never sent.
6. Call the diagnostic query signed in: it returns the same organization id the
   server component rendered. Switch organization and call it again: it
   returns the new one. Signed out, it returns nothing rather than throwing
   something confusing.

## Not in this phase

Any table. Roles beyond the defaults that come out of the box. Styling the
sign-in screen beyond making it match the rest of the app.