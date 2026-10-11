import { folderOf, type Adapter, type ScopedFile } from "../adapter.ts";
import type { Route } from "../types.ts";

// Next.js: roles from path conventions, and routes from those same paths. All
// paths here are relative to the package that depends on Next.js, and a leading
// src/ is ignored, as Next.js ignores it.

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const SPECIAL = new Set([
  "loading",
  "error",
  "global-error",
  "not-found",
  "default",
  "forbidden",
  "unauthorized",
  "sitemap",
  "robots",
  "manifest",
  "icon",
  "apple-icon",
  "opengraph-image",
  "twitter-image",
]);
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

const stem = (file: string): string => file.replace(/\.[^.]+$/, "");

function parts(local: string) {
  const base = local.startsWith("src/") ? local.slice(4) : local;
  const segments = base.split("/");
  const file = segments[segments.length - 1];
  return { segments, file, name: stem(file) };
}

function roleOf({ local, facts }: ScopedFile): string | null {
  if (TEST.test(local)) return "tests";
  const { segments, file, name } = parts(local);
  const top = segments[0];

  if (segments.length === 1) {
    if (name === "middleware" || name === "proxy") return "nextjs:middleware";
    if (/^next\.config\./.test(file)) return "nextjs:config";
  }

  if (top === "app" && segments.length > 1) {
    if (name === "page") return "nextjs:page";
    if (name === "route") return "nextjs:api";
    if (name === "layout" || name === "template") return "nextjs:layout";
    if (SPECIAL.has(name)) return "nextjs:special";
  }

  if (top === "pages" && segments.length > 1) {
    if (segments[1] === "api") return "nextjs:api";
    if (name === "_app" || name === "_document") return "nextjs:layout";
    if (name === "_error" || name === "404" || name === "500") return "nextjs:special";
    return "nextjs:page";
  }

  // A file-level "use server" directive is what makes a file hold server
  // actions: read from the syntax, not guessed from the name.
  if (facts.directives.includes("use server")) return "nextjs:action";

  if (segments.includes("components")) return "nextjs:component";
  if (segments.includes("hooks") || /^use[A-Z]/.test(name)) return "nextjs:hook";
  if (["lib", "utils", "helpers"].some((d) => segments.includes(d))) return "nextjs:lib";
  return null;
}

// The pattern of a route handler, from the folders between app/ and route.ts.
// Route groups, written (like-this), are not part of the URL and are dropped.
// Parallel (@slot) and intercepting ((.)x) segments change what a URL means in
// ways the folder name alone does not settle, so a route through one is left out.
function appPattern(segments: readonly string[]): string | null {
  const folders = segments.slice(1, -1);
  const kept: string[] = [];
  for (const folder of folders) {
    if (folder.startsWith("@") || /^\(\.{1,3}\)/.test(folder)) return null;
    if (/^\(.+\)$/.test(folder)) continue;
    kept.push(folder);
  }
  return `/${kept.join("/")}`;
}

export const nextjs: Adapter = {
  id: "nextjs",
  detect: (dependencies) => dependencies.has("next"),
  watch: [],
  folderOf,
  roleOf,
  routes(files, context) {
    // basePath and i18n put something in front of every URL the folders
    // describe. If the config mentions either, the patterns are not exact.
    const config = files.find((f) => /^next\.config\./.test(f.local));
    const configText = config === undefined ? null : context.read(config.path);
    if (configText !== null && /\b(basePath|i18n)\b/.test(configText)) return [];

    const routes: Route[] = [];
    for (const file of files) {
      const { segments, name } = parts(file.local);
      if (segments[0] !== "app" || name !== "route" || roleOf(file) !== "nextjs:api") continue;
      const pattern = appPattern(segments);
      if (pattern === null) continue;
      // The method is the name of the exported handler: written in the code.
      for (const method of file.facts.exports) {
        if (HTTP_METHODS.has(method)) routes.push({ method, pattern, file: file.path });
      }
    }
    return routes;
  },
};
