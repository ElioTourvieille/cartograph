import { folderOf, type Adapter } from "../adapter.ts";

// Express: roles from directory convention, and no routes at all. Express
// routes are assembled when the program runs, from routers, variables and
// middleware chains, so neither a method nor a full pattern can be read from
// the syntax. An Express repository gets roles and an empty route table.
//
// Real repositories name the same folder in the singular or the plural
// (`route` and `routes`, `model` and `models`), so both are accepted.

const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const stem = (file: string): string => file.replace(/\.[^.]+$/, "");

// Checked in this order, so what is routable comes first.
const FOLDERS: readonly (readonly [role: string, folders: readonly string[]])[] = [
  ["express:router", ["routes", "route", "routers", "router"]],
  ["express:controller", ["controllers", "controller", "handlers", "handler"]],
  ["express:service", ["services", "service"]],
  ["express:model", ["models", "model", "schemas", "schema", "entities", "entity"]],
  ["express:middleware", ["middlewares", "middleware"]],
  ["express:view", ["views", "view"]],
  ["express:config", ["config", "configs", "configuration"]],
  ["express:util", ["utils", "util", "helpers", "helper", "lib", "libs"]],
];

export const express: Adapter = {
  id: "express",
  detect: (dependencies) => dependencies.has("express"),
  watch: [],
  folderOf,
  roleOf({ local }) {
    const segments = local.split("/");
    const file = segments[segments.length - 1];
    const folders = segments.slice(0, -1);

    if (
      TEST.test(file) ||
      folders.includes("__tests__") ||
      folders.includes("test") ||
      folders.includes("tests")
    ) {
      return "tests";
    }

    // The file the process starts from, at the package root or in src/.
    const name = stem(file);
    const atRoot = folders.length === 0 || (folders.length === 1 && folders[0] === "src");
    if (atRoot && ["app", "server", "index", "main"].includes(name)) return "express:entry";
    if (folders.length === 1 && folders[0] === "bin" && name === "www") return "express:entry";

    for (const [role, names] of FOLDERS) {
      if (folders.some((f) => names.includes(f))) return role;
    }
    return null;
  },
  routes: () => [],
};
