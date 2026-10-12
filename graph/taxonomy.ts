// The categories of the left rail, per framework. This file is plain data and
// imports nothing, on purpose: the browser reads the category names from here
// without pulling in a parser or a file-system library. The adapters assign
// these role ids to files; they never invent a name of their own.
//
// Names are the concrete ones a developer uses ("Controllers", never "Entry
// points"). They stay in English, as the terms of the trade are. Order is
// reading order and it is fixed: what is routable first, then the layers behind
// it, then the plumbing. The same repository always shows them in the same
// places.

export type RoleDef = {
  id: string;
  label: string;
  /** The framework reaches such a file without an import (a page, a route…). */
  reached: boolean;
};

export type FrameworkDef = {
  label: string;
  roles: readonly RoleDef[];
};

const role = (id: string, label: string, reached = false): RoleDef => ({
  id,
  label,
  reached,
});

/** Tests are recognised the same way whatever the framework. */
export const TESTS: RoleDef = role("tests", "Tests");

/** A file in a repository with frameworks, to which no convention gave a role. */
export const UNIDENTIFIED: RoleDef = role("unidentified", "Fichiers non identifiés");

/** The order frameworks are tried in, and listed in. The first match wins. */
export const FRAMEWORK_ORDER = ["nextjs", "nestjs", "express", "react"] as const;

export const FRAMEWORKS: Readonly<Record<string, FrameworkDef>> = {
  nextjs: {
    label: "Next.js",
    roles: [
      role("nextjs:page", "Page routes", true),
      role("nextjs:api", "API endpoints", true),
      role("nextjs:action", "Server actions"),
      role("nextjs:layout", "Layouts", true),
      role("nextjs:special", "Special files", true),
      role("nextjs:component", "Components"),
      role("nextjs:hook", "Hooks"),
      role("nextjs:lib", "Libs"),
      role("nextjs:middleware", "Middleware", true),
      role("nextjs:config", "Config", true),
    ],
  },
  nestjs: {
    label: "NestJS",
    roles: [
      role("nestjs:controller", "Controllers", true),
      role("nestjs:gateway", "Gateways", true),
      role("nestjs:resolver", "Resolvers", true),
      role("nestjs:service", "Services"),
      role("nestjs:module", "Modules"),
      role("nestjs:entity", "Entities"),
      role("nestjs:schema", "Schemas"),
      role("nestjs:dto", "DTOs"),
      role("nestjs:repository", "Repositories"),
      role("nestjs:guard", "Guards"),
      role("nestjs:pipe", "Pipes"),
      role("nestjs:interceptor", "Interceptors"),
      role("nestjs:filter", "Filters"),
      role("nestjs:middleware", "Middleware"),
      role("nestjs:decorator", "Decorators"),
      role("nestjs:strategy", "Strategies"),
      role("nestjs:bootstrap", "Bootstrap", true),
    ],
  },
  express: {
    label: "Express",
    roles: [
      role("express:router", "Routers"),
      role("express:controller", "Controllers"),
      role("express:service", "Services"),
      role("express:model", "Models"),
      role("express:middleware", "Middleware"),
      role("express:view", "Views"),
      role("express:util", "Utils"),
      role("express:config", "Config"),
      role("express:entry", "Entry files", true),
    ],
  },
  react: {
    label: "React",
    roles: [
      role("react:page", "Pages"),
      role("react:component", "Components"),
      role("react:hook", "Hooks"),
      role("react:context", "Contexts"),
      role("react:entry", "Entry files", true),
    ],
  },
};

/** Every role of every framework, plus the shared ones, by id. */
export const ROLES: ReadonlyMap<string, RoleDef> = new Map(
  [
    TESTS,
    UNIDENTIFIED,
    ...Object.values(FRAMEWORKS).flatMap((f) => f.roles),
  ].map((r) => [r.id, r]),
);

/**
 * The rail for a repository: for each framework found, in the fixed order, its
 * roles in their fixed order; then Tests; then what nothing identified.
 */
export function railOrder(frameworks: readonly string[]): RoleDef[] {
  const present = FRAMEWORK_ORDER.filter((id) => frameworks.includes(id));
  return [...present.flatMap((id) => FRAMEWORKS[id].roles), TESTS, UNIDENTIFIED];
}
