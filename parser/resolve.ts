import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import * as tsm from "ts-morph";
import type {
  ExcludedReason,
  SkippedFile,
  UnresolvedReason,
} from "./types.ts";
import { IGNORED_DIRECTORY_NAMES, SOURCE_EXTENSIONS } from "./walk.ts";

export type Resolution =
  | { outcome: "resolved"; to: string }
  | { outcome: "external"; name: string }
  | { outcome: "excluded"; reason: ExcludedReason }
  | { outcome: "unresolved"; reason: UnresolvedReason };

export type ResolveContext = {
  /** Real absolute path of the parsed directory, with forward slashes. */
  root: string;
  nodes: ReadonlySet<string>;
  skipped: ReadonlyMap<string, SkippedFile>;
  options: tsm.ts.CompilerOptions;
  host: tsm.ts.ModuleResolutionHost;
  cache: tsm.ts.ModuleResolutionCache;
};

const posix = (p: string): string => p.replace(/\\/g, "/");

// Decides what one import specifier points at. An edge only comes out of
// "resolved": TypeScript's own module resolution found the file and the file
// is one of the nodes. Everything else is counted with a reason, never guessed.
export function resolveImport(
  specifier: string | null,
  fromRel: string,
  ctx: ResolveContext,
): Resolution {
  if (specifier === null) {
    return { outcome: "unresolved", reason: "specifier-non-litteral" };
  }
  if (specifier.startsWith("node:")) {
    return { outcome: "external", name: specifier };
  }

  const fromAbs = `${ctx.root}/${fromRel}`;
  const { resolvedModule } = tsm.ts.resolveModuleName(
    specifier,
    fromAbs,
    ctx.options,
    ctx.host,
    ctx.cache,
  );

  if (resolvedModule !== undefined) {
    const file = posix(resolvedModule.resolvedFileName);
    const inside = file.startsWith(`${ctx.root}/`);
    if (resolvedModule.isExternalLibraryImport || !inside) {
      return { outcome: "external", name: externalName(specifier) };
    }
    const rel = file.slice(ctx.root.length + 1);
    if (ctx.nodes.has(rel)) return { outcome: "resolved", to: rel };
    return { outcome: "excluded", reason: excludedReason(rel, ctx) };
  }

  // TypeScript found nothing. Relative paths: the file is either a resource
  // we do not read (css, svg…) or it is not there.
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const target = posix(resolve(dirname(fromAbs), specifier));
    if (isFile(target)) {
      if (!target.startsWith(`${ctx.root}/`)) {
        return { outcome: "external", name: externalName(specifier) };
      }
      return {
        outcome: "excluded",
        reason: excludedReason(target.slice(ctx.root.length + 1), ctx),
      };
    }
    // Pointing into a directory we deliberately do not read (build output,
    // dependencies): the file being absent says nothing, since the directory
    // may simply not have been built. Excluded, not a failure. No edge either way.
    if (target.startsWith(`${ctx.root}/`)) {
      const rel = target.slice(ctx.root.length + 1);
      if (rel.split("/").some((part) => IGNORED_DIRECTORY_NAMES.has(part))) {
        return { outcome: "excluded", reason: "dossier-exclu" };
      }
    }
    return { outcome: "unresolved", reason: "fichier-introuvable" };
  }

  // A bare specifier. An alias that matches nothing is a real failure; so is a
  // name that exists under baseUrl. Anything else is a package name.
  if (specifier.startsWith("#") || matchesPathsAlias(specifier, ctx.options)) {
    return { outcome: "unresolved", reason: "alias-sans-correspondance" };
  }
  const baseUrl = ctx.options.baseUrl;
  if (baseUrl !== undefined && existsLocally(posix(resolve(baseUrl, specifier)))) {
    return { outcome: "unresolved", reason: "introuvable-sous-baseurl" };
  }
  return { outcome: "external", name: externalName(specifier) };
}

function excludedReason(rel: string, ctx: ResolveContext): ExcludedReason {
  if (rel.split("/").some((part) => IGNORED_DIRECTORY_NAMES.has(part))) {
    return "dossier-exclu";
  }
  if (ctx.skipped.has(rel)) return "fichier-ignore";
  if (!SOURCE_EXTENSIONS.some((ext) => rel.endsWith(ext))) return "ressource";
  return "fichier-ignore";
}

function externalName(specifier: string): string {
  if (specifier.startsWith(".") || isAbsolute(specifier)) return "(hors du dépôt)";
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function matchesPathsAlias(
  specifier: string,
  options: tsm.ts.CompilerOptions,
): boolean {
  for (const pattern of Object.keys(options.paths ?? {})) {
    const star = pattern.indexOf("*");
    if (star === -1) {
      if (pattern === specifier) return true;
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (
        specifier.length >= prefix.length + suffix.length &&
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix)
      ) {
        return true;
      }
    }
  }
  return false;
}

function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

// Whether a bare specifier names something that exists under baseUrl, with or
// without a source extension.
function existsLocally(abs: string): boolean {
  return (
    existsSync(abs) || SOURCE_EXTENSIONS.some((ext) => existsSync(abs + ext))
  );
}
