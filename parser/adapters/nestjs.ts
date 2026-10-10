import { folderOf, type Adapter } from "../adapter.ts";
import type { Arg } from "../facts.ts";
import type { Route } from "../types.ts";

// NestJS: roles from filename suffixes, and routes assembled from the
// decorators on the controller and on the method together. A route is emitted
// only when every part of its pattern is a literal written in the code.

const EXT = String.raw`\.[cm]?[jt]s$`;
const SUFFIXES: readonly [RegExp, string][] = [
  [new RegExp(String.raw`\.(spec|test|e2e-spec)` + EXT), "tests"],
  [new RegExp(String.raw`\.controller` + EXT), "nestjs:controller"],
  [new RegExp(String.raw`\.gateway` + EXT), "nestjs:gateway"],
  [new RegExp(String.raw`\.resolver` + EXT), "nestjs:resolver"],
  [new RegExp(String.raw`\.service` + EXT), "nestjs:service"],
  [new RegExp(String.raw`\.module` + EXT), "nestjs:module"],
  [new RegExp(String.raw`\.entity` + EXT), "nestjs:entity"],
  [new RegExp(String.raw`\.schema` + EXT), "nestjs:schema"],
  [new RegExp(String.raw`\.dto` + EXT), "nestjs:dto"],
  [new RegExp(String.raw`\.repository` + EXT), "nestjs:repository"],
  [new RegExp(String.raw`\.guard` + EXT), "nestjs:guard"],
  [new RegExp(String.raw`\.pipe` + EXT), "nestjs:pipe"],
  [new RegExp(String.raw`\.interceptor` + EXT), "nestjs:interceptor"],
  [new RegExp(String.raw`\.filter` + EXT), "nestjs:filter"],
  [new RegExp(String.raw`\.middleware` + EXT), "nestjs:middleware"],
  [new RegExp(String.raw`\.decorator` + EXT), "nestjs:decorator"],
  [new RegExp(String.raw`\.strategy` + EXT), "nestjs:strategy"],
  [new RegExp(String.raw`(^|/)main` + EXT), "nestjs:bootstrap"],
];

const METHODS: Readonly<Record<string, string>> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
  Head: "HEAD",
  Options: "OPTIONS",
  All: "ALL",
};

const isObject = (arg: Arg): arg is { object: Record<string, Arg> } =>
  typeof arg === "object" && arg !== null && "object" in arg;

// What @Controller(...) says about the path, or null if it cannot be read as
// one literal. An object may carry only `path`: a `version` or a `host`
// changes the URL, and an unknown key (a spread) might.
function controllerPath(args: readonly Arg[]): string | null {
  if (args.length === 0) return "";
  if (args.length > 1) return null;
  const [arg] = args;
  if (typeof arg === "string") return arg;
  if (!isObject(arg)) return null;
  const keys = Object.keys(arg.object);
  if (keys.some((k) => k !== "path")) return null;
  const path = arg.object.path;
  if (path === undefined) return "";
  return typeof path === "string" ? path : null;
}

// What @Get(...) and its kind say about the path: nothing, or one literal.
function methodPath(args: readonly Arg[]): string | null {
  if (args.length === 0) return "";
  if (args.length === 1 && typeof args[0] === "string") return args[0];
  return null;
}

const join = (...parts: string[]): string => {
  const kept = parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter((p) => p !== "");
  return `/${kept.join("/")}`;
};

export const nestjs: Adapter = {
  id: "nestjs",
  detect: (dependencies) => dependencies.has("@nestjs/core"),
  watch: ["setGlobalPrefix", "enableVersioning"],
  folderOf,
  roleOf: ({ local }) => SUFFIXES.find(([pattern]) => pattern.test(local))?.[1] ?? null,
  routes(files, context) {
    // Things set up at bootstrap or in a router module change every URL a
    // controller declares. When one is there and cannot be read exactly, no
    // route of this package is shown.
    const calls = files.flatMap((f) => f.facts.calls);
    if (calls.some((c) => c.name === "enableVersioning")) return [];
    const prefixes = calls.filter((c) => c.name === "setGlobalPrefix");
    let prefix = "";
    if (prefixes.length > 1) return [];
    if (prefixes.length === 1) {
      const [path, ...options] = prefixes[0].args;
      if (typeof path !== "string" || options.length > 0) return [];
      prefix = path;
    }
    for (const file of files) {
      if (!/\.module\.[cm]?[jt]s$/.test(file.local)) continue;
      const text = context.read(file.path);
      if (text !== null && /\bRouterModule\b/.test(text)) return [];
    }

    const routes: Route[] = [];
    for (const file of files) {
      for (const cls of file.facts.classes) {
        const controller = cls.decorators.find((d) => d.name === "Controller");
        if (controller === undefined) continue;
        const base = controllerPath(controller.args);
        if (base === null) continue;
        for (const method of cls.methods) {
          if (method.decorators.some((d) => d.name === "Version")) continue;
          for (const decorator of method.decorators) {
            const verb = METHODS[decorator.name];
            const sub = verb === undefined ? null : methodPath(decorator.args);
            if (verb === undefined || sub === null) continue;
            routes.push({ method: verb, pattern: join(prefix, base, sub), file: file.path });
          }
        }
      }
    }
    return routes;
  },
};
