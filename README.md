# Cartograph

A local app that reads a public GitHub repository (TypeScript or JavaScript) and draws it as a dependency map: folders as boxes, imports as lines between them. The interface is entirely in French.

Select a file and see what it imports, what imports it, and what breaks two levels out if it changes. Ask for an explanation and get a paragraph written from that file and its real neighbours. A chat panel lets you ask the repository a question and shows the lookups behind each answer.

## Who it's for

A developer opening a codebase they didn't write, most often one they built with an agent across many sessions and can no longer hold in their head. They can read the code. What they can't see is its shape.

An analysis belongs to an organization, not to whoever ran it. A repository is mapped once and everyone after that starts from the map.

## The rule everything rests on

**Every box and every line comes from really parsing the code.**

The AI explains and labels. It never decides that two files are connected, and it never walks the graph when arithmetic can do it. An edge exists because the parser resolved a real import to a real file. Anything unresolved is reported with a reason, never guessed. Absent beats approximate.

Cartograph also doesn't grade code: no scores, ratings or "issues found". It explains a codebase, it doesn't review one.

## Stack

- Next.js 16 (App Router), React 19, TypeScript strict
- ts-morph for parsing
- React Flow and dagre for the map
- Clerk for sign-in and organizations
- Convex for the database, server functions and live queries
- Anthropic SDK through one wrapped client, traced with LangSmith
- Tailwind v4
- pnpm

## How we work

Spec driven. Nothing gets built without a spec, and one phase is built at a time.

- [`CLAUDE.md`](CLAUDE.md): the rules, always in force.
- [`docs/project-doc.md`](docs/project-doc.md): what the app is and the reasoning behind every decision.
- [`docs/specs/`](docs/specs): one spec per phase (`phase-01.md` to `phase-13.md`). Each describes behaviour and an acceptance check, never filenames.

The acceptance check is a list of things done by hand in a browser. There is no test runner or browser driver. Before a phase counts as done, types, lint and build must pass. When a phase comes out wrong, it is reset rather than patched.

## Phases

1. Auth and teams
2. Dashboard and schema
3. Parser
4. Canvas
5. Detail panel
6. Graph maths, rail, insights
7. Pipeline (URL to map)
8. Next, Nest and React adapters
9. CommonJS and Express
10. AI explanations (cache and traces)
11. Evals
12. Chat agent
13. Landing page

## Status

No phase is built yet. The repository holds the Create Next App scaffold, the project doc, the rules and the specs.
